
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashClientToken } from "@/lib/proposal-security";
import { supabaseRequest } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type Ctx = {
  params: Promise<{ token: string }>;
};

type ProposalRow = {
  id: string;
  title: string;
  proposal: unknown;
  status: string;
  expires_at: string;
  created_at: string;
  client_note: string | null;
  responded_at: string | null;
};

type PaymentRow = {
  milestone_index: number;
  status: "pending" | "paid" | "failed";
  amount: number;
  currency: string;
  paid_at: string | null;
  created_at: string;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
};

async function find(token: string) {
  const hash = hashClientToken(token);

  const rows = await supabaseRequest<ProposalRow[]>(
    `scopepay_proposals?select=id,title,proposal,status,expires_at,created_at,client_note,responded_at&client_token_hash=eq.${hash}&limit=1`
  );

  return rows[0] || null;
}

async function validateProposal(token: string) {
  if (!token || token.length < 30) {
    return null;
  }

  const row = await find(token);

  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }

  return row;
}

// GET: Load proposal and persistent payment statuses.
export async function GET(_r: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    const row = await validateProposal(token);

    if (!row) {
      return NextResponse.json(
        { error: "This proposal link is invalid or has expired." },
        { status: 404 }
      );
    }

    const payments = await supabaseRequest<PaymentRow[]>(
      `scopepay_payments?select=milestone_index,status,amount,currency,paid_at,created_at,paypal_order_id,paypal_capture_id&proposal_id=eq.${row.id}&order=milestone_index.asc,created_at.desc`
    );

    return NextResponse.json({
      proposal: row,
      payments,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load proposal.",
      },
      { status: 500 }
    );
  }
}

// POST: Client approves, rejects, or requests a revision.
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params;

    const parsed = z
      .object({
        action: z.enum(["approve", "request_revision", "reject"]),
        note: z.string().max(2000).optional().default(""),
      })
      .safeParse(await req.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid response." },
        { status: 400 }
      );
    }

    const { action, note } = parsed.data;

    if (action === "request_revision" && !note.trim()) {
      return NextResponse.json(
        { error: "Please describe the changes you need." },
        { status: 400 }
      );
    }

    const row = await validateProposal(token);

    if (!row) {
      return NextResponse.json(
        { error: "This proposal link is invalid or has expired." },
        { status: 404 }
      );
    }

    if (
      row.status !== "pending_client" &&
      row.status !== "revision_requested"
    ) {
      return NextResponse.json(
        {
          error: `This proposal is already ${row.status.replaceAll("_", " ")}.`,
        },
        { status: 409 }
      );
    }

    const status =
      action === "approve"
        ? "approved"
        : action === "reject"
          ? "rejected"
          : "revision_requested";

    const now = new Date().toISOString();
    const hash = hashClientToken(token);

    await supabaseRequest(
      `scopepay_proposals?id=eq.${row.id}&client_token_hash=eq.${hash}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status,
          client_note: note.trim() || null,
          responded_at: now,
          updated_at: now,
        }),
      }
    );

    await supabaseRequest("scopepay_proposal_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        proposal_id: row.id,
        event_type: status,
        details: { note: note.trim() || null },
      }),
    });

    return NextResponse.json({
      status,
      message:
        status === "approved"
          ? "Proposal approved. The freelancer can now review the approval and arrange the next step."
          : status === "rejected"
            ? "Proposal declined."
            : "Revision request sent.",
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not submit your response.",
      },
      { status: 500 }
    );
  }
}
