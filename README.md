# IUFU — صفحات من نور

Responsive Arabic RTL static website. Built from the supplied homepage reference and emerald/gold blueprint.

## Files
- `index.html` — complete homepage
- `styles.css` — responsive styles
- `app.js` — Supabase public videos and UI interactions
- `assets/hero-reference.jpg` — temporary cropped image from the user-provided blueprint (replace with approved K1/K2-based full Kaaba hero photograph)

## Deployment
Upload the contents of this folder to the root of your GitHub Pages repository. Enable GitHub Pages for the main branch/root if not already enabled. No build step required.

## Data
Public video cards fetch `public.videos` from IUFU Supabase. A local fallback includes the ten confirmed YouTube IDs. The public publishable key is safe for a browser; NEVER put a Supabase service-role or secret key in these files. Public SELECT RLS policy must allow reading published videos.

## Pending assets and content
- Replace temporary hero with approved full-width historical Kaaba artwork; current reference screenshot crop is only a visual stand-in.
- Replace repeated start/series photographic stand-ins with separately approved original images.
- Select actual carousel posts and Pinterest pins; placeholders deliberately do not link to invented content.
- Add verified Instagram, TikTok, Facebook and Pinterest URLs; currently shown as unlinked placeholders.
- Replace descriptive temporary Shorts titles with the videos' official titles once verified.
- The website is not published automatically. No GitHub changes were made.
