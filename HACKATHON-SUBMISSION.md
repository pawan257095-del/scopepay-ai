# ScopePay AI — PayPal AI Hackathon Submission Pack

Use this as a draft for the Devpost entry and demo recording. Keep claims tied to features you can show in the current build.

## Project title

**ScopePay AI**

## Tagline

**Turn a client brief into agreed scope and milestone payments.**

## Short description

ScopePay AI turns a freelancer’s client brief into an editable proposal, gets client approval through a private link, and collects verified PayPal milestone payments.

## Project description

Freelancers often receive project requirements as informal messages. Turning those into a clear scope, realistic deliverables, a price, and payment terms takes time—and unclear expectations can lead to rework and late payment.

ScopePay AI helps independent freelancers and small service businesses move from a brief to an approved, payable plan. A freelancer enters a client request, and the AI drafts a proposal with a summary, assumptions, included and excluded work, clarification questions, deliverables, timeline, pricing, and milestones. The freelancer reviews and edits the draft before sharing it. The client opens a private proposal link and can approve, decline, or request changes.

Once the client approves, each milestone can be paid through PayPal Sandbox. ScopePay creates an order for the saved milestone amount, verifies the returned capture status, amount, and currency on the server, and reconciles asynchronous PayPal updates through a verified webhook. The freelancer can review proposal and payment activity in the dashboard.

AI helps structure and clarify the work; the freelancer remains responsible for reviewing the scope and price. PayPal is part of the core workflow: approved scope becomes a staged payment plan, and payment status is tied back to the corresponding milestone.

## What the working demo shows

- AI-generated proposal content that the freelancer can review and edit.
- A private client proposal link and client approval flow.
- Per-milestone PayPal Sandbox checkout.
- Server-side capture verification and paid status updates.
- Proposal and payment dashboards.

In the current Sandbox demonstration, one proposal shows all four milestones as paid, totaling **USD 3,800**. The screenshots and video should make clear that these are Sandbox transactions, not real payments. Do not present test activity as customer adoption or measured business impact.

## Technology

- Next.js App Router, React, and TypeScript.
- An OpenAI-compatible AI API through the OpenAI SDK.
- Supabase Postgres for proposals, events, payments, and webhook records.
- PayPal REST Orders API in Sandbox for milestone checkout and capture.
- Zod for request and proposal validation.

## Two-minute, forty-second demo script

Keep the recording below three minutes. Show the app running on the intended desktop platform, use narration or readable captions, and keep the cursor movement deliberate.

### 0:00–0:18 — The problem

“Freelancers often start with vague client messages, then have to turn them into scope, price, and payment terms. ScopePay connects that first conversation to an approved, trackable payment plan.”

### 0:18–0:55 — Generate and review

Paste a short website or consulting brief and generate a proposal. Show the summary, included and excluded work, assumptions, questions, deliverables, price, timeline, and milestones. Edit one item to make clear that the freelancer controls the final proposal.

Narration: “The AI creates a structured first draft. The freelancer reviews and adjusts it before anything is sent to the client.”

### 0:55–1:20 — Share and approve

Create a client link and open it in a second browser window. Show the client reviewing the proposal and approving it.

Narration: “The client gets a dedicated proposal page and can approve it or request changes.”

### 1:20–2:05 — Pay with PayPal

Start one milestone payment. Show PayPal Sandbox checkout, approve using a Sandbox Personal buyer, return to ScopePay, and show the milestone marked Paid. Keep the payment amount visible so the milestone-to-payment connection is clear.

Narration: “After approval, the client pays a milestone through PayPal. The server checks PayPal’s capture result against the saved amount and currency before marking it paid.”

### 2:05–2:40 — Close with the outcome

Show the proposal with all four paid milestones, then briefly show the payment activity page.

Narration: “ScopePay brings AI-assisted scoping, client approval, and verified milestone payment tracking into one workflow. This demo uses PayPal Sandbox.”

## Recording and privacy checklist

- Keep the video under three minutes and upload it publicly to YouTube, as required by the official rules.
- Hide or blur the browser address bar whenever a client proposal is open. The URL contains a bearer token that allows anyone who has it to view and respond to that proposal until it expires.
- Do not show `.env.local`, API keys, PayPal client secrets, Supabase service-role keys, passwords, or private account details.
- Use only Sandbox accounts and say “Sandbox” in the narration or captions.
- Use the paid proposal page as the strongest proof. The overall Payments dashboard contains earlier Sandbox test attempts, so avoid lingering on its aggregate pending count.
- Do not use copyrighted music or footage you do not have permission to use.

## Submission checklist

- Publish the source repository publicly and keep its open-source `LICENSE` visible.
- Include the setup instructions from `README.md`, `.env.example`, and the Supabase SQL migrations. Never commit `.env.local` or real credentials.
- Provide a working hosted demo or complete run instructions so judges can run the application. The official rules do not require public hosting if the repository instructions let judges run it.
- Add this project description and a public YouTube demo URL to the Devpost submission.
- If the project existed before the submission period, explain the specific changes made during the hackathon. Describe only changes you actually completed and can demonstrate.
- Submit before **Nov 12, 2026 at 12:00 p.m. Pacific Time** (**Nov 13 at 1:30 a.m. India time**).

## Official links

- [Hackathon overview and deadline](https://paypalaihackathon.devpost.com/)
- [Official rules, demo and repository requirements, and judging criteria](https://paypalaihackathon.devpost.com/rules)
