# IUFyou admin console

A private dashboard for managing the Episodes and Shorts shown on the public site, without editing code.

## How it works
- The site is still static (GitHub Pages). Videos live in the Supabase project **IUFU** (table `public.videos`).
- The public page (`live-content.js`) reads published rows from Supabase and falls back to `content.js` if the database is unreachable. **It is switched off until `live: true` is set in `supabase-config.js`.**
- The console is the page whose file name is a random 128-bit string (`<32 hex chars>.html/.js/.css`). It is not linked anywhere and is marked `noindex`. **The file name is not a security control**: the repository is public, so assume it can be found. Every read of private data and every write is enforced by the database.

## Security model (all server-side, in Supabase)
- Sign-in: Supabase Auth (email + password). No custom auth code. Supabase applies its own rate limits to sign-in.
- Authorisation: row-level security. Only users listed in `public.admins` pass `is_iufu_admin()`. Visitors can only read rows where `published = true`; they cannot insert, update, delete, call `iufu_apply_changes`, or read `audit_log`.
- Publishing: `iufu_apply_changes(changes jsonb)` applies a reviewed batch in one transaction (all or nothing) and validates YouTube IDs and titles.
- Removing a video sets `published = false`. Nothing is deleted and nothing on YouTube is touched. Admins can restore from the "Removed" filter.
- Audit: triggers write who/what/when to `public.audit_log` (actor, email, old and new values). The log cannot be edited through the API.
- The browser stores the session in `sessionStorage` (cleared when the tab closes) and signs out after 30 minutes idle. The page has a strict Content-Security-Policy and renders all data as text.

## Admin accounts
Admins are rows in `public.admins` linked to a Supabase Auth user. To add one: create the user in Supabase → Authentication → Users, then run
`insert into public.admins(user_id, display_name) values ('<that user id>', '<name>');`
Passwords are never stored in this repository. Recommended in Supabase → Authentication: turn **off** "Allow new users to sign up", enable leaked-password protection and a longer minimum password length, and consider MFA.

## Files
- `<random>.html / .js / .css`: the console
- `supabase-config.js`: public project URL + publishable key + the `live` switch (never put a secret key here)
- `live-content.js`: public site loader (read-only, with fallback)
- `supabase/migrations/…sql`: the additive migration already applied to the project; `supabase/seed.sql`: the import that was run; `supabase/backup/`: copy of the original `content.js`
- In the database: `videos_backup_20261101` is a copy of the 10 rows that existed before the import (they were set to unpublished, not deleted)

## Not managed by the console
The Instagram/Facebook post carousels still come from `content.js`.
