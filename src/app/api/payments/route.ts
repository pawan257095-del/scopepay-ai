import { NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type PaymentRow = {
  id: string;
  proposal_id: string;
  milestone_index: number;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed";
  created_at: string;
  updated_at: string;
  paid_at: string | null;
};

type ProposalRow = {
  id: string;
  title: string;
  proposal: {
    milestones?: { name?: string }[];
  };
};

export async function GET() {
  try {
    const payments = await supabaseRequest<PaymentRow[]>(
      "scopepay_payments?select=id,proposal_id,milestone_index,amount,currency,status,created_at,updated_at,paid_at&order=created_at.desc&limit=100"
    );

    if (payments.length === 0) return NextResponse.json({ payments: [] });

    const proposalIds = [...new Set(payments.map((payment) => payment.proposal_id))];
    if (proposalIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
      throw new Error("Payment records contain an invalid proposal reference.");
    }

    const proposals = await supabaseRequest<ProposalRow[]>(
      `scopepay_proposals?select=id,title,proposal&id=in.(${proposalIds.join(",")})`
    );
    const proposalMap = new Map(proposals.map((proposal) => [proposal.id, proposal]));

    return NextResponse.json({
      payments: payments.map((payment) => {
        const proposal = proposalMap.get(payment.proposal_id);
        const milestone = proposal?.proposal?.milestones?.[payment.milestone_index];
        return {
          id: payment.id,
          proposalId: payment.proposal_id,
          proposalTitle: proposal?.title || "Proposal",
          milestoneName: milestone?.name || `Milestone ${payment.milestone_index + 1}`,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          createdAt: payment.created_at,
          paidAt: payment.paid_at,
        };
      }),
    });
  } catch (error) {
    console.error("[ScopePay] List payments error:", error);
    return NextResponse.json({ error: "Could not load payments." }, { status: 500 });
  }
}
