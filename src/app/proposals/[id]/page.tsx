"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

type ProposalData = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  expires_at: string;
  proposal: {
    summary: string;
    estimatedTotal: number;
    currency: string;
    timeline: string;
    assumptions: string[];
    included: string[];
    excluded: string[];
    deliverables: string[];
    questions: string[];
    pricingBreakdown: {
      item: string;
      explanation: string;
      amount: number;
    }[];
    milestones: {
      name: string;
      description: string;
      amount: number;
    }[];
  };
};

export default function ProposalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const { id } = await params;
        const response = await fetch(
          `/api/proposals/${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load proposal.");
        }

        if (active) setProposal(data.proposal);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Something went wrong.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [params]);

  if (loading) return <main style={{ padding: 32 }}>Loading proposal...</main>;

  if (error || !proposal) {
    return (
      <main style={{ padding: 32 }}>
        <p>{error || "Proposal not found."}</p>
        <Link href="/proposals">Back to proposals</Link>
      </main>
    );
  }

  const p = proposal.proposal;
  const money = (amount: number) =>
    `${p.currency} ${Number(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 32, color: "#f8fafc" }}>
      <Link href="/proposals" style={{ color: "#93c5fd", textDecoration: "none" }}>
        <ArrowLeft size={16} style={{ display: "inline", verticalAlign: "middle" }} />{" "}
        Back to Proposals
      </Link>

      <header style={{ marginTop: 28 }}>
        <p style={{ color: "#93c5fd" }}>{proposal.status.replaceAll("_", " ")}</p>
        <h1>{proposal.title}</h1>
        <p style={{ color: "#cbd5e1" }}>{p.summary}</p>
        <h2>{money(p.estimatedTotal)}</h2>
        <p>Timeline: {p.timeline}</p>
      </header>

      <section>
        <h2>Scope included</h2>
        <ul>{p.included?.map((item, i) => <li key={i}>{item}</li>)}</ul>

        <h2>Assumptions</h2>
        <ul>{p.assumptions?.map((item, i) => <li key={i}>{item}</li>)}</ul>

        <h2>Excluded</h2>
        <ul>{p.excluded?.map((item, i) => <li key={i}>{item}</li>)}</ul>

        <h2>Deliverables</h2>
        <ul>{p.deliverables?.map((item, i) => <li key={i}>{item}</li>)}</ul>

        <h2>Pricing breakdown</h2>
        {p.pricingBreakdown?.map((item, i) => (
          <div key={i} style={{ padding: 12, borderBottom: "1px solid #263449" }}>
            <strong>{item.item}</strong>
            <p>{item.explanation}</p>
            <b>{money(item.amount)}</b>
          </div>
        ))}

        <h2>Milestones</h2>
        {p.milestones?.map((item, i) => (
          <div key={i} style={{ padding: 12, borderBottom: "1px solid #263449" }}>
            <strong>{i + 1}. {item.name}</strong>
            <p>{item.description}</p>
            <b>{money(item.amount)}</b>
          </div>
        ))}

        <h2>Questions to clarify</h2>
        <ul>{p.questions?.map((item, i) => <li key={i}>{item}</li>)}</ul>
      </section>

      <p style={{ color: "#94a3b8", marginTop: 30 }}>
        Created: {new Date(proposal.created_at).toLocaleString()}
      </p>
    </main>
  );
}