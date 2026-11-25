# MealSwipe

Swipe through dinner recipes, plan the week for your household, and get one grocery list grouped by aisle.
The web version is shared: everyone with the household passcode sees the same week, recipes and checkmarks, synced live.

## Run it
- **Web (shared):** deployed on Vercel from this repo. `npm run build:web` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` set writes `dist-web/index.html`.
- **Local / Claude Artifact (this browser only):** `npm run build` writes `index.html` and `dist/artifact.html`. Double-click `index.html` to use it offline (needs internet for React and fonts).

## Where things live
| File | What it does |
| --- | --- |
| `src/recipes.js` | Starter deck: 12 recipes with ingredients, steps and descriptions. Add one by copying a block and giving it a new `id`. |
| `src/MealSwipe.jsx` | The app: swipe deck, recipe detail view, week plan, grocery list, recipe editor, settings. |
| `src/lib.js` | Units (US/metric), scaling, grocery aggregation, JSON import. No React. |
| `src/store.js` | **All data reads and writes.** A local backend (browser storage) and a Supabase backend share one interface: `load`, `persist`, `subscribe`, `onStatus`, `signOut`. To move to another database, add a backend here. |
| `api/ask-claude.mjs` | Vercel function behind the recipe form's **Ask Claude** button. Holds the Anthropic API key; the browser never sees it. Prompt, schema and cleanup live in `api/_recipe-ai.mjs`. |
| `template.html` | Page shell and color tokens (`--ai` is the gold used for Claude-filled fields). |
| `build.mjs` | Builds both versions with esbuild and Tailwind. |

## Supabase
One table, `households`, holds a household's recipes, picks (`decisions`, `plan`), grocery `checked` items and `settings`.
The browser cannot read the table directly. It calls two functions, `ms_load(code)` and `ms_save(code, patch)`, which check the passcode on every call (bcrypt hash, throttled after repeated wrong codes).
`ms_save` merges picks and checkmarks key by key, so two people editing at once don't overwrite each other.
Live updates use a Supabase Realtime broadcast channel that only says "something changed"; the app then re-reads through `ms_load`. It also re-reads every 30 seconds and when the tab comes back into view.

**Changing the passcode:** Household & settings → Change passcode. It asks for the current passcode, then calls `ms_change_passcode(code, new_code)` (at least 8 characters, must differ from the current one). That also gives the household a new realtime channel name. Other devices are told on the old channel, re-check, and get sent back to the passcode screen; any device that missed the ping finds out on its next 30-second check. The SQL is in `supabase/migrations/`.

To add a household, run in the Supabase SQL editor:
```sql
insert into households (name, passcode_hash) values ('Home', extensions.crypt('new-passcode', extensions.gen_salt('bf')));
```

## Ask Claude
In the web app, the Add/Edit recipe form has an **Ask Claude** button. Type a title (and optionally a description, ingredients or steps) and Claude fills in everything still empty: emoji, cuisine, times, servings, ingredients with quantities/units/aisles, and steps. It never overwrites what you typed. Every field Claude filled is tinted yellow-gold until you edit it. No photos are generated; the card uses the emoji.

Setup (once): in Vercel → Project → Settings → Environment Variables add `ANTHROPIC_API_KEY` (from console.anthropic.com), then redeploy. Setting a monthly spend limit in the Anthropic console is a good safety net.

- **Model:** Household & settings → Ask Claude model (Opus 5.5 default, Sonnet 5.5, Haiku 5.5). The choice is saved with the household. To add a model, add it to `AI_MODELS` in both `src/lib.js` and `api/_recipe-ai.mjs` (`npm test` checks they match).
- **Who can use it:** the function checks the household passcode (via `ms_check`, or `ms_load` where that doesn't exist) before calling Claude, so only your household can spend credits.
- **Tests:** `npm test` runs the function against a fake Supabase and a fake Anthropic API, plus the form's merge rules.

## Meal math
A recipe at multiplier `m` makes `servings × m` portions, which covers `servings × m ÷ people` dinners. The header shows dinners covered out of the weekly target.
