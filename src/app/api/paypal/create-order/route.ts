
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPayPalAccessToken, PAYPAL_BASE_URL } from "@/lib/paypal";
import { supabaseRequest } from "@/lib/supabase-admin";
import { hashClientToken } from "@/lib/proposal-security";

export const runtime = "nodejs";

const schema = z.object({
  token: z.string().min(30).max(200),
  milestoneIndex: z.number().int().nonnegative(),
});

type ProposalRow = {
  id: string;
  proposal: {
    title: string;
    currency: string;
    milestones: {
      name: string;
      description: string;
      amount: number;
    }[];
  };
  status: string;
  expires_at: string;
};

type PaymentRow = {
  id: string;
  status: string;
  paypal_order_id: string | null;
};

type PayPalErrorDetail = {
  issue?: string;
  description?: string;
  field?: string;
};

type PayPalOrderResponse = {
  id?: string;
  status?: string;
  links?: {
    rel: string;
    href: string;
  }[];
  purchase_units?: {
    amount?: {
      currency_code?: string;
      value?: string;
    };
  }[];
  name?: string;
  message?: string;
  debug_id?: string;
  details?: PayPalErrorDetail[];
};

function logPayPalError(
  stage: string,
  status: number,
  data: PayPalOrderResponse
) {
  console.error("[ScopePay][PayPal API Error]", {
    stage,
    httpStatus: status,
    name: data.name ?? null,
    message: data.message ?? null,
    debugId: data.debug_id ?? null,
    details: data.details ?? [],
  });
}

export async function POST(request: Request) {
  let paymentId: string | null = null;

  try {
    const parsed = schema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payment request." },
        { status: 400 }
      );
    }

    const { token, milestoneIndex } = parsed.data;
    const tokenHash = hashClientToken(token);

    // 1. Load proposal
    const proposals = await supabaseRequest<ProposalRow[]>(
      `scopepay_proposals?select=id,proposal,status,expires_at&client_token_hash=eq.${tokenHash}&limit=1`
    );

    const proposal = proposals[0];

    if (!proposal || new Date(proposal.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: "Proposal link is invalid or expired." },
        { status: 404 }
      );
    }

    if (proposal.status !== "approved") {
      return NextResponse.json(
        { error: "The client must approve this proposal before payment." },
        { status: 403 }
      );
    }

    // 2. Validate milestone
    const milestone = proposal.proposal.milestones[milestoneIndex];

    if (
      !milestone ||
      !Number.isFinite(milestone.amount) ||
      milestone.amount <= 0
    ) {
      return NextResponse.json(
        { error: "Invalid milestone." },
        { status: 400 }
      );
    }

    const currency = proposal.proposal.currency.toUpperCase();

    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error("Invalid proposal currency.");
    }

    // 3. Prevent duplicate pending or paid payments
    const existing = await supabaseRequest<PaymentRow[]>(
      `scopepay_payments?select=id,status,paypal_order_id&proposal_id=eq.${proposal.id}&milestone_index=eq.${milestoneIndex}&status=in.(pending,paid)&limit=1`
    );

    if (existing.length > 0) {
      return NextResponse.json(
        {
          error:
            existing[0].status === "paid"
              ? "This milestone has already been paid."
              : "A payment is already pending for this milestone. Please contact the freelancer.",
        },
        { status: 409 }
      );
    }

    // 4. Create local payment record
    const inserted = await supabaseRequest<{ id: string }[]>(
      "scopepay_payments?select=id",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          proposal_id: proposal.id,
          milestone_index: milestoneIndex,
          amount: milestone.amount,
          currency,
          status: "pending",
          metadata: {
            milestone_name: milestone.name,
            provider: "paypal",
            environment: "sandbox",
          },
        }),
      }
    );

    paymentId = inserted[0]?.id ?? null;

    if (!paymentId) {
      throw new Error("Could not create the payment record.");
    }

    console.info("[ScopePay][Payment Created]", {
      paymentId,
      milestoneIndex,
      amount: milestone.amount,
      currency,
    });

    // 5. Authenticate with PayPal
    const accessToken = await getPayPalAccessToken();
    const origin = new URL(request.url).origin;
    const requestId = randomUUID();

    // 6. Create PayPal order
    const paypalResponse = await fetch(
      `${PAYPAL_BASE_URL}/v2/checkout/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": requestId,
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: paymentId,
              description: milestone.name.slice(0, 127),
              amount: {
                currency_code: currency,
                value: milestone.amount.toFixed(2),
              },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                user_action: "PAY_NOW",
                // Milestone checkout is expected to complete immediately.
                // Excluding delayed funding methods prevents a PENDING capture.
                payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
                shipping_preference: "NO_SHIPPING",
                return_url: `${origin}/proposal/${token}?payment=success`,
                cancel_url: `${origin}/proposal/${token}?payment=cancelled`,
              },
            },
          },
        }),
        cache: "no-store",
      }
    );

    const responseText = await paypalResponse.text();

    let data: PayPalOrderResponse;

    try {
      data = responseText
        ? JSON.parse(responseText)
        : {};
    } catch {
      console.error("[ScopePay][PayPal Invalid Response]", {
        httpStatus: paypalResponse.status,
        responseLength: responseText.length,
      });

      throw new Error("PayPal returned an unreadable response.");
    }

    // 7. Log complete useful error diagnostics (without credentials)
    if (!paypalResponse.ok) {
      logPayPalError("create-order", paypalResponse.status, data);

      throw new Error(
        `PayPal order creation failed (${paypalResponse.status}).`
      );
    }

    const approvalUrl = data.links?.find(
      (link) =>
        link.rel === "payer-action" || link.rel === "approve"
    )?.href;

    if (!approvalUrl || !data.id) {
      console.error("[ScopePay][PayPal Missing Approval Link]", {
        orderId: data.id ?? null,
        orderStatus: data.status ?? null,
        links: data.links?.map((link) => link.rel) ?? [],
      });

      throw new Error("PayPal did not return an approval link.");
    }

    // 8. Log successful order creation
    console.info("[ScopePay][PayPal Order Created]", {
      paymentId,
      orderId: data.id,
      orderStatus: data.status ?? null,
      requestedCurrency: currency,
      returnedCurrency:
        data.purchase_units?.[0]?.amount?.currency_code ?? null,
      returnedAmount:
        data.purchase_units?.[0]?.amount?.value ?? null,
      paypalRequestId: requestId,
    });

    // 9. Save PayPal order ID
    await supabaseRequest(
      `scopepay_payments?id=eq.${paymentId}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          paypal_order_id: data.id,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    return NextResponse.json({
      orderId: data.id,
      approvalUrl,
      paymentId,
      amount: milestone.amount,
      currency,
    });
  } catch (error) {
    console.error("[ScopePay][Create Order Failed]", {
      paymentId,
      message:
        error instanceof Error
          ? error.message
          : "Unknown error",
    });

    // 10. Mark unsuccessful local payment attempt as failed
    if (paymentId) {
      try {
        await supabaseRequest(
          `scopepay_payments?id=eq.${paymentId}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              status: "failed",
              updated_at: new Date().toISOString(),
            }),
          }
        );

        console.info("[ScopePay][Payment Marked Failed]", {
          paymentId,
        });
      } catch (updateError) {
        console.error(
          "[ScopePay][Could Not Update Payment]",
          {
            paymentId,
            message:
              updateError instanceof Error
                ? updateError.message
                : "Unknown database error",
          }
        );
      }
    }

    return NextResponse.json(
      {
        error: "Unable to create PayPal payment. Check server diagnostics.",
      },
      { status: 500 }
    );
  }
}
