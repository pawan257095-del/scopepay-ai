
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseRequest } from "@/lib/supabase-admin";
import { createClientToken, hashClientToken } from "@/lib/proposal-security";
import { hasAtMostTwoDecimalPlaces, toMinorUnits } from "@/lib/money";

export const runtime = "nodejs";

const proposalSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(5000),
  assumptions: z.array(z.string()).default([]),
  included: z.array(z.string()).default([]),
  excluded: z.array(z.string()).default([]),
  pricingBreakdown: z.array(
    z.object({
      item: z.string(),
      explanation: z.string(),
      amount: z.number().finite().nonnegative().refine(hasAtMostTwoDecimalPlaces),
    })
  ),
  questions: z.array(z.string()).default([]),
  deliverables: z.array(z.string()).default([]),
  milestones: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      amount: z.number().finite().nonnegative().refine(hasAtMostTwoDecimalPlaces),
    })
  ),
  estimatedTotal: z.number().finite().positive().refine(hasAtMostTwoDecimalPlaces),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timeline: z.string().min(1).max(200),
});
export async function GET() {
  try {
    const proposals = await supabaseRequest<
      {
        id: string;
        title: string;
        status: string;
        created_at: string;
        updated_at: string;
        expires_at: string;
      }[]
    >(
      "scopepay_proposals?select=id,title,status,created_at,updated_at,expires_at&order=created_at.desc&limit=100"
    );

    return NextResponse.json({ proposals });
  } catch (error) {
    console.error("[ScopePay] List proposals error:", error);

    return NextResponse.json(
      { error: "Could not load proposals." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = proposalSchema.safeParse(body.proposal);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid proposal data.",
          issues: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const proposal = parsed.data;

    // Calculate totals from individual line items.
    const sumAmounts = (amounts: number[]) =>
      amounts.reduce((total, amount) => total + toMinorUnits(amount), 0);

    const pricingTotal = sumAmounts(
      proposal.pricingBreakdown.map((item) => item.amount)
    );

    const milestoneTotal = sumAmounts(
      proposal.milestones.map((milestone) => milestone.amount)
    );

    // Validate both totals against the proposed project total.
    if (
      pricingTotal !== toMinorUnits(proposal.estimatedTotal) ||
      milestoneTotal !== toMinorUnits(proposal.estimatedTotal)
    ) {
      return NextResponse.json(
        {
          error:
            "Pricing and milestone totals must equal the proposal total before sharing.",
          pricingTotal: pricingTotal / 100,
          milestoneTotal: milestoneTotal / 100,
          estimatedTotal: proposal.estimatedTotal,
        },
        { status: 422 }
      );
    }

    const token = createClientToken();
    const expiresAt = new Date(
      Date.now() + 30 * 86400000
    ).toISOString();

    const rows = await supabaseRequest<
      { id: string; status: string; expires_at: string }[]
    >("scopepay_proposals?select=id,status,expires_at", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        title: proposal.title,
        proposal,
        status: "pending_client",
        client_token_hash: hashClientToken(token),
        expires_at: expiresAt,
      }),
    });

    const row = rows[0];

    if (!row) {
      throw new Error("Database did not return the saved proposal.");
    }

    await supabaseRequest("scopepay_proposal_events", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        proposal_id: row.id,
        event_type: "shared",
        details: {
          channel: "share_link",
        },
      }),
    });

    const origin =
      process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

    return NextResponse.json({
      proposalId: row.id,
      status: row.status,
      clientUrl: `${origin}/proposal/${token}`,
      expiresAt: row.expires_at,
    });
  } catch (error) {
    console.error("Create proposal error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not share proposal.",
      },
      { status: 500 }
    );
  }
}
