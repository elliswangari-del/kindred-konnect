# Kindred Konnect

Kindred Konnect is a standalone responsive React app in this folder. It does not replace the existing Jua site. Vite bundles React, Supabase, LiveKit, Tailwind CSS and Framer Motion for development and production.

## Run and build

1. Install Node.js 20.19+ (Node 22+ recommended).
2. From this folder, run `npm install` and then `npm run dev`. Vite prints the local address, normally `http://localhost:5173`.
3. To build for XAMPP or another Apache host, run `npm run build` and copy the **contents of `dist/`** into the web root. The included `.htaccess` supports direct loading and refresh of the `?page=` URLs. Set the Supabase Auth Site URL and redirect URLs to the deployed address.

The current feature screens are rendered inside a React app root while their existing page and Supabase flows are retained. React owns the application mount and Framer Motion handles page entry transitions; Tailwind is available alongside the established responsive component styles.

## Supabase setup

1. Create a Supabase project. In **Project Settings → API**, copy its Project URL and publishable/anon key into `js/config.js` (`supabaseUrl` and `supabaseAnonKey`). These are public browser values; never put a service-role key in this file.
2. In the Supabase SQL Editor, run `supabase/migrations/202611010001_kindred_connect.sql` as the project owner. This creates pending-by-default profiles, RLS policies, private `memories`, `avatars`, and `chat-files` buckets, message/call notifications, call sessions and private Realtime presence policies.
3. Configure **Authentication → URL Configuration** with the deployed URL as Site URL and add the local XAMPP URL as an allowed redirect URL. Configure email delivery and confirmation in **Authentication → Providers → Email**.
4. Register and confirm the intended owner account. In SQL Editor, promote that account using the comment at the bottom of the migration, replacing `owner@example.com` with its email. The project owner executes this database change; users cannot assign their own role or approval status.
5. Register a second account and approve it in **Admin Dashboard** to confirm the approval flow.

### Administrator portal and membership email

The administrator portal has an overview, pending membership requests, member management, and an approval/rejection history. Apply `supabase/migrations/202611180001_admin_portal.sql` in the Supabase SQL Editor after the original migration. It adds a status-transition audit table readable only by approved administrators, records changes with a database trigger, and updates `admin_set_member_status()` to reject changes to every administrator account. It does not grant clients permission to write to the audit table or change profile roles. History starts when this migration is applied; earlier status transitions were not recorded and cannot be reconstructed reliably.

Email is sent by Supabase Edge Functions; no Resend key or service-role key is used in the browser. Configure these Edge Function secrets in the Supabase project:

- `RESEND_API_KEY`: Resend API key.
- `RESEND_FROM_EMAIL`: verified sender, for example `Kindred Konnect <notices@your-domain.example>`.
- `ADMIN_NOTIFICATION_EMAILS`: one or more administrator inboxes separated by commas.
- `KINDRED_WEBHOOK_SECRET`: a strong random secret shared only with the registration webhook configuration.
- `SITE_URL`: deployed site origin used for the admin dashboard link.

Deploy `notify-registration` and `send-membership-email` with the Supabase CLI. In **Database → Webhooks**, create an `INSERT` webhook for `public.profiles` targeting the deployed `notify-registration` Edge Function URL. Add an `x-webhook-secret` header whose value matches `KINDRED_WEBHOOK_SECRET`. The function accepts only pending profile insert events. After an administrator approves or rejects a member, the portal calls `send-membership-email`; that function verifies the administrator's Supabase session and re-reads the target record through `admin_list_members()` before sending. Keep all listed values in Supabase secrets and the webhook configuration, not in `js/config.js`.

After linking the Supabase project, set the secrets with the CLI (replace each placeholder with its configured value), then deploy both functions:

```sh
supabase secrets set RESEND_API_KEY=YOUR_RESEND_KEY RESEND_FROM_EMAIL="Kindred Konnect <notices@your-domain.example>" ADMIN_NOTIFICATION_EMAILS="admin@example.com" KINDRED_WEBHOOK_SECRET=YOUR_RANDOM_WEBHOOK_SECRET SITE_URL=https://your-site.example
supabase functions deploy notify-registration
supabase functions deploy send-membership-email
```

The database migration and Database Webhook are separate Supabase setup steps; review and apply the migration before using the history page. The webhook requires no service-role key in the application.

All private database reads, writes, media objects and downloads require an authenticated approved member. The memories bucket is private. The browser fetches each asset through the authenticated Storage API, which checks the current approval policy; it does not create public or signed media URLs. Admin membership changes use a database function with an administrator check.

## Live audio/video setup

Create a LiveKit Cloud project (or host LiveKit), then set `livekitUrl` in `js/config.js` to its WebSocket URL. Deploy the token endpoint to Supabase Edge Functions:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set LIVEKIT_API_KEY=YOUR_KEY LIVEKIT_API_SECRET=YOUR_SECRET
supabase functions deploy livekit-token
```

The function verifies the caller's Supabase session and approved profile before minting a short-lived room token. LiveKit secrets stay in Edge Function secrets. Calls use the shared `kindred-community` room.

## Current implementation scope

- Dedicated URL states are available at `?page=home`, `about`, `rules`, `register`, `login`, `album`, `chat`, `calls`, `profile`, and `admin`. Apache rewrites unknown paths to the app entry point as well.
- Working connected features include email/password registration and login, password reset/change, approval-pending screen, approved-member RLS, private photo/video upload and authenticated preview/download, likes/comments/deletion, realtime group chat with image/voice attachments, approved-only presence, typing indicators and replies, member profile pictures, profile editing, the administrator portal's approval/rejection/suspension and recent-content moderation, and in-app member status/new-message/call notifications.
- LiveKit uses a shared group room with audio/video publishing, remote track playback, microphone/camera controls, active-call listings and join/leave. A browser must allow microphone/camera access for the relevant call mode.
- Registration and approval/rejection email delivery requires the Edge Functions, Resend secrets, and registration Database Webhook described above. The call screen lists active group calls but does not yet target a specific member or offer a separate incoming-call accept/reject dialog. Album uploads show state messages but not byte-level transfer progress.
- React mounts the routed experience, Vite builds the production assets, Tailwind is available for utility styling, and Framer Motion animates page changes.

Without Supabase configuration, the public landing and About pages remain available; registration, login and member features prompt for setup. Without LiveKit URL and deployed function configuration, call controls report the missing setup instead of showing decorative success. The Supabase migration and RLS policies must be applied before private functionality can be tested against a real backend.
