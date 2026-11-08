
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Save,
  ShieldCheck,
  Sparkles,
  Wallet,
  Eye,
  Pencil,
  Send,
  Printer,
} from "lucide-react";
import { toMinorUnits } from "@/lib/money";

type Proposal = {
  title: string;
  summary: string;
  assumptions: string[];
  included: string[];
  excluded: string[];
  pricingBreakdown: {
    item: string;
    explanation: string;
    amount: number;
  }[];
  questions: string[];
  deliverables: string[];
  milestones: {
    name: string;
    description: string;
    amount: number;
  }[];
  estimatedTotal: number;
  currency: string;
  timeline: string;
};

type ProposalStatus =
  | "draft"
  | "ready_for_client"
  | "approved"
  | "revision_requested"
  | "rejected";

type SavedProposal = {
  proposal: Proposal;
  status: ProposalStatus;
  revisionComment: string;
  updatedAt: string;
};

const STORAGE_KEY = "scopepay.proposal.v1";

const sampleBrief =
  "I need a modern responsive website for my small consulting business. It should have a home page, services page, contact form, admin dashboard to manage leads, and PayPal payment integration for a paid consultation booking. I want it delivered in about four weeks.";

const statusLabels: Record<ProposalStatus, string> = {
  draft: "Draft",
  ready_for_client: "Ready for client",
  approved: "Approved (demo)",
  revision_requested: "Revision requested",
  rejected: "Rejected (demo)",
};

function money(currency: string, amount: number) {
  return `${currency} ${Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

export default function Home() {
  const [brief, setBrief] = useState(sampleBrief);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [status, setStatus] = useState<ProposalStatus>("draft");
  const [revisionComment, setRevisionComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [clientUrl, setClientUrl] = useState("");
  const [sharing, setSharing] = useState(false);

  // Restore the browser-only draft after mount to avoid a server/client mismatch.
  /* eslint-disable react-hooks/set-state-in-effect -- This effect hydrates localStorage after mount. */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (saved) {
        const data = JSON.parse(saved) as SavedProposal;

        if (data.proposal?.title && data.proposal?.milestones) {
          setProposal(data.proposal);
          setStatus(data.status || "draft");
          setRevisionComment(data.revisionComment || "");
        }
      }
    } catch {
      // Ignore corrupt browser-local draft.
    }

    setHydrated(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const totals = useMemo(() => {
    if (!proposal) {
      return { milestone: 0, pricing: 0 };
    }

    return {
      milestone: proposal.milestones.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
      pricing: proposal.pricingBreakdown.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
    };
  }, [proposal]);

  const validTotals =
    !!proposal &&
    toMinorUnits(totals.milestone) === toMinorUnits(proposal.estimatedTotal) &&
    toMinorUnits(totals.pricing) === toMinorUnits(proposal.estimatedTotal);

  async function generateProposal() {
    setBusy(true);
    setMessage("");
    setProposal(null);
    setStatus("draft");
    setEditMode(false);
    setPreviewMode(false);
    setClientUrl("");

    try {
      const response = await fetch("/api/ai/proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, currency: "USD" }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not generate proposal.");
      }

      setProposal(data.proposal);
      setMessage(
        "Proposal generated. Review and save your draft before sharing it."
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Something went wrong."
      );
    } finally {
      setBusy(false);
    }
  }

  function saveDraft() {
    if (!proposal) return;

    const record: SavedProposal = {
      proposal,
      status,
      revisionComment,
      updatedAt: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    setMessage("Draft saved in this browser on this device.");
  }

  async function shareWithClient() {
    if (!proposal || !validTotals) return;

    setSharing(true);
    setMessage("");

    try {
      const response = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposal }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not create client link.");
      }

      setClientUrl(data.clientUrl);
      setStatus("ready_for_client");
      setMessage(
        "A secure client proposal link has been created. Copy and send it to your client."
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not share proposal."
      );
    } finally {
      setSharing(false);
    }
  }

  function updateProposal<K extends keyof Proposal>(
    key: K,
    value: Proposal[K]
  ) {
    setProposal((current) =>
      current ? { ...current, [key]: value } : current
    );
  }

  function updatePricing(
    index: number,
    field: "item" | "explanation" | "amount",
    value: string
  ) {
    if (!proposal) return;

    const updated = proposal.pricingBreakdown.map((row, i) =>
      i === index
        ? {
            ...row,
            [field]: field === "amount" ? Number(value) : value,
          }
        : row
    );

    updateProposal("pricingBreakdown", updated);
  }

  function updateMilestone(
    index: number,
    field: "name" | "description" | "amount",
    value: string
  ) {
    if (!proposal) return;

    const updated = proposal.milestones.map((row, i) =>
      i === index
        ? {
            ...row,
            [field]: field === "amount" ? Number(value) : value,
          }
        : row
    );

    updateProposal("milestones", updated);
  }

  function setList(
    key:
      | "assumptions"
      | "included"
      | "excluded"
      | "deliverables"
      | "questions",
    value: string
  ) {
    updateProposal(key, lines(value));
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={19} />
          </div>
          <span>
            scopepay<span className="brand-ai">.ai</span>
          </span>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav>
          <Link href="/" className="nav-item active">
            <BriefcaseBusiness size={17} />
            Overview
          </Link>

          <Link href="/proposals" className="nav-item">
            <FileText size={17} />
            Proposals
          </Link>

          <Link href="/payments" className="nav-item">
            <Wallet size={17} />
            Payments
          </Link>
        </nav>

        <div className="sidebar-bottom">
          <div className="avatar">P</div>
          <div>
            <strong>Personal workspace</strong>
            <small>Free sandbox account</small>
          </div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div>
            <span className="crumb">Workspace</span>
            <span className="crumb-sep">/</span>
            <strong>Overview</strong>
          </div>

          <div className="sandbox">
            <span /> PAYPAL SANDBOX
          </div>
        </header>

        <div className="content">
          <div className="welcome-row">
            <div>
              <div className="eyebrow">YOUR BUSINESS, IN SYNC</div>
              <h1>
                Good work starts
                <br />
                with a clear scope.
              </h1>
              <p className="subhead">
                Turn client conversations into confident proposals and paid
                projects.
              </p>
            </div>

            <div className="welcome-icon">
              <Bot size={42} />
              <span className="spark-dot" />
            </div>
          </div>

          <div className="stats">
            <div className="stat-card">
              <div className="stat-label">PROPOSAL STATUS</div>
              <div className="stat-value">
                {proposal ? statusLabels[status] : "—"}
              </div>
              <div className="stat-foot">Current proposal workflow</div>
            </div>

            <div className="stat-card">
              <div className="stat-label">PROPOSED VALUE</div>
              <div className="stat-value">
                {proposal
                  ? money(proposal.currency, proposal.estimatedTotal)
                  : "—"}
              </div>
              <div className="stat-foot">
                AI estimate; review before sharing
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-label">DRAFT STORAGE</div>
              <div className="stat-value">
                {hydrated ? "Browser" : "Loading"}
              </div>
              <div className="stat-foot">Saved locally on this device</div>
            </div>
          </div>

          <div className="section-heading">
            <div>
              <h2>Start with a client brief</h2>
              <p>
                Paste a message, email, or project description. Your AI
                partner will structure the opportunity.
              </p>
            </div>

            <span className="ai-pill">
              <Sparkles size={13} /> AI WORKSPACE
            </span>
          </div>

          <div className="work-card">
            <div className="card-top">
              <div className="step-icon">
                <FileText size={18} />
              </div>
              <div>
                <strong>Client requirements</strong>
                <small>What does your client need?</small>
              </div>
              <span className="step-number">01 / 02</span>
            </div>

            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Paste your client's project request here..."
            />

            <div className="card-actions">
              <span className="privacy-note">
                <ShieldCheck size={14} /> Review before sharing or sending
              </span>

              <button
                className="primary-btn"
                onClick={generateProposal}
                disabled={busy || brief.trim().length < 30}
              >
                {busy ? (
                  "Analyzing brief..."
                ) : (
                  <>
                    Generate proposal <ArrowUpRight size={16} />
                  </>
                )}
              </button>
            </div>

            {message && <div className="notice">{message}</div>}
          </div>

          {proposal && (
            <div className="proposal-card">
              <div className="proposal-head">
                <div>
                  <span className="eyebrow">
                    {previewMode ? "CLIENT PREVIEW" : "PROPOSAL WORKSPACE"}
                  </span>

                  {editMode && !previewMode ? (
                    <input
                      className="edit-title"
                      value={proposal.title}
                      onChange={(e) =>
                        updateProposal("title", e.target.value)
                      }
                    />
                  ) : (
                    <h2>{proposal.title}</h2>
                  )}
                </div>

                <span className={`draft-pill status-${status}`}>
                  {statusLabels[status]}
                </span>
              </div>

              {editMode && !previewMode ? (
                <textarea
                  className="edit-summary"
                  value={proposal.summary}
                  onChange={(e) =>
                    updateProposal("summary", e.target.value)
                  }
                />
              ) : (
                <p>{proposal.summary}</p>
              )}

              {editMode && !previewMode && (
                <div className="edit-grid">
                  <label>
                    Timeline
                    <input
                      value={proposal.timeline}
                      onChange={(e) =>
                        updateProposal("timeline", e.target.value)
                      }
                    />
                  </label>

                  <label>
                    Project total ({proposal.currency})
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={proposal.estimatedTotal}
                      onChange={(e) =>
                        updateProposal(
                          "estimatedTotal",
                          Number(e.target.value)
                        )
                      }
                    />
                  </label>
                </div>
              )}

              {proposal.assumptions.length > 0 && (
                <>
                  <h3>Assumptions to confirm</h3>
                  {editMode && !previewMode ? (
                    <textarea
                      className="list-editor"
                      value={proposal.assumptions.join("\n")}
                      onChange={(e) =>
                        setList("assumptions", e.target.value)
                      }
                    />
                  ) : (
                    <ul>
                      {proposal.assumptions.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              <h3>Scope included</h3>
              {editMode && !previewMode ? (
                <textarea
                  className="list-editor"
                  value={proposal.included.join("\n")}
                  onChange={(e) => setList("included", e.target.value)}
                />
              ) : (
                <ul>
                  {proposal.included.map((item, i) => (
                    <li key={i}>
                      <CheckCircle2 size={15} />
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              {proposal.excluded.length > 0 && (
                <>
                  <h3>Not included in this estimate</h3>
                  {editMode && !previewMode ? (
                    <textarea
                      className="list-editor"
                      value={proposal.excluded.join("\n")}
                      onChange={(e) =>
                        setList("excluded", e.target.value)
                      }
                    />
                  ) : (
                    <ul>
                      {proposal.excluded.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              <div className="proposal-total">
                <div>
                  <small>PROPOSED PROJECT TOTAL</small>
                  <strong>
                    {money(proposal.currency, proposal.estimatedTotal)}
                  </strong>
                </div>

                <div className="timeline">
                  Estimated timeline
                  <br />
                  <b>{proposal.timeline}</b>
                </div>
              </div>

              <h3>Pricing breakdown</h3>
              <div className="pricing-list">
                {proposal.pricingBreakdown.map((item, i) => (
                  <div className="pricing-row" key={i}>
                    <div>
                      {editMode && !previewMode ? (
                        <>
                          <input
                            value={item.item}
                            onChange={(e) =>
                              updatePricing(i, "item", e.target.value)
                            }
                          />
                          <textarea
                            value={item.explanation}
                            onChange={(e) =>
                              updatePricing(
                                i,
                                "explanation",
                                e.target.value
                              )
                            }
                          />
                        </>
                      ) : (
                        <>
                          <strong>{item.item}</strong>
                          <small>{item.explanation}</small>
                        </>
                      )}
                    </div>

                    {editMode && !previewMode ? (
                      <input
                        className="amount-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.amount}
                        onChange={(e) =>
                          updatePricing(i, "amount", e.target.value)
                        }
                      />
                    ) : (
                      <b>{money(proposal.currency, item.amount)}</b>
                    )}
                  </div>
                ))}

                <div className="pricing-total">
                  <strong>Breakdown total</strong>
                  <strong>{money(proposal.currency, totals.pricing)}</strong>
                </div>
              </div>

              <h3>Deliverables</h3>
              {editMode && !previewMode ? (
                <textarea
                  className="list-editor"
                  value={proposal.deliverables.join("\n")}
                  onChange={(e) => setList("deliverables", e.target.value)}
                />
              ) : (
                <ul>
                  {proposal.deliverables.map((d, i) => (
                    <li key={i}>
                      <CheckCircle2 size={15} />
                      {d}
                    </li>
                  ))}
                </ul>
              )}

              <h3>Milestones</h3>
              <div className="milestones">
                {proposal.milestones.map((m, i) => (
                  <div key={i}>
                    {editMode && !previewMode ? (
                      <>
                        <input
                          value={m.name}
                          onChange={(e) =>
                            updateMilestone(i, "name", e.target.value)
                          }
                        />
                        <textarea
                          value={m.description}
                          onChange={(e) =>
                            updateMilestone(
                              i,
                              "description",
                              e.target.value
                            )
                          }
                        />
                        <input
                          className="amount-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={m.amount}
                          onChange={(e) =>
                            updateMilestone(i, "amount", e.target.value)
                          }
                        />
                      </>
                    ) : (
                      <>
                        <span>{m.name}</span>
                        <b>{money(proposal.currency, m.amount)}</b>
                        <small>{m.description}</small>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="validation-row">
                <span className={validTotals ? "valid" : "invalid"}>
                  {validTotals
                    ? "✓ Pricing and milestone totals match"
                    : "! Totals do not match the proposed project total"}
                </span>

                <span>
                  Milestones: {money(proposal.currency, totals.milestone)}
                </span>
              </div>

              {proposal.questions.length > 0 && (
                <>
                  <h3>Questions to clarify</h3>
                  {editMode && !previewMode ? (
                    <textarea
                      className="list-editor"
                      value={proposal.questions.join("\n")}
                      onChange={(e) =>
                        setList("questions", e.target.value)
                      }
                    />
                  ) : (
                    <ul>
                      {proposal.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {!previewMode && (
                <div className="revision-box">
                  <label htmlFor="revision">
                    Revision request / internal note
                  </label>

                  <textarea
                    id="revision"
                    value={revisionComment}
                    onChange={(e) => setRevisionComment(e.target.value)}
                    placeholder="Record requested changes or feedback here..."
                  />

                  <small>
                    Demo workflow only: this note is stored in this browser
                    and is not sent to a client.
                  </small>
                </div>
              )}

              <div className="workflow-actions">
                {!previewMode && (
                  <button
                    className="secondary-btn"
                    onClick={() => setEditMode(!editMode)}
                  >
                    <Pencil size={14} />
                    {editMode ? "Finish editing" : "Edit proposal"}
                  </button>
                )}

                {!previewMode && (
                  <button className="secondary-btn" onClick={saveDraft}>
                    <Save size={14} />
                    Save draft
                  </button>
                )}

                {!previewMode && (
                  <button
                    className="secondary-btn"
                    onClick={() => setPreviewMode(true)}
                  >
                    <Eye size={14} />
                    Client preview
                  </button>
                )}

                {previewMode && (
                  <button
                    className="secondary-btn"
                    onClick={() => setPreviewMode(false)}
                  >
                    <Pencil size={14} />
                    Back to editor
                  </button>
                )}

                {previewMode && (
                  <button
                    className="secondary-btn"
                    onClick={() => window.print()}
                  >
                    <Printer size={14} />
                    Print / PDF
                  </button>
                )}

                {!previewMode && (
                  <button
                    className="primary-btn"
                    disabled={
                      !validTotals ||
                      !proposal.title.trim() ||
                      sharing
                    }
                    onClick={shareWithClient}
                  >
                    <Send size={14} />
                    {sharing
                      ? "Creating secure link…"
                      : "Create client approval link"}
                  </button>
                )}
              </div>

              {clientUrl && !previewMode && (
                <div className="share-link-box">
                  <strong>Client approval link</strong>

                  <input
                    readOnly
                    value={clientUrl}
                    onFocus={(e) => e.currentTarget.select()}
                  />

                  <button
                    className="secondary-btn"
                    onClick={() =>
                      navigator.clipboard.writeText(clientUrl)
                    }
                  >
                    Copy link
                  </button>

                  <small>
                    Anyone with this unique link can view and respond to this
                    proposal. Treat it like a password.
                  </small>
                </div>
              )}

              <div className="approval-note">
                <ShieldCheck size={16} />
                {previewMode
                  ? "Client preview only. Approval and payment are not connected in this phase."
                  : "Client responses are collected through a unique link and stored in your database. Approval does not automatically charge a payment."}
              </div>
            </div>
          )}

          <div className="bottom-note">
            <CircleDollarSign size={16} />
            Payments are processed through PayPal sandbox. No real money is
            moved in this demo.
          </div>
        </div>
      </section>
    </main>
  );
}
