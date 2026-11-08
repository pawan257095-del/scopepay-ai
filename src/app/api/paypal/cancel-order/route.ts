import { NextResponse } from "next/server";
import { z } from "zod";
import { getPayPalAccessToken, PAYPAL_BASE_URL } from "@/lib/paypal";
import { hashClientToken } from "@/lib/proposal-security";
import { supabaseRequest } from "@/lib/supabase-admin";
import { toMinorUnits } from "@/lib/money";

export const runtime = "nodejs";

const schema = z.object({
  token: z.string().min(30).max(200),
  milestoneIndex: z.number().int().nonnegative(),
  orderId: z.string().min(5).max(128).optional(),
});

type PaymentRow = {
  id: string;
  proposal_id: string;
  status: "pending" | "paid" | "failed";
  paypal_order_id: string | null;
  amount: number;
  currency: string;
  paypal_capture_id: string | null;
  metadata?: Record<string, unknown> | null;
};

type PayPalOrder = {
  status?: string;
  purchase_units?: {
    reference_id?: string;
    payments?: {
      captures?: {
        id?: string;
        status?: string;
        status_details?: { reason?: string };
        amount?: { value?: string; currency_code?: string };
      }[];
    };
  }[];
};

type ProposalRow = {
  id: string;
  status: string;
  client_token_hash: string;
};

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid cancellation request." }, { status: 400 });
    }

    const { token, milestoneIndex, orderId } = parsed.data;
    const tokenHash = hashClientToken(token);
    const proposalRows = await supabaseRequest<ProposalRow[]>(
      `scopepay_proposals?select=id,status,client_token_hash&client_token_hash=eq.${tokenHash}&limit=1`
    );
    const proposal = proposalRows[0];

    if (!proposal || proposal.status !== "approved") {
      return NextResponse.json({ error: "This payment is not authorized for this proposal." }, { status: 403 });
    }

    // PayPal returns the order ID in the cancel URL. Use it as the primary
    // lookup so stale sessionStorage from another milestone cannot select the
    // wrong local payment record.
    const paymentQuery = orderId
      ? `scopepay_payments?select=id,proposal_id,status,paypal_order_id,amount,currency,paypal_capture_id,metadata&proposal_id=eq.${proposal.id}&paypal_order_id=eq.${encodeURIComponent(orderId)}&status=in.(pending,paid)&limit=1`
      : `scopepay_payments?select=id,proposal_id,status,paypal_order_id,amount,currency,paypal_capture_id,metadata&proposal_id=eq.${proposal.id}&milestone_index=eq.${milestoneIndex}&status=in.(pending,paid)&order=created_at.desc&limit=1`;
    const payments = await supabaseRequest<PaymentRow[]>(
      paymentQuery
    );
    const payment = payments[0];

    if (!payment) {
      return NextResponse.json({ cancelled: true, alreadyCancelled: true });
    }
    if (payment.status === "paid") {
      return NextResponse.json({ error: "This milestone is already paid." }, { status: 409 });
    }
    if (!payment.paypal_order_id) {
      return NextResponse.json({ error: "The pending payment has no PayPal order to cancel." }, { status: 409 });
    }

    const accessToken = await getPayPalAccessToken();
    const paypalResponse = await fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(payment.paypal_order_id)}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
    );
    const paypalText = await paypalResponse.text();
    let paypalOrder: PayPalOrder = {};
    try {
      paypalOrder = paypalText ? JSON.parse(paypalText) as PayPalOrder : {};
    } catch {
      return NextResponse.json({ error: "PayPal returned an unreadable order status." }, { status: 502 });
    }

    if (!paypalResponse.ok) {
      return NextResponse.json({ error: "Could not confirm the PayPal order status." }, { status: 502 });
    }

    const captureUnits = (paypalOrder.purchase_units ?? []).filter(
      (unit) => (unit.payments?.captures ?? []).length > 0
    );
    const captures = captureUnits.flatMap((unit) => unit.payments?.captures ?? []);
    const captured = captures.find((capture) => capture.status === "COMPLETED")
      ?? captures.find((capture) => capture.status === "PENDING");
    const hasUnsettledCapture = captures.some(
      (capture) => capture.status === "PENDING" || capture.status === "COMPLETED"
    );
    const hasTerminalDeclinedCapture = captures.some(
      (capture) =>
        capture.status === "DECLINED" ||
        capture.status === "DENIED" ||
        capture.status === "FAILED"
    );
    const orderHasNoCapture = captures.length === 0;
    const orderCanBeAbandoned =
      orderHasNoCapture &&
      ["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED", "VOIDED"].includes(
        paypalOrder.status ?? ""
      );

    // Never release a payment while PayPal has a pending or completed capture.
    // A canceled/declined checkout with no capture is safe to retry. The local
    // failed status also makes any stale return URL ineligible for capture.
    if (hasUnsettledCapture && captured) {
      const captureUnit = captureUnits.find((unit) =>
        (unit.payments?.captures ?? []).some((capture) => capture.id === captured.id)
      );
      const captureAmount = Number(captured.amount?.value);
      const captureCurrency = captured.amount?.currency_code?.toUpperCase();
      const detailsMatch =
        !!captured.id &&
        Number.isFinite(captureAmount) &&
        captureAmount > 0 &&
        toMinorUnits(captureAmount) === toMinorUnits(Number(payment.amount)) &&
        captureCurrency === payment.currency.toUpperCase() &&
        (!captureUnit?.reference_id || captureUnit.reference_id === payment.id) &&
        (!payment.paypal_capture_id || payment.paypal_capture_id === captured.id);

      if (!detailsMatch) {
        return NextResponse.json(
          { error: "PayPal has a capture that needs manual verification. Do not pay this milestone again." },
          { status: 409 }
        );
      }

      const now = new Date().toISOString();
      await supabaseRequest(
        `scopepay_payments?id=eq.${payment.id}&status=eq.pending`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            paypal_capture_id: captured.id,
            metadata: {
              ...(payment.metadata || {}),
              paypal_capture_status: captured.status,
              paypal_capture_status_reason: captured.status_details?.reason ?? null,
            },
            updated_at: now,
          }),
        }
      );

      return NextResponse.json(
        {
          reconcileRequired: true,
          orderId: payment.paypal_order_id,
          captureStatus: captured.status,
          error: "PayPal has a capture in progress. Checking the payment status; do not pay this milestone again.",
        },
        { status: 202 }
      );
    }

    if (hasUnsettledCapture || (!orderCanBeAbandoned && !hasTerminalDeclinedCapture)) {
      return NextResponse.json(
        {
          error: hasUnsettledCapture
            ? "PayPal has a pending or completed capture. This milestone cannot be canceled; refresh to check its status."
            : "PayPal could not confirm that this checkout was canceled. Refresh to check its payment status.",
        },
        { status: 409 }
      );
    }

    const changed = await supabaseRequest<PaymentRow[]>(
      `scopepay_payments?select=id,proposal_id,status,paypal_order_id&id=eq.${payment.id}&status=eq.pending`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "failed", updated_at: new Date().toISOString() }),
      }
    );

    if (changed.length > 0) {
      await supabaseRequest("scopepay_proposal_events", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          proposal_id: proposal.id,
          event_type: "milestone_payment_cancelled",
          details: {
            milestone_payment_id: payment.id,
            paypal_order_id: payment.paypal_order_id,
          },
        }),
      });
    }

    return NextResponse.json({ cancelled: true });
  } catch (error) {
    console.error("[ScopePay][Cancel Order Error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not cancel payment." },
      { status: 500 }
    );
  }
}
