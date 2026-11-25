# MealSwipe

Swipe through dinner recipes, plan the week for your household, and get one grocery list grouped by aisle.
The web version is shared: everyone with the household passcode sees the same week, recipes and checkmarks, synced live.

## Run it
- **Web (shared):** deployed on Vercel from this repo. `npm run build:web` with `SUPABASE_URL` and `SUPABASE_ANON_KEY` set writes `dist-web/index.html`.
- **Local / Claude Artifact (this browser only):** `npm run build` writes `index.html` and `dist/artifact.html`. Double-click `index.html` to use it offline (needs internet for React and fonts).

## Where things live
| File | What it does |
| --- | --- |
| `src/recipes.js` | Starter deck: 14 recipes with ingredients, steps and descriptions. Add one by copying a block and giving it a new `id`. |
| `src/MealSwipe.jsx` | The app: swipe deck, recipe detail view, week plan, grocery list, recipe editor, settings. |
| `src/lib.js` | Units (US/metric), scaling, grocery aggregation, JSON import. No React. |
| `src/store.js` | **All data reads and writes.** A local backend (browser storage) and a Supabase backend share one interface: `load`, `persist`, `subscribe`, `onStatus`, `signOut`. To move to another database, add a backend here. |
| `template.html` | Page shell and color tokens. |
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

## Meal math
A recipe at multiplier `m` makes `servings × m` portions, which covers `servings × m ÷ people` dinners. The header shows dinners covered out of the weekly target.
