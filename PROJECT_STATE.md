# PROJECT_STATE: IUFyou admin dashboard
Updated: 2026-11-01

## Accomplished
- Inspected site: static GitHub Pages (iufyou.com); videos in content.js (4 episodes, 30 shorts, 12 social posts), rendered by an inline script in index.html.
- Reused existing Supabase project IUFU (tables videos/admins/audit_log, is_iufu_admin(), audit triggers). Applied additive migration `dashboard_video_management` (kind, position, audit detail columns, iufu_apply_changes RPC).
- Backed up the 10 pre-existing rows (`videos_backup_20261101`), set them unpublished, imported the 34 live items in order (decision "1" from the owner).
- Built the console (random-path html/js/css), live-content.js loader with content.js fallback, minimal index.html change (boot wrapper + guard for fewer than 4 episodes).
- Tested: local Postgres RLS, real-project permission test (rolled back), 36 browser checks against a mock backend.

## Decisions
- Supabase + static admin page (GitHub Pages cannot run server code). Dashboard is the source of truth for episodes/shorts; Metricool sync must no longer overwrite them.
- Single admin role (existing schema). Posts/carousels stay in content.js.
- `live` is false in supabase-config.js: the public site is unchanged until approved.

## Open issues
- Never tested against the real Supabase Auth (no password available). Admin account exists but has never signed in; password must be set/reset by the owner.
- Supabase Auth hardening (disable sign-ups, leaked-password protection, MFA) must be set in the Supabase dashboard.
- Not deployed. Branch `admin-dashboard` not merged.

## Exact next step
Owner sets the admin password, then merge `admin-dashboard`, sign in at the console, check the list, then set `live: true` and push.
