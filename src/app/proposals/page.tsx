"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileText, RefreshCw } from "lucide-react";

type ProposalItem = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export default function ProposalsPage() {
  const [proposals, setProposals] = useState<ProposalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProposals = useCallback(async () => {
    try {
      const response = await fetch("/api/proposals", {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load proposals.");
      }

      setProposals(data.proposals || []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  function refreshProposals() {
    setLoading(true);
    setError("");
    void loadProposals();
  }

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 32, color: "#f8fafc" }}>
      <Link href="/" style={{ color: "#93c5fd", textDecoration: "none" }}>
        <ArrowLeft size={16} style={{ display: "inline", verticalAlign: "middle" }} />{" "}
        Back to Overview
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 30 }}>
        <div>
          <h1>Proposals</h1>
          <p style={{ color: "#94a3b8" }}>Manage your saved client proposals.</p>
        </div>

        <button onClick={refreshProposals} disabled={loading}>
          <RefreshCw size={15} style={{ display: "inline" }} /> Refresh
        </button>
      </div>

      {loading && <p>Loading proposals...</p>}

      {error && <p style={{ color: "#fca5a5" }}>{error}</p>}

      {!loading && !error && proposals.length === 0 && (
        <p>No shared proposals found yet. Create a proposal and share it with a client.</p>
      )}

      <div style={{ display: "grid", gap: 14, marginTop: 24 }}>
        {proposals.map((item) => (
          <Link
            key={item.id}
            href={`/proposals/${item.id}`}
            style={{
              display: "block",
              padding: 22,
              border: "1px solid #263449",
              borderRadius: 14,
              background: "#111827",
              color: "white",
              textDecoration: "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div>
                <h3 style={{ margin: "0 0 10px" }}>
                  <FileText size={17} style={{ display: "inline", verticalAlign: "middle" }} />{" "}
                  {item.title}
                </h3>
                <small style={{ color: "#94a3b8" }}>
                  Created: {new Date(item.created_at).toLocaleString()}
                </small>
              </div>

              <span style={{ color: "#93c5fd" }}>{item.status.replaceAll("_", " ")}</span>
            </div>
            <p style={{ color: "#60a5fa", marginBottom: 0 }}>Open proposal →</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
