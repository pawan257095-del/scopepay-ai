"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, FileText, RefreshCw, Sparkles, Wallet } from "lucide-react";

type Payment = {
  id: string;
  proposalId: string;
  proposalTitle: string;
  milestoneName: string;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed";
  createdAt: string;
  paidAt: string | null;
};

const money = (currency: string, amount: number) =>
  `${currency} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPayments = useCallback(async () => {
    try {
      const response = await fetch("/api/payments", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load payments.");
      setPayments(data.payments || []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load payments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  function refreshPayments() {
    setLoading(true);
    setError("");
    void loadPayments();
  }

  const paidTotals = useMemo(
    () => payments.filter((payment) => payment.status === "paid").reduce<Record<string, number>>((totals, payment) => {
      totals[payment.currency] = (totals[payment.currency] || 0) + payment.amount;
      return totals;
    }, {}),
    [payments]
  );
  const pendingCount = payments.filter((payment) => payment.status === "pending").length;

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Sparkles size={19} /></div><span>scopepay<span className="brand-ai">.ai</span></span></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          <Link href="/" className="nav-item"><BriefcaseBusiness size={17} />Overview</Link>
          <Link href="/proposals" className="nav-item"><FileText size={17} />Proposals</Link>
          <Link href="/payments" className="nav-item active"><Wallet size={17} />Payments</Link>
        </nav>
        <div className="sidebar-bottom"><div className="avatar">P</div><div><strong>Personal workspace</strong><small>Free sandbox account</small></div></div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div><span className="crumb">Workspace</span><span className="crumb-sep">/</span><strong>Payments</strong></div>
          <div className="sandbox"><span /> PAYPAL SANDBOX</div>
        </header>
        <div className="content">
          <div className="page-title-row">
            <div><div className="eyebrow">PAYMENT ACTIVITY</div><h1>Milestone payments</h1><p>Review sandbox payment attempts across shared proposals.</p></div>
            <button className="secondary-btn" onClick={refreshPayments} disabled={loading}><RefreshCw size={15} />Refresh</button>
          </div>

          <div className="payment-stats">
            <div className="stat-card"><div className="stat-label">RECORDED PAYMENTS</div><div className="stat-value">{payments.length}</div><div className="stat-foot">Latest 100 records</div></div>
            <div className="stat-card"><div className="stat-label">PAID MILESTONES</div><div className="stat-value">{Object.keys(paidTotals).length ? Object.entries(paidTotals).map(([currency, total]) => money(currency, total)).join(" · ") : money("USD", 0)}</div><div className="stat-foot">Sandbox captures recorded</div></div>
            <div className="stat-card"><div className="stat-label">PENDING</div><div className="stat-value">{pendingCount}</div><div className="stat-foot">Awaiting payment confirmation</div></div>
          </div>

          {loading && <div className="empty-state">Loading payment history…</div>}
          {error && <div className="notice">{error} Check that the Supabase payment schema has been applied.</div>}
          {!loading && !error && payments.length === 0 && <div className="empty-state">No milestone payments yet. Payments appear after a client starts checkout from an approved proposal.</div>}

          {!loading && !error && payments.length > 0 && (
            <div className="payment-list">
              {payments.map((payment) => (
                <article className="payment-card" key={payment.id}>
                  <div className="payment-main">
                    <div className="step-icon"><Wallet size={18} /></div>
                    <div><strong>{payment.milestoneName}</strong><Link href={`/proposals/${payment.proposalId}`}>{payment.proposalTitle}</Link></div>
                  </div>
                  <div className="payment-meta"><strong>{money(payment.currency, payment.amount)}</strong><span>{new Date(payment.paidAt || payment.createdAt).toLocaleString()}</span></div>
                  <span className={`payment-status payment-status-${payment.status}`}>{payment.status}</span>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
