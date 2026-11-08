
import { NextRequest, NextResponse } from "next/server";
import { getPayPalAccessToken, PAYPAL_BASE_URL } from "@/lib/paypal";
import { supabaseRequest } from "@/lib/supabase-admin";
import { toMinorUnits } from "@/lib/money";

export const runtime = "nodejs";

type PayPalEvent = {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    status?: string;
    amount?: {
      value?: string;
      currency_code?: string;
    };
    status_details?: {
      reason?: string;
    };
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
  };
};

type PaymentRow = {
  id: string;
  proposal_id: string;
  amount: number;
  currency: string;
  status: string;
  paypal_capture_id: string | null;
  metadata?: Record<string, unknown> | null;
};

type EventRow = {
  id: string;
  event_id: string;
  processing_status: string;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  let event: PayPalEvent;

  try {
    const rawBody = await request.text();
    event = JSON.parse(rawBody) as PayPalEvent;
  } catch {
    return jsonError("Invalid webhook payload.", 400);
  }

  if (!event.id || !event.event_type || !event.resource) {
    return jsonError("Incomplete PayPal webhook event.", 400);
  }

  const webhookId = process.env.PAYPAL_WEBHOOK_ID;

  if (!webhookId) {
    console.error("[ScopePay Webhook] PAYPAL_WEBHOOK_ID is missing.");
    return jsonError("Webhook configuration is incomplete.", 500);
  }

  try {
    // 1. Ask PayPal to verify the original delivery headers and event.
    const transmissionId = request.headers.get("paypal-transmission-id");
    const transmissionTime = request.headers.get("paypal-transmission-time");
    const transmissionSig = request.headers.get("paypal-transmission-sig");
    const certUrl = request.headers.get("paypal-cert-url");
    const authAlgo = request.headers.get("paypal-auth-algo");

    if (
      !transmissionId ||
      !transmissionTime ||
      !transmissionSig ||
      !certUrl ||
      !authAlgo
    ) {
      return jsonError("Missing PayPal signature headers.", 400);
    }

    const accessToken = await getPayPalAccessToken();

    const verificationResponse = await fetch(
      `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transmission_id: transmissionId,
          transmission_time: transmissionTime,
          transmission_sig: transmissionSig,
          cert_url: certUrl,
          auth_algo: authAlgo,
          webhook_id: webhookId,
          webhook_event: event,
        }),
        cache: "no-store",
      }
    );

    if (!verificationResponse.ok) {
      console.error("[ScopePay Webhook] PayPal signature verification API failed.", {
        status: verificationResponse.status,
      });

      return jsonError("Could not verify PayPal webhook.", 502);
    }

    const verification = await verificationResponse.json();

    if (verification.verification_status !== "SUCCESS") {
      console.warn("[ScopePay Webhook] Invalid signature rejected.", {
        eventId: event.id,
      });

      return jsonError("Invalid PayPal webhook signature.", 400);
    }

    // 2. Check whether this event was already processed.
    const existingEvents = await supabaseRequest<EventRow[]>(
      `scopepay_webhook_events?select=id,event_id,processing_status&event_id=eq.${encodeURIComponent(event.id)}&limit=1`
    );

    const existingEvent = existingEvents[0];

    if (
      existingEvent &&
      (existingEvent.processing_status === "processed" ||
        existingEvent.processing_status === "ignored")
    ) {
      return NextResponse.json({
        received: true,
        duplicate: true,
      });
    }

    // 3. Record this verified event, or retry an earlier failed event.
    let eventRecordId = existingEvent?.id ?? null;

    if (!eventRecordId) {
      const inserted = await supabaseRequest<EventRow[]>(
        "scopepay_webhook_events?select=id,event_id,processing_status",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            event_id: event.id,
            event_type: event.event_type,
            resource_id: event.resource.id ?? null,
            order_id:
              event.resource.supplementary_data?.related_ids?.order_id ?? null,
            processing_status: "received",
            payload: event,
          }),
        }
      );

      eventRecordId = inserted[0]?.id ?? null;
    }

    if (!eventRecordId) {
      throw new Error("Could not record webhook event.");
    }

    const isPendingEvent = event.event_type === "PAYMENT.CAPTURE.PENDING";
    const isCompletedEvent = event.event_type === "PAYMENT.CAPTURE.COMPLETED";
    const isDeniedEvent = event.event_type === "PAYMENT.CAPTURE.DENIED";

    // 4. Ignore unrelated event types safely.
    if (!isPendingEvent && !isCompletedEvent && !isDeniedEvent) {
      await supabaseRequest(
        `scopepay_webhook_events?id=eq.${eventRecordId}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            processing_status: "ignored",
            processed_at: new Date().toISOString(),
          }),
        }
      );

      return NextResponse.json({
        received: true,
        ignored: true,
      });
    }

    // 5. Validate the capture event and its payment details.
    const capture = event.resource;
    const orderId =
      capture.supplementary_data?.related_ids?.order_id;
    const captureId = capture.id;
    const amount = Number(capture.amount?.value);
    const currency = capture.amount?.currency_code?.toUpperCase();

    const expectedCaptureStatus = isPendingEvent
      ? "PENDING"
      : isCompletedEvent
        ? "COMPLETED"
        : "DECLINED";

    if (
      capture.status !== expectedCaptureStatus ||
      !orderId ||
      !captureId ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !currency
    ) {
      throw new Error("PayPal capture event has incomplete payment details.");
    }

    // 6. Match the PayPal order to our own payment record.
    const payments = await supabaseRequest<PaymentRow[]>(
      `scopepay_payments?select=id,proposal_id,amount,currency,status,paypal_capture_id,metadata&paypal_order_id=eq.${encodeURIComponent(orderId)}&limit=1`
    );

    const payment = payments[0];

    if (!payment) {
      throw new Error("No ScopePay payment matches this PayPal order.");
    }

    // 7. Never accept a mismatched amount or currency.
    if (
      toMinorUnits(Number(payment.amount)) !== toMinorUnits(amount) ||
      payment.currency !== currency
    ) {
      throw new Error("PayPal capture amount or currency does not match.");
    }
    if (payment.paypal_capture_id && payment.paypal_capture_id !== captureId) {
      throw new Error("PayPal capture ID does not match the recorded capture.");
    }

    // 8. Reconcile pending, completed, and denied captures without allowing a
    // late event to downgrade a payment that is already paid.
    const now = new Date().toISOString();
    const metadata = {
      ...(payment.metadata || {}),
      paypal_capture_status: expectedCaptureStatus,
      paypal_capture_status_reason: capture.status_details?.reason ?? null,
      paypal_capture_last_event_id: event.id,
      paypal_capture_last_event_at: now,
    };

    if (payment.status === "paid") {
      if (payment.paypal_capture_id !== captureId) {
        throw new Error("Payment is already paid with a different capture ID.");
      }
    } else if (payment.status === "pending" && isPendingEvent) {
      await supabaseRequest(
        `scopepay_payments?id=eq.${payment.id}&status=eq.pending`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            paypal_capture_id: captureId,
            metadata,
            updated_at: now,
          }),
        }
      );
    } else if (payment.status === "pending" && isDeniedEvent) {
      await supabaseRequest(
        `scopepay_payments?id=eq.${payment.id}&status=eq.pending`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "failed",
            paypal_capture_id: captureId,
            metadata,
            updated_at: now,
          }),
        }
      );
    } else if (payment.status === "pending" && isCompletedEvent) {
      const updated = await supabaseRequest<PaymentRow[]>(
        `scopepay_payments?select=id,proposal_id,amount,currency,status,paypal_capture_id&id=eq.${payment.id}&status=eq.pending`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            status: "paid",
            paypal_capture_id: captureId,
            metadata,
            paid_at: now,
            updated_at: now,
          }),
        }
      );

      if (updated.length > 0) {
        try {
          await supabaseRequest("scopepay_proposal_events", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              proposal_id: payment.proposal_id,
              event_type: "milestone_paid",
              details: {
                milestone_payment_id: payment.id,
                amount: payment.amount,
                currency: payment.currency,
                paypal_order_id: orderId,
                paypal_capture_id: captureId,
                source: "paypal_webhook",
              },
            }),
          });
        } catch (eventError) {
          console.error("[ScopePay Webhook] Payment confirmed but event logging failed.", {
            eventId: event.id,
            message: eventError instanceof Error ? eventError.message : "Unknown error",
          });
        }
      } else {
        const latest = await supabaseRequest<PaymentRow[]>(
          `scopepay_payments?select=id,proposal_id,amount,currency,status,paypal_capture_id&id=eq.${payment.id}&limit=1`
        );
        if (
          latest[0]?.status !== "paid" ||
          latest[0]?.paypal_capture_id !== captureId
        ) {
          throw new Error("Payment changed while the webhook was being processed.");
        }
      }
    } else if (payment.status === "failed" && isCompletedEvent) {
      throw new Error("PayPal completed a capture for a locally failed payment; manual reconciliation is required.");
    } else if (payment.status !== "failed") {
      throw new Error("Payment is not eligible for completion.");
    }

    // 9. Mark event processed.
    await supabaseRequest(
      `scopepay_webhook_events?id=eq.${eventRecordId}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          processing_status: "processed",
          processed_at: new Date().toISOString(),
          processing_error: null,
        }),
      }
    );

    console.info("[ScopePay Webhook] Capture event reconciled.", {
      eventId: event.id,
      paymentId: payment.id,
      orderId,
      captureId,
      captureStatus: expectedCaptureStatus,
      statusReason: capture.status_details?.reason ?? null,
      amount,
      currency,
    });

    return NextResponse.json({
      received: true,
      processed: true,
      captureStatus: expectedCaptureStatus,
    });
  } catch (error) {
    console.error("[ScopePay Webhook] Processing failed.", {
      eventId: event.id,
      message:
        error instanceof Error ? error.message : "Unknown error",
    });

    // PayPal can retry because we return a non-2xx response.
    try {
      await supabaseRequest(
        `scopepay_webhook_events?event_id=eq.${encodeURIComponent(event.id)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            processing_status: "failed",
            processing_error:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "Unknown processing error",
          }),
        }
      );
    } catch (updateError) {
      console.error("[ScopePay Webhook] Could not update event status.", {
        message:
          updateError instanceof Error
            ? updateError.message
            : "Unknown database error",
      });
    }

    return jsonError("Webhook processing failed.", 500);
  }
}
