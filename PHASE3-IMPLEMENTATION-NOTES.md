# ScopePay AI — Complete Source Bundle (Phase 3)

This bundle combines the supplied ScopePay source project with the Phase 3 proposal-management UI update.

## Included
- Next.js App Router application source
- Gemini-compatible AI proposal API route and AI schema/client helper
- PayPal sandbox create-order and capture-order API routes and helper
- Phase 3 proposal editor, browser-local draft save/load, client preview, print/PDF, demo approval/revision states, and total validation
- Project configuration and `.env.example`

## Setup (Windows PowerShell 5.1)
1. Extract this folder to `C:\scopepay-ai-starter` (or another location).
2. Restore your existing `.env.local` from your previous project backup. It is intentionally not included in this ZIP because it contains private API credentials.
3. In the project directory run:
   ```powershell
   npm.cmd install --legacy-peer-deps
   npm.cmd run build
   npm.cmd run dev
   ```
4. Open `http://localhost:3000`.

## Important limitations
- Drafts are stored in the current browser's localStorage, not a server database.
- Approval/rejection/revision controls are demo workflow states, not authenticated client actions.
- These controls do not send email or create/capture PayPal orders.
- PayPal API routes are included, but a real payment workflow still requires server-side proposal persistence, authenticated ownership/approval, amount validation, and verified PayPal capture handling.

Never commit `.env.local` or share API keys/client secrets.
