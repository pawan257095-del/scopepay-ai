
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ShieldCheck,
  RotateCcw,
  XCircle,
  CreditCard,
  Loader2,
} from "lucide-react";

type Milestone = {
  name: string;
  description: string;
  amount: number;
};

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
  milestones: Milestone[];
  estimatedTotal: number;
  currency: string;
  timeline: string;
};

type PaymentRecord = {
  milestone_index: number;
  status: "pending" | "paid" | "failed";
  amount: number;
  currency: string;
  paid_at: string | null;
  created_at: string;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
};

type RecordData = {
  proposal: Proposal;
  status: string;
  payments: PaymentRecord[];
  expires_at: string;
  client_note?: string | null;
};

const cash = (currency: string, n: number) =>
  `${currency} ${Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function getMilestonePayment(
  payments: PaymentRecord[],
  milestoneIndex: number
) {
  const attempts = payments
    .filter((payment) => payment.milestone_index === milestoneIndex)
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime()
    );

  // Any paid/pending attempt blocks another checkout. If every attempt failed,
  // show the newest one so a retry is available.
  return (
    attempts.find((payment) => payment.status === "paid") ??
    attempts.find((payment) => payment.status === "pending") ??
    attempts[0]
  );
}

export default function ClientProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [token, setToken] = useState("");
  const [record, setRecord] = useState<RecordData | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [payingIndex, setPayingIndex] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // Resolve the secure proposal token.
  useEffect(() => {
    params.then((p) => setToken(p.token));
  }, [params]);

  // Load proposal and payment history from Supabase.
  const refreshProposal = useCallback(async () => {
    const response = await fetch(`/api/client/${token}`, {
      cache: "no-store",
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load proposal.");
    }

    const updatedRecord: RecordData = {
      ...data.proposal,
      payments: data.payments ?? [],
    };

    setRecord(updatedRecord);
    return updatedRecord;
  }, [token]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function loadProposal() {
      try {
        const response = await fetch(`/api/client/${token}`, {
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load proposal.");
        }

        if (!cancelled) {
          setRecord({
            ...data.proposal,
            payments: data.payments ?? [],
          });
        }
      } catch (e) {
        if (!cancelled) {
          setMessage("");
          setError(
            e instanceof Error
              ? e.message
              : "Could not load proposal."
          );
        }
      }
    }

    loadProposal();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // PayPal returns the buyer with the PayPal order ID in ?token=...
  /* eslint-disable react-hooks/set-state-in-effect -- This effect syncs PayPal's browser redirect with payment UI state. */
  useEffect(() => {
    if (!token) return;

    const query = new URLSearchParams(window.location.search);
    const paymentStatus = query.get("payment");

    // Handle a cancelled PayPal checkout.
    if (paymentStatus === "cancelled") {
      const storedIndex = sessionStorage.getItem("scopepay_pending_milestone");
      const milestoneIndex = storedIndex === null ? null : Number(storedIndex);
      const orderId = query.get("token") || sessionStorage.getItem("scopepay_pending_order");

      async function recordCancellation() {
        try {
          if (milestoneIndex !== null && Number.isInteger(milestoneIndex) && milestoneIndex >= 0) {
            const response = await fetch("/api/paypal/cancel-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token, milestoneIndex, ...(orderId ? { orderId } : {}) }),
            });
            const data = await response.json();

            if (response.status === 202 && data.reconcileRequired) {
              const captureOrderId = data.orderId || orderId;
              if (!captureOrderId) {
                throw new Error("PayPal is processing this payment, but its order ID could not be loaded. Do not pay this milestone again.");
              }

              const statusResponse = await fetch("/api/paypal/capture-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, orderId: captureOrderId }),
              });
              const statusData = await statusResponse.json();
              await refreshProposal();

              if (statusResponse.status === 202) {
                setMessage(statusData.error || data.error || "PayPal is still processing this payment. Do not pay this milestone again.");
                return;
              }

              if (!statusResponse.ok) {
                throw new Error(statusData.error || "Could not refresh the PayPal payment status.");
              }

              setMessage(`Payment successful! ${cash(statusData.currency, statusData.amount)} received for this milestone.`);
              sessionStorage.removeItem("scopepay_pending_milestone");
              sessionStorage.removeItem("scopepay_pending_order");
              window.history.replaceState({}, "", window.location.pathname);
              return;
            }

            if (!response.ok) throw new Error(data.error || "Could not confirm the cancelled payment.");
          }

          await refreshProposal();
          setMessage("PayPal checkout was not completed. You can retry this milestone.");
          sessionStorage.removeItem("scopepay_pending_milestone");
          sessionStorage.removeItem("scopepay_pending_order");
          window.history.replaceState({}, "", window.location.pathname);
        } catch (e) {
          try {
            await refreshProposal();
          } catch {
            // Preserve the cancellation or payment-status error.
          }
          setMessage("");
          setError(e instanceof Error ? e.message : "Could not confirm the cancelled payment.");
        }
      }

      void recordCancellation();
      return;
    }

    if (paymentStatus !== "success") return;

    const orderId = query.get("token");
    const storedIndex = sessionStorage.getItem(
      "scopepay_pending_milestone"
    );

    const milestoneIndex =
      storedIndex === null ? null : Number(storedIndex);

    if (
      !orderId ||
      milestoneIndex === null ||
      !Number.isInteger(milestoneIndex) ||
      milestoneIndex < 0
    ) {
      setError(
        "Payment return details are incomplete. Contact the freelancer before retrying."
      );
      return;
    }

    let cancelled = false;

    async function capturePayment() {
      setBusy(true);
      setError("");
      setMessage("Verifying your PayPal payment...");

      try {
        const response = await fetch(
          "/api/paypal/capture-order",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              token,
              orderId,
            }),
          }
        );

        const data = await response.json();

        if (response.status === 202) {
          if (cancelled) return;
          await refreshProposal();
          setMessage(data.error || "PayPal is still processing this payment.");
          return;
        }

        if (!response.ok) {
          throw new Error(
            data.error || "Payment verification failed."
          );
        }

        if (cancelled) return;

        // Reload the authoritative payment history from Supabase.
        const refreshResponse = await fetch(
          `/api/client/${token}`,
          {
            cache: "no-store",
          }
        );

        const refreshedData = await refreshResponse.json();

        if (!refreshResponse.ok) {
          throw new Error(
            refreshedData.error ||
              "Payment succeeded, but payment status could not be refreshed."
          );
        }

        if (cancelled) return;

        setRecord({
          ...refreshedData.proposal,
          payments: refreshedData.payments ?? [],
        });

        setMessage(
          `Payment successful! ${cash(
            data.currency,
            data.amount
          )} received for this milestone.`
        );

        sessionStorage.removeItem(
          "scopepay_pending_milestone"
        );
        sessionStorage.removeItem("scopepay_pending_order");

        // Remove PayPal return parameters.
        window.history.replaceState(
          {},
          "",
          window.location.pathname
        );
      } catch (e) {
        if (!cancelled) {
          setMessage("");
          setError(
            e instanceof Error
              ? e.message
              : "Payment verification failed."
          );
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    capturePayment();

    return () => {
      cancelled = true;
    };
  }, [token, refreshProposal]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Client proposal response.
  async function respond(
    action: "approve" | "request_revision" | "reject"
  ) {
    setBusy(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch(`/api/client/${token}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          note,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not submit response.");
      }

      setMessage(data.message);

      setRecord((current) =>
        current
          ? {
              ...current,
              status: data.status,
              client_note: note,
            }
          : current
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not submit response."
      );
    } finally {
      setBusy(false);
    }
  }

  // Start PayPal checkout for a milestone.
  async function payMilestone(index: number) {
    if (!record || record.status !== "approved") return;

    const existingPayment = getMilestonePayment(record.payments, index);

    if (
      existingPayment?.status === "paid" ||
      existingPayment?.status === "pending"
    ) {
      setError(
        "A payment already exists for this milestone. Refresh the page to check its status."
      );
      return;
    }

    setPayingIndex(index);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        "/api/paypal/create-order",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token,
            milestoneIndex: index,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not start payment."
        );
      }

      if (!data.approvalUrl) {
        throw new Error(
          "PayPal did not return a checkout URL."
        );
      }

      sessionStorage.setItem(
        "scopepay_pending_milestone",
        String(index)
      );
      sessionStorage.setItem("scopepay_pending_order", data.orderId);

      // Redirect to PayPal's hosted checkout.
      window.location.assign(data.approvalUrl);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not start payment."
      );

      setPayingIndex(null);

      // Refresh in case an order was created before an error.
      try {
        await refreshProposal();
      } catch {
        // Preserve the original checkout error.
      }
    }
  }

  async function checkPendingPayment(index: number, payment: PaymentRecord) {
    if (!payment.paypal_order_id || !payment.paypal_capture_id) return;

    setPayingIndex(index);
    setBusy(true);
    setError("");
    setMessage("Checking the PayPal payment status...");

    try {
      const response = await fetch("/api/paypal/capture-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, orderId: payment.paypal_order_id }),
      });
      const data = await response.json();

      await refreshProposal();

      if (response.status === 202) {
        setMessage(data.error || "PayPal is still processing this payment. Do not pay this milestone again.");
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "Could not refresh the PayPal payment status.");
      }

      setMessage(`Payment successful! ${cash(data.currency, data.amount)} received for this milestone.`);
    } catch (e) {
      try {
        await refreshProposal();
      } catch {
        // Keep the original status-check error visible.
      }
      setMessage("");
      setError(e instanceof Error ? e.message : "Could not refresh the PayPal payment status.");
    } finally {
      setBusy(false);
      setPayingIndex(null);
    }
  }

  if (error && !record) {
    return (
      <main className="client-shell">
        <section className="client-panel">
          <h1>Proposal unavailable</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (!record) {
    return (
      <main className="client-shell">
        <section className="client-panel">
          <p>Loading secure proposal...</p>
        </section>
      </main>
    );
  }

  const p = record.proposal;

  const canRespond =
    record.status === "pending_client" ||
    record.status === "revision_requested";

  return (
    <main className="client-shell">
      <section className="client-panel">
        <div className="client-brand">
          SCOPEPAY<span>.AI</span>
        </div>

        <div className="client-eyebrow">
          PROJECT PROPOSAL
        </div>

        <div className="client-status">
          {record.status.replaceAll("_", " ")}
        </div>

        <h1>{p.title}</h1>
        <p className="client-summary">{p.summary}</p>

        <div className="client-total">
          <div>
            <small>PROPOSED PROJECT TOTAL</small>
            <strong>
              {cash(p.currency, p.estimatedTotal)}
            </strong>
          </div>

          <div>
            <small>ESTIMATED TIMELINE</small>
            <b>{p.timeline}</b>
          </div>
        </div>

        <h2>Deliverables</h2>
        <ul>
          {p.deliverables.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>

        <h2>Scope included</h2>
        <ul>
          {p.included.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>

        {p.excluded.length > 0 && (
          <>
            <h2>Not included</h2>
            <ul>
              {p.excluded.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </>
        )}

        {p.assumptions.length > 0 && (
          <>
            <h2>Assumptions to confirm</h2>
            <ul>
              {p.assumptions.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </>
        )}

        <h2>Pricing breakdown</h2>

        {p.pricingBreakdown.map((item, index) => (
          <div className="client-row" key={index}>
            <div>
              <b>{item.item}</b>
              <small>{item.explanation}</small>
            </div>

            <strong>
              {cash(p.currency, item.amount)}
            </strong>
          </div>
        ))}

        <h2>Milestones</h2>

        {p.milestones.map((milestone, index) => (
          <div className="client-row" key={index}>
            <div>
              <b>{milestone.name}</b>
              <small>{milestone.description}</small>
            </div>

            <strong>
              {cash(p.currency, milestone.amount)}
            </strong>
          </div>
        ))}

        {p.questions.length > 0 && (
          <>
            <h2>Questions to clarify</h2>
            <ul>
              {p.questions.map((question, index) => (
                <li key={index}>{question}</li>
              ))}
            </ul>
          </>
        )}

        {/* Client approval and revision controls */}
        {canRespond && (
          <div className="client-response">
            <h2>Your response</h2>

            <label htmlFor="client-note">
              Comment (required for revision requests; optional otherwise)
            </label>

            <textarea
              id="client-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a comment or describe requested changes..."
            />

            <div className="client-buttons">
              <button
                disabled={busy}
                onClick={() => respond("approve")}
              >
                <CheckCircle2 size={16} />
                Approve proposal
              </button>

              <button
                disabled={busy || !note.trim()}
                onClick={() => respond("request_revision")}
              >
                <RotateCcw size={16} />
                Request revision
              </button>

              <button
                disabled={busy}
                onClick={() => respond("reject")}
              >
                <XCircle size={16} />
                Decline
              </button>
            </div>
          </div>
        )}

        {/* Persistent milestone payment status from Supabase */}
        {record.status === "approved" && (
          <div className="client-response">
            <h2>Milestone payments</h2>

            <p>
              Your proposal is approved. Pay each milestone
              securely through PayPal.
            </p>

            {p.milestones.map((milestone, index) => {
              const payment = getMilestonePayment(record.payments, index);

              const paid = payment?.status === "paid";
              const pending = payment?.status === "pending";
              const failed = payment?.status === "failed";

              return (
                <div className="client-row" key={index}>
                  <div>
                    <b>{milestone.name}</b>

                    <small>{milestone.description}</small>

                    <strong>
                      {cash(p.currency, milestone.amount)}
                    </strong>

                    {paid && payment?.paid_at && (
                      <small>
                        Paid on{" "}
                        {new Date(
                          payment.paid_at
                        ).toLocaleDateString()}
                      </small>
                    )}
                  </div>

                  {paid ? (
                    <span>
                      <CheckCircle2 size={16} />
                      Paid
                    </span>
                  ) : pending ? (
                    <div>
                      <span>Payment pending</span>
                      {payment?.paypal_order_id && payment.paypal_capture_id && (
                        <div className="client-buttons">
                          <button
                            disabled={busy || payingIndex !== null}
                            onClick={() => checkPendingPayment(index, payment)}
                          >
                            {payingIndex === index ? <Loader2 size={16} /> : <RotateCcw size={16} />}
                            Check status
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      {failed && (
                        <small>Previous attempt failed</small>
                      )}

                      <button
                        disabled={
                          busy || payingIndex !== null
                        }
                        onClick={() => payMilestone(index)}
                      >
                        {payingIndex === index ? (
                          <Loader2 size={16} />
                        ) : (
                          <CreditCard size={16} />
                        )}

                        Pay now
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {message && (
          <div className="client-message">{message}</div>
        )}

        {error && (
          <div className="client-error">{error}</div>
        )}

        <div className="client-foot">
          <ShieldCheck size={16} />

          Secure, unique proposal link. Expires{" "}
          {new Date(
            record.expires_at
          ).toLocaleDateString()}.
        </div>
      </section>
    </main>
  );
}
