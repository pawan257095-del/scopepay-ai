# ScopePay AI

ScopePay turns a client brief into an editable proposal, shares it through a private client link, records client approval, and supports PayPal sandbox payments for individual milestones.

## Implemented workflow

1. Draft a proposal with an OpenAI-compatible AI endpoint.
2. Review and edit scope, pricing, deliverables, and milestones.
3. Save a local browser draft or create a client approval link.
4. Let the client approve, decline, or request a revision.
5. After approval, let the client pay milestones through PayPal sandbox.
6. Verify captures in the server route and reconcile completed captures through a signed PayPal webhook.
7. Review saved proposals and payment history in the dashboard.

## Requirements

- Node.js 20.9 or newer.
- An OpenAI-compatible AI provider key.
- A Supabase project.
- PayPal sandbox REST app credentials.
- A publicly reachable HTTPS webhook URL for end-to-end webhook delivery.

## Setup

1. Copy `.env.example` to `.env.local` and fill in the provider credentials. Keep `.env.local` private and out of Git.
2. In the Supabase SQL editor, run `supabase/phase4-schema.sql`, then `supabase/phase5-payments-schema.sql`.
3. In the PayPal Developer Dashboard, create a sandbox webhook pointing to `https://YOUR_PUBLIC_HOST/api/paypal/webhook`, subscribe to `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.COMPLETED`, and `PAYMENT.CAPTURE.DENIED`, and put its webhook ID in `PAYPAL_WEBHOOK_ID`. Pending payments stay pending until a signed completed event arrives; denied payments are marked failed.
4. Install dependencies, build, and start the development server. On macOS, Linux, and Command Prompt, use `npm`. In Windows PowerShell, use the `.cmd` versions if `npm` is blocked by PowerShell's script policy:

   **macOS / Linux / Command Prompt:**

   ```sh
   npm install
   npm run build
   npm run dev
   ```

   **Windows PowerShell 5.1:**

   ```powershell
   npm.cmd install
   npm.cmd run build
   npm.cmd run dev
   ```

5. Open `http://localhost:3000`.

The webhook cannot receive deliveries from PayPal while the app is available only at `localhost`; use a public HTTPS development tunnel or deployed sandbox environment.

## Environment variables

See `.env.example` for all names. AI, Supabase, and PayPal secrets are used only by server routes. `NEXT_PUBLIC_APP_URL` should match the public app origin when the client proposal link is shared outside the local machine.

## Main routes

| Route | Purpose |
|---|---|
| `/` | AI proposal editor and sharing |
| `/proposals` | Saved proposals |
| `/proposals/[id]` | Proposal detail |
| `/payments` | Payment history |
| `/proposal/[token]` | Client review, response, and milestone checkout |
| `/api/ai/proposal` | Generate a proposal |
| `/api/proposals` | Create and list proposals |
| `/api/client/[token]` | Read/respond to a client proposal |
| `/api/paypal/create-order` | Create an order from an approved milestone |
| `/api/paypal/capture-order` | Capture and verify a returned order |
| `/api/paypal/cancel-order` | Close an unapproved order after buyer cancellation |
| `/api/paypal/webhook` | Verify and reconcile PayPal events |
| `/api/payments` | List payment history for the dashboard |

## Demo scope and limits

- PayPal stays in sandbox; the interface does not move real money.
- Dashboard routes do not have account authentication yet. The proposal and payment lists are for a private hackathon demo only; do not deploy this dashboard publicly with real client data until owner authentication and authorization are added.
- A client proposal URL is a bearer link. Anyone with it can view and respond until it expires.
- Draft proposals are saved in the current browser's local storage. Shared proposals and payments are stored in Supabase.
- AI pricing and timelines are estimates and require human review.
- Email delivery, account management, and production payment operations are not included.

