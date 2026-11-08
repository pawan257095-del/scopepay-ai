import OpenAI from "openai";

export function getAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  return new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });
}

export const proposalSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    included: { type: "array", items: { type: "string" } },
    excluded: { type: "array", items: { type: "string" } },
    pricingBreakdown: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          item: { type: "string" },
          explanation: { type: "string" },
          amount: { type: "number" },
        },
        required: ["item", "explanation", "amount"],
      },
    },
    questions: { type: "array", items: { type: "string" } },
    deliverables: { type: "array", items: { type: "string" } },
    milestones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          amount: { type: "number" },
        },
        required: ["name", "description", "amount"],
      },
    },
    estimatedTotal: { type: "number" },
    currency: { type: "string" },
    timeline: { type: "string" },
  },
  required: [
    "title", "summary", "assumptions", "included", "excluded",
    "pricingBreakdown", "questions", "deliverables", "milestones",
    "estimatedTotal", "currency", "timeline",
  ],
} as const;
