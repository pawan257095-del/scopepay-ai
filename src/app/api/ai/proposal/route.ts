import { NextResponse } from "next/server";
import { z } from "zod";
import { getAIClient, proposalSchema } from "@/lib/ai";
import { hasAtMostTwoDecimalPlaces, toMinorUnits } from "@/lib/money";

const inputSchema = z.object({
  brief: z.string().trim().min(30, "Please provide at least 30 characters of project details.").max(8000),
  currency: z.string().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).default("USD"),
  hourlyRate: z.number().positive().max(100000).optional(),
});

const proposalValidator = z.object({
  title: z.string().min(3),
  summary: z.string().min(10),
  assumptions: z.array(z.string()),
  included: z.array(z.string()),
  excluded: z.array(z.string()),
  pricingBreakdown: z.array(z.object({ item: z.string(), explanation: z.string(), amount: z.number().nonnegative().refine(hasAtMostTwoDecimalPlaces) })),
  questions: z.array(z.string()),
  deliverables: z.array(z.string()).min(1),
  milestones: z.array(z.object({ name: z.string(), description: z.string(), amount: z.number().nonnegative().refine(hasAtMostTwoDecimalPlaces) })).min(1),
  estimatedTotal: z.number().positive().refine(hasAtMostTwoDecimalPlaces),
  currency: z.string().length(3),
  timeline: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request." }, { status: 400 });
    }

    const { brief, currency, hourlyRate } = parsed.data;
    const client = getAIClient();
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: [
            "You are ScopePay, a careful freelance project-scoping assistant.",
            "Create a realistic draft proposal using only facts in the client brief.",
            "Never present an assumption as a confirmed client requirement.",
            "List assumptions explicitly; list unresolved decisions as questions.",
            "Separate included scope from excluded or not-yet-agreed scope.",
            "Provide a transparent pricingBreakdown whose amounts add up exactly to estimatedTotal.",
            "Split the project into practical milestones whose amounts add up exactly to estimatedTotal.",
            "Use numeric amounts in the requested currency, rounded to two decimal places.",
            "Do not promise integrations, hosting, content, revisions, or third-party costs unless stated or clearly marked as assumptions.",
            "Estimates are not guarantees. Return only data matching the requested JSON schema.",
          ].join(" "),
        },
        {
          role: "user",
          content: `Draft a freelance project proposal. Currency: ${currency}. ${hourlyRate ? `Indicative hourly rate: ${hourlyRate} ${currency}.` : "Choose a defensible fixed-price estimate and explain the cost drivers in pricingBreakdown."}\n\nCLIENT BRIEF:\n${brief}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "scopepay_proposal", strict: true, schema: proposalSchema },
      },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("The AI provider returned an empty proposal.");

    let raw: unknown;
    try { raw = JSON.parse(content); }
    catch { throw new Error("The AI provider returned invalid JSON. Please try again."); }

    const checked = proposalValidator.safeParse(raw);
    if (!checked.success) {
      console.error("SCOPEPAY_INVALID_PROPOSAL:", checked.error.flatten());
      return NextResponse.json({ error: "The AI returned an incomplete proposal. Please generate it again." }, { status: 502 });
    }

    const proposal = checked.data;
    const milestoneTotal = proposal.milestones.reduce((sum, milestone) => sum + toMinorUnits(milestone.amount), 0);
    const pricingTotal = proposal.pricingBreakdown.reduce((sum, item) => sum + toMinorUnits(item.amount), 0);
    const estimatedTotal = toMinorUnits(proposal.estimatedTotal);

    if (milestoneTotal !== estimatedTotal) {
      return NextResponse.json({ error: "Milestone amounts do not match the proposed total. Please regenerate the proposal." }, { status: 502 });
    }
    if (pricingTotal !== estimatedTotal) {
      return NextResponse.json({ error: "Pricing breakdown does not match the proposed total. Please regenerate the proposal." }, { status: 502 });
    }

    return NextResponse.json({ proposal });
  } catch (error) {
    console.error("SCOPEPAY_PROPOSAL_ERROR:", error);
    const message = error instanceof Error ? error.message : "Proposal generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
