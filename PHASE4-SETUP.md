# ScopePay AI — Phase 4: Persistent proposals & client approval

## What this phase adds
- Supabase Postgres persistence for proposals and response events.
- Unique 256-bit client link tokens. Only SHA-256 token hashes are stored in the database.
- Client-facing proposal page at `/proposal/[token]`.
- Client actions: approve, request revision (comment required), or decline.
- Server-side status checks, expiry checks (30 days), and event logging.
- Server-side validation that pricing and milestone totals equal the proposal total before a client link is created.

## 1. Create/configure Supabase
1. Create a Supabase project at https://supabase.com/dashboard.
2. Open SQL Editor, create a new query, paste `supabase/phase4-schema.sql`, and run it.
3. Open Project Settings → API. Copy the Project URL and `service_role` key. Keep the service-role key private.
4. Add these lines to the existing `.env.local` (do not replace your existing Gemini or PayPal values):

```env
SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Never use the `service_role` key in a `NEXT_PUBLIC_` variable or frontend code. Do not paste it into chat or commit `.env.local` to Git.

## 2. Install and run

```powershell
npm.cmd install --legacy-peer-deps
npm.cmd run build
npm.cmd run dev
```

## 3. Test the client workflow
1. Generate a proposal.
2. Ensure pricing breakdown and milestone totals both equal the project total.
3. Click **Create client approval link**.
4. Copy the generated link and open it in an incognito/private browser window (or another device).
5. Test approval, revision request, and decline. A revision request requires a comment.
6. Verify rows in `scopepay_proposals` and `scopepay_proposal_events` in Supabase Table Editor.

## Phase 5: milestone payments

The current source bundle also includes the PayPal sandbox milestone checkout and webhook. After applying the Phase 4 migration above, apply `supabase/phase5-payments-schema.sql`, configure `PAYPAL_WEBHOOK_ID`, and expose `/api/paypal/webhook` through an HTTPS development tunnel or deployment. Subscribe the PayPal webhook to `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.COMPLETED`, and `PAYMENT.CAPTURE.DENIED`. A pending capture is not treated as paid; the payment becomes paid only after PayPal sends a verified completed event.

## Security and scope notes
- A client link is a bearer credential: anyone who possesses it can view/respond. Share it privately and do not publish it.
- Tokens expire after 30 days. Only a hash is stored in Postgres.
- This is a genuine link-based response flow, but it is not yet account-based identity verification, e-signature, or a legally qualified signature.
- The freelancer dashboard currently creates and displays the share link; an authenticated owner dashboard, proposal list, resend/revoke controls, and email delivery are follow-on work.
- Approval records the client's response. PayPal checkout is available only after approval and derives the price from the stored milestone. Captures are checked against PayPal's returned capture details.
- The dashboard currently has no owner sign-in. Keep it private and use sandbox credentials until authentication and authorization are implemented.
