# PROJECT_STATE: IUFyou admin dashboard
Updated: 2026-11-01 (revision 2)

## Accomplished
- Inspected site: static GitHub Pages (iufyou.com); videos in content.js (4 episodes, 30 shorts, 12 social posts), rendered by an inline script in index.html.
- Reused existing Supabase project IUFU (tables videos/admins/audit_log, is_iufu_admin(), audit triggers). Applied additive migration `dashboard_video_management` (kind, position, audit detail columns, iufu_apply_changes RPC).
- Backed up the 10 pre-existing rows (`videos_backup_20261101`), set them unpublished, imported the 34 live items in order (decision "1" from the owner).
- Built the console (random-path html/js/css), live-content.js loader with content.js fallback, minimal index.html change (boot wrapper + guard for fewer than 4 episodes).
- Tested: local Postgres RLS, real-project permission test (rolled back), 36 browser checks against a mock backend.

## Revision 2 (awaiting owner approval, NOT committed/deployed)
- Admins no longer type titles or categories. Link-only form; title is read from YouTube by edge function `supabase/functions/video-title/index.ts` (admin-only, checks is_iufu_admin() with caller token, contacts only youtube.com/oembed). Deploy with verify_jwt = false.
- Add form has a "Replace an existing video" checkbox + target list; ticked = same slot/position, new link and new title; unticked = new video added first/last.
- Files changed: 33a38338...js/html/css. Preview artefact shared with owner first (owner rule: preview before any merge/deploy/push).

## Decisions
- Supabase + static admin page (GitHub Pages cannot run server code). Dashboard is the source of truth for episodes/shorts; Metricool sync must no longer overwrite them.
- Single admin role (existing schema). Posts/carousels stay in content.js.
- `live` is false in supabase-config.js: the public site is unchanged until approved.

## Open issues
- Never tested against the real Supabase Auth (no password available). Admin account exists but has never signed in; password must be set/reset by the owner.
- Supabase Auth hardening (disable sign-ups, leaked-password protection, MFA) must be set in the Supabase dashboard.
- Not deployed. Branch `admin-dashboard` not merged.

## Exact next step
Owner approves the revision-2 preview; then deploy the edge function, commit and push to `admin-dashboard`; owner sets the admin password; merge; sign in; check; set `live: true` and push.
