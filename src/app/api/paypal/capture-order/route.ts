import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPayPalAccessToken, PAYPAL_BASE_URL } from "@/lib/paypal";
import { hashClientToken } from "@/lib/proposal-security";
import { supabaseRequest } from "@/lib/supabase-admin";
import { toMinorUnits } from "@/lib/money";

export const runtime = "nodejs";

const schema = z.object({
  token: z.string().min(30).max(200),
  orderId: z.string().min(5).max(128),
});

type PaymentRow = {
  id: string;
  proposal_id: string;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed";
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  metadata?: Record<string, unknown> | null;
};

type ProposalRow = {
  id: string;
  status: string;
  client_token_hash: string;
};

type PayPalCapture = {
  id?: string;
  status?: string;
  status_details?: { reason?: string };
  amount?: { value?: string; currency_code?: string };
};

type PayPalOrder = {
  id?: string;
  status?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string }[];
  purchase_units?: {
    reference_id?: string;
    payments?: { captures?: PayPalCapture[] };
  }[];
};

async function readPayPalOrder(response: Response): Promise<PayPalOrder> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as PayPalOrder;
  } catch {
    return {};
  }
}

function inspectCapture(data: PayPalOrder, payment: PaymentRow) {
  const unit = data.purchase_units?.[0];
  const capture = unit?.payments?.captures?.find((item) => item.status === "COMPLETED")
    ?? unit?.payments?.captures?.[0];
  const value = Number(capture?.amount?.value);
  const amount = Number.isFinite(value) ? value : null;
  const currency = capture?.amount?.currency_code?.toUpperCase() ?? null;
  let reason = "";

  if (unit?.reference_id && unit.reference_id !== payment.id) {
    reason = "PayPal order reference does not match the payment record.";
  } else if (data.status !== "COMPLETED") {
    reason = `PayPal order is ${data.status || "not completed"}.`;
  } else if (!capture?.id) {
    reason = "PayPal did not return a capture ID.";
  } else if (capture.status !== "COMPLETED") {
    reason = `PayPal capture is ${capture.status || "not completed"}.`;
  } else if (amount === null || toMinorUnits(amount) !== toMinorUnits(Number(payment.amount))) {
    reason = "Captured amount does not match the milestone amount.";
  } else if (currency !== payment.currency.toUpperCase()) {
    reason = "Captured currency does not match the milestone currency.";
  }

  return {
    valid: !reason,
    reason,
    captureId: capture?.id ?? null,
    orderStatus: data.status ?? null,
    captureStatus: capture?.status ?? null,
    statusReason: capture?.status_details?.reason ?? null,
    actualAmount: amount,
    actualCurrency: currency,
    referenceId: unit?.reference_id ?? null,
    expectedAmount: Number(payment.amount),
    expectedCurrency: payment.currency,
  };
}

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid capture request." }, { status: 400 });
    }

    const { token, orderId } = parsed.data;
    const tokenHash = hashClientToken(token);
    const payments = await supabaseRequest<PaymentRow[]>(
      `scopepay_payments?select=id,proposal_id,amount,currency,status,paypal_order_id,paypal_capture_id,metadata&paypal_order_id=eq.${encodeURIComponent(orderId)}&limit=1`
    );
    const payment = payments[0];

    if (!payment || !["pending", "paid"].includes(payment.status)) {
      return NextResponse.json(
        { error: "Payment not found or is no longer eligible for capture." },
        { status: 404 }
      );
    }

    const proposals = await supabaseRequest<ProposalRow[]>(
      `scopepay_proposals?select=id,status,client_token_hash&id=eq.${payment.proposal_id}&limit=1`
    );
    const proposal = proposals[0];

    if (
      !proposal ||
      proposal.client_token_hash !== tokenHash ||
      proposal.status !== "approved"
    ) {
      return NextResponse.json(
        { error: "This payment is not authorized for this proposal." },
        { status: 403 }
      );
    }

    // A PayPal return can be retried by browser reloads, React development mode,
    // or a webhook racing this request. Return the recorded result on retries.
    if (payment.status === "paid" && payment.paypal_capture_id) {
      return NextResponse.json({
        success: true,
        status: "paid",
        orderId,
        captureId: payment.paypal_capture_id,
        amount: payment.amount,
        currency: payment.currency,
        alreadyPaid: true,
      });
    }

    if (payment.status !== "pending" || payment.paypal_order_id !== orderId) {
      return NextResponse.json(
        { error: "Payment is not pending for this PayPal order." },
        { status: 409 }
      );
    }

    const accessToken = await getPayPalAccessToken();
    let orderReadAttempted = false;
    let paypalOrder: PayPalOrder;

    if (payment.paypal_capture_id) {
      // An earlier capture returned PENDING. Check its status without trying
      // to capture the same order again when the buyer refreshes the page.
      const orderResponse = await fetch(
        `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
      );
      orderReadAttempted = true;
      paypalOrder = await readPayPalOrder(orderResponse);
      if (!orderResponse.ok) {
        return NextResponse.json(
          { error: "Could not refresh the PayPal capture status." },
          { status: 502 }
        );
      }
    } else {
      const response = await fetch(
        `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            // Reuse one stable request id for retries of this local payment.
            "PayPal-Request-Id": payment.id || randomUUID(),
          },
          cache: "no-store",
        }
      );

      paypalOrder = await readPayPalOrder(response);

      if (!response.ok) {
        // PayPal can reject a repeat capture after the first call succeeded.
        if (response.status === 422) {
          const orderResponse = await fetch(
            `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
            { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
          );
          orderReadAttempted = true;
          const currentOrder = await readPayPalOrder(orderResponse);
          if (orderResponse.ok && currentOrder.status === "COMPLETED") {
            paypalOrder = currentOrder;
          } else {
            const detail = paypalOrder.details?.[0];
            console.error("[ScopePay][PayPal Capture Rejected]", {
              httpStatus: response.status,
              issue: detail?.issue ?? null,
              debugId: paypalOrder.debug_id ?? null,
            });
            return NextResponse.json(
              {
                error: detail?.description || paypalOrder.message || "PayPal could not capture this order.",
                issue: detail?.issue,
                debugId: paypalOrder.debug_id,
              },
              { status: response.status }
            );
          }
        } else {
          console.error("[ScopePay][PayPal Capture Rejected]", {
            httpStatus: response.status,
            issue: paypalOrder.details?.[0]?.issue ?? null,
            debugId: paypalOrder.debug_id ?? null,
          });
          return NextResponse.json(
            {
              error: paypalOrder.details?.[0]?.description || paypalOrder.message || "PayPal capture failed.",
              issue: paypalOrder.details?.[0]?.issue,
              debugId: paypalOrder.debug_id,
            },
            { status: response.status }
          );
        }
      }
    }

    let verification = inspectCapture(paypalOrder, payment);

    // Prefer PayPal's current order state when the capture response is
    // incomplete or inconsistent. This also recovers a completed capture if
    // PayPal's POST response was truncated or raced a webhook.
    if (!verification.valid && !orderReadAttempted) {
      const orderResponse = await fetch(
        `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
      );
      orderReadAttempted = true;
      const currentOrder = await readPayPalOrder(orderResponse);
      if (orderResponse.ok) {
        const currentVerification = inspectCapture(currentOrder, payment);
        if (currentVerification.valid || currentVerification.orderStatus === "COMPLETED") {
          paypalOrder = currentOrder;
          verification = currentVerification;
        }
      }
    }

    if (!verification.valid) {
      const isPending = verification.captureStatus === "PENDING" || verification.orderStatus === "APPROVED";
      const status = isPending ? 202 : 422;

      if (verification.captureStatus === "PENDING") {
        await supabaseRequest(
          `scopepay_payments?id=eq.${payment.id}&status=eq.pending`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              paypal_capture_id: verification.captureId,
              metadata: {
                ...(payment.metadata || {}),
                paypal_capture_status: "PENDING",
                paypal_capture_status_reason: verification.statusReason,
              },
              updated_at: new Date().toISOString(),
            }),
          }
        );
      } else if (["DECLINED", "DENIED", "FAILED"].includes(verification.captureStatus || "")) {
        // A terminal PayPal decline can be reconciled on refresh even when a
        // webhook tunnel is not configured. Free this milestone for retry.
        await supabaseRequest(
          `scopepay_payments?id=eq.${payment.id}&status=eq.pending`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              status: "failed",
              paypal_capture_id: verification.captureId,
              metadata: {
                ...(payment.metadata || {}),
                paypal_capture_status: verification.captureStatus,
                paypal_capture_status_reason: verification.statusReason,
              },
              updated_at: new Date().toISOString(),
            }),
          }
        );
      }

      console.error("[ScopePay][Capture Verification Mismatch]", {
        orderId,
        paymentId: payment.id,
        reason: verification.reason,
        orderStatus: verification.orderStatus,
        captureStatus: verification.captureStatus,
        statusReason: verification.statusReason,
        expectedAmount: verification.expectedAmount,
        actualAmount: verification.actualAmount,
        expectedCurrency: verification.expectedCurrency,
        actualCurrency: verification.actualCurrency,
        referenceId: verification.referenceId,
        debugId: paypalOrder.debug_id ?? null,
      });
      return NextResponse.json(
        {
          error: isPending
            ? `PayPal is still processing this payment${verification.statusReason ? ` (${verification.statusReason})` : ""}. Do not pay this milestone again. Check status or refresh this page shortly.`
            : verification.reason,
          verification: {
            orderStatus: verification.orderStatus,
            captureStatus: verification.captureStatus,
            statusReason: verification.statusReason,
            expectedAmount: verification.expectedAmount,
            actualAmount: verification.actualAmount,
            expectedCurrency: verification.expectedCurrency,
            actualCurrency: verification.actualCurrency,
          },
          debugId: paypalOrder.debug_id,
        },
        { status }
      );
    }

    const verified = {
      captureId: verification.captureId as string,
      amount: verification.actualAmount as number,
      currency: verification.actualCurrency as string,
    };
    const now = new Date().toISOString();
    const updated = await supabaseRequest<PaymentRow[]>(
      `scopepay_payments?select=id,proposal_id,amount,currency,status,paypal_order_id,paypal_capture_id&id=eq.${payment.id}&status=eq.pending`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: "paid",
          paypal_capture_id: verified.captureId,
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
              paypal_capture_id: verified.captureId,
            },
          }),
        });
      } catch (eventError) {
        // Payment confirmation is authoritative; an event log failure must not
        // make the client retry an already completed PayPal capture.
        console.error("[ScopePay] Payment succeeded but event logging failed.", eventError);
      }
    } else {
      const latest = await supabaseRequest<PaymentRow[]>(
        `scopepay_payments?select=id,proposal_id,amount,currency,status,paypal_order_id,paypal_capture_id&id=eq.${payment.id}&limit=1`
      );
      if (
        latest[0]?.status !== "paid" ||
        latest[0]?.paypal_capture_id !== verified.captureId
      ) {
        return NextResponse.json(
          { error: "Payment status changed while capture was being verified. Refresh and check the payment status." },
          { status: 409 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      status: "paid",
      orderId,
      captureId: verified.captureId,
      amount: verified.amount,
      currency: verified.currency,
    });
  } catch (error) {
    console.error("[ScopePay][Capture Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to verify payment." },
      { status: 500 }
    );
  }
}
