# Big Two — GitHub Pages build

Upload the contents of this ZIP to your GitHub repository and enable GitHub Pages.

## What was fixed / added

- Mobile top bar is now safe-area aware and horizontally scrollable, so buttons are not hidden by the phone status bar.
- Cards animate from the player position to the middle of the table and fan out cleanly.
- The last played card remains visible before the round-over score modal appears.
- Optional player profile picture:
  - upload from gallery
  - take selfie on mobile
  - emoji fallback if no picture is selected
- Comments:
  - quick comments included
  - custom comments can be sent and saved locally
- Emotes / stickers:
  - uploaded WhatsApp animated WebP sticker included
  - cropped WhatsApp screenshot sticker samples included
  - emoji stickers included
- Bots are improved and can play singles, pairs, triplets and 5-card hands.
- First deal starts with the player holding 3♦. Next deals start with the previous round winner.

## Files

- `index.html` — main page
- `styles.css` — mobile-first design and animations
- `app.js` — full game logic
- `assets/stickers/` — sticker assets
- `supabase-schema.sql` — optional database schema if you need to recreate the Supabase table

## Important

The app contains the same Supabase client setup style used by the earlier build. If you change Supabase projects, update `SUPABASE_URL` and `SUPABASE_ANON_KEY` at the top of `app.js` and run `supabase-schema.sql` in Supabase SQL editor.

The app still works in local bot mode if Supabase is not available.
