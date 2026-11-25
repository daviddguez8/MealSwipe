// ============================================================================
// All reading and writing of MealSwipe data happens in this file.
// Two backends share one interface, so swapping storage later (Railway,
// plain Postgres, anything else) means writing one more backend here.
//
//   store.mode            "local" | "supabase"
//   store.needsPasscode   true for shared backends
//   store.platform()      -> the MealSwipe recipes (originals) this household sees
//   store.load()          -> saved household rows, or null for a fresh start
//                            (turn them into app state with stateFromSaved)
//   store.persist(state)  called on every change; the store decides how/when to save
//   store.subscribe(fn)   fn(savedState) when someone else changes the data
//   store.onStatus(fn)    fn("saved" | "saving" | "offline" | "error", detail)
//   store.signOut()
//   store.changePasscode(current, next)   shared backends only
//   store.onSignedOut(fn)  fn(reason) when this device's passcode stops working
//                          (someone changed it), so the app can ask for the new one
// ============================================================================

import { STARTER_RECIPES } from "./recipes.js";

const LOCAL_KEY = "mealswipe.v1";
const CODE_KEY = "mealswipe.passcode";

function lsGet(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function lsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
    return true;
  } catch (e) {
    return e && /quota/i.test(String(e.name || e.message)) ? "quota" : false;
  }
}

// ---------------------------------------------------------------------------
// Data model
//
// The app works with one `state`: { recipes: [...], ratings, decisions, plan,
// checked, settings }. Each recipe carries `source`:
//   "classic"  a MealSwipe recipe, unchanged
//   "custom"   a MealSwipe recipe this household edited
//   "own"      a recipe this household created
//
// Both backends save the same household "rows", mirroring the database tables:
//   recipes  { id: { kind: "own" | "edit" | "hidden", data } }   household_recipes
//   photos   { id: image }                                        household_photos
//   ratings  { id: 1..5 }                                         household_ratings
//   decisions, plan, checked, order                               household_plans
//   settings                                                      households.settings
// MealSwipe originals ("platform") are not copied into the household: a
// Classic recipe has no row at all, so improvements to the original show up.
// ---------------------------------------------------------------------------

const MAP_KEYS = ["recipes", "photos", "ratings", "decisions", "plan", "checked"];
const WHOLE_KEYS = ["order", "settings"];
const NON_DATA = ["id", "image", "source", "custom"];

function recipeData(r) {
  const d = { ...r };
  for (const k of NON_DATA) delete d[k];
  return d;
}

// Key order and number formatting don't count as an edit.
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined && v[k] !== "" && k !== "photoCredit") o[k] = canon(v[k]);
    return o;
  }
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return v;
}
export function sameRecipe(a, b) {
  return JSON.stringify(canon(recipeData(a))) === JSON.stringify(canon(recipeData(b)));
}

// Give a recipe the right `source` for this household (after a form save or import).
export function withSource(recipe, platformById) {
  const r = { ...recipe };
  delete r.custom;
  const orig = platformById[r.id];
  r.source = !orig ? "own" : sameRecipe(r, orig) ? "classic" : "custom";
  return r;
}

export function platformMap(platform) {
  return Object.fromEntries((platform || []).map((p) => [p.id, p]));
}

// Any saved shape (rows from either backend, an older recipes-array save, or a
// JSON backup) -> household rows. Returns null for "nothing saved yet".
export function toRows(saved, platform) {
  if (!saved) return null;
  if (saved.recipes && !Array.isArray(saved.recipes)) {
    return {
      recipes: saved.recipes || {},
      photos: saved.photos || {},
      ratings: saved.ratings || {},
      decisions: saved.decisions || {},
      plan: saved.plan || {},
      checked: saved.checked || {},
      order: saved.order || [],
      settings: saved.settings || {},
    };
  }
  if (!Array.isArray(saved.recipes)) return null;
  // Older saves: one array with every recipe copied in. Unchanged MealSwipe
  // recipes become Classic, changed ones become edits.
  const byId = platformMap(platform);
  const rows = { recipes: {}, photos: {}, ratings: { ...(saved.ratings || {}) } };
  for (const r of saved.recipes) {
    if (r.image) rows.photos[r.id] = r.image;
    const orig = byId[r.id];
    const src = r.source || (r.custom || !orig ? "own" : sameRecipe(r, orig) ? "classic" : "custom");
    if (!orig || src === "own") rows.recipes[r.id] = { kind: "own", data: recipeData(r) };
    else if (src === "custom") rows.recipes[r.id] = { kind: "edit", data: recipeData(r) };
  }
  // MealSwipe recipes the household had seen and deleted stay hidden.
  // Backups list them under `hidden`; older saves under seenStarterIds.
  const present = new Set(saved.recipes.map((r) => r.id));
  const hidden = Array.isArray(saved.hidden) ? saved.hidden : (saved.seenStarterIds || []).filter((id) => !present.has(id));
  for (const id of hidden) if (byId[id] && !present.has(id)) rows.recipes[id] = { kind: "hidden", data: null };
  rows.decisions = saved.decisions || {};
  rows.plan = saved.plan || {};
  rows.checked = saved.checked || {};
  rows.order = saved.recipes.map((r) => r.id);
  rows.settings = saved.settings || {};
  return rows;
}

// Household rows -> app state. New MealSwipe recipes (not in the saved order) go on top of the deck.
export function stateFromSaved(saved, platform) {
  const rows = toRows(saved, platform) || { recipes: {}, photos: {}, ratings: {}, decisions: {}, plan: {}, checked: {}, order: [], settings: {} };
  const list = [];
  for (const p of platform) {
    const row = rows.recipes[p.id];
    if (row && row.kind === "hidden") continue;
    if (row && row.kind === "edit" && row.data) list.push({ ...row.data, id: p.id, source: "custom" });
    else list.push({ ...p, source: "classic" });
  }
  const pIds = new Set(platform.map((p) => p.id));
  for (const [id, row] of Object.entries(rows.recipes)) {
    if (!row || !row.data) continue;
    if (row.kind === "own" || (row.kind === "edit" && !pIds.has(id))) list.push({ ...row.data, id, source: "own" });
  }
  for (const r of list) if (rows.photos[r.id]) r.image = rows.photos[r.id];
  const pos = new Map((rows.order || []).map((id, i) => [id, i]));
  const fresh = list.filter((r) => !pos.has(r.id));
  const known = list.filter((r) => pos.has(r.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
  return {
    recipes: [...fresh, ...known],
    ratings: rows.ratings || {},
    decisions: rows.decisions || {},
    plan: rows.plan || {},
    checked: rows.checked || {},
    settings: rows.settings || {},
  };
}

// App state -> household rows.
export function rowsFromState(state, platform) {
  const byId = platformMap(platform);
  const rows = { recipes: {}, photos: {}, ratings: {} };
  const present = new Set();
  for (const r of state.recipes) {
    present.add(r.id);
    if (r.image) rows.photos[r.id] = r.image;
    if (byId[r.id]) {
      if (r.source === "custom" || r.source === "own") rows.recipes[r.id] = { kind: "edit", data: recipeData(r) };
    } else rows.recipes[r.id] = { kind: "own", data: recipeData(r) };
  }
  for (const id of Object.keys(byId)) if (!present.has(id)) rows.recipes[id] = { kind: "hidden", data: null };
  for (const [id, n] of Object.entries(state.ratings || {})) if (n) rows.ratings[id] = n;
  rows.decisions = state.decisions || {};
  rows.plan = state.plan || {};
  rows.checked = state.checked || {};
  rows.order = state.recipes.map((r) => r.id);
  rows.settings = state.settings || {};
  return rows;
}

// ---------------------------------------------------------------------------
const LOCAL_KEY_V2 = "mealswipe.v2";

function createLocalStore() {
  let statusFn = () => {};
  const platform = STARTER_RECIPES;
  const read = () => {
    try {
      const raw = lsGet(LOCAL_KEY_V2) || lsGet(LOCAL_KEY); // v1 is left in place as a backup
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  };
  return {
    mode: "local",
    needsPasscode: false,
    platform: () => platform,
    async load() {
      return read();
    },
    loadSync: read,
    persist(state) {
      const r = lsSet(LOCAL_KEY_V2, JSON.stringify({ ...rowsFromState(state, platform), savedAt: Date.now() }));
      statusFn(r === true ? "saved" : r === "quota" ? "error" : "offline", r === "quota" ? "Browser storage is full. Try smaller photos or remove a few." : "");
    },
    subscribe() {
      return () => {};
    },
    onStatus(fn) {
      statusFn = fn;
    },
    signOut() {},
    onSignedOut() {},
  };
}

// ---------------------------------------------------------------------------
// Shared household backed by Supabase. The browser never touches tables
// directly: database functions check the passcode on every call.
//   ms_check(code)                 is this passcode valid
//   ms_household_load(code)        everything for the household + MealSwipe recipes
//   ms_household_save(code, patch) row-level changes (see diffPatch)
//   ms_change_passcode(code, new)
// Compare with sorted keys: the database hands objects back in its own key order.
function same(a, b) {
  return stable(a) === stable(b);
}
function stable(v) {
  if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}

function diffPatch(next, base) {
  const patch = {};
  for (const k of MAP_KEYS) {
    const a = next[k] || {};
    const b = (base && base[k]) || {};
    const d = {};
    for (const key of Object.keys(a)) if (!same(a[key], b[key])) d[key] = a[key];
    for (const key of Object.keys(b)) if (!(key in a)) d[key] = null;
    if (Object.keys(d).length) patch[k] = d;
  }
  for (const k of WHOLE_KEYS) if (!base || !same(next[k], base[k])) patch[k] = next[k];
  return patch;
}

// The database copy of the MealSwipe recipes wins; recipes added to recipes.js
// that aren't in the database yet still show up (run scripts/platform-sql.mjs
// to copy them over, so edits and ratings of them work across devices too).
function mergePlatform(fromDb) {
  const list = Array.isArray(fromDb) ? fromDb.slice() : [];
  const have = new Set(list.map((p) => p.id));
  for (const r of STARTER_RECIPES) if (!have.has(r.id)) list.push(r);
  return list;
}

function createSupabaseStore({ url, key, createClient }) {
  const client = createClient(url, key, { auth: { persistSession: false } });
  const clientId = Math.random().toString(36).slice(2);
  let code = lsGet(CODE_KEY) || "";
  let base = null; // last household rows known to be saved on the server
  let platform = STARTER_RECIPES; // replaced by the database copy on load
  let latest = null;
  let timer = null;
  let inFlight = false;
  let channel = null;
  let listeners = [];
  let statusFn = () => {};
  let pollTimer = null;
  let signedOutFn = () => {};
  let changing = false;

  const pending = () => Boolean(timer || inFlight);

  // A wrong-passcode answer (not the "too many tries" one) means the code saved
  // on this device no longer opens the household.
  const isWrongCode = (msg) => /doesn.t match a household/i.test(msg || "");

  async function rpc(name, args, useCode = code) {
    const { data, error } = await client.rpc(name, { code: useCode, ...args });
    if (error) throw new Error(error.message || "Couldn't reach the server.");
    if (data && data.error) {
      const err = new Error(data.error);
      // Only treat it as "signed out" if nobody changed the code locally meanwhile.
      err.authLost = isWrongCode(data.error) && useCode === code && !changing;
      throw err;
    }
    return data;
  }

  function stopSync() {
    clearTimeout(timer);
    timer = null;
    if (channel) client.removeChannel(channel);
    channel = null;
    clearInterval(pollTimer);
    document.removeEventListener("visibilitychange", onVisible);
    base = null;
    latest = null;
  }

  // Stop polling right away: every retry with a stale code counts as a wrong try.
  function authLost() {
    code = "";
    lsSet(CODE_KEY, null);
    stopSync();
    statusFn("offline", "");
    signedOutFn("passcode-changed");
  }

  async function refresh() {
    if (pending() || !code) return;
    try {
      const data = await rpc("ms_household_load", {});
      if (pending()) return;
      if (base && data.version === base.__version) return;
      platform = mergePlatform(data.platform);
      base = { ...toRows(data, platform), __version: data.version };
      listeners.forEach((fn) => fn(data));
      statusFn("saved");
    } catch (e) {
      if (e.authLost) return authLost();
      statusFn("offline", e.message);
    }
  }

  async function flush() {
    timer = null;
    if (!latest) return;
    const snapshot = latest;
    const rows = rowsFromState(snapshot, platform);
    const patch = diffPatch(rows, base);
    if (!Object.keys(patch).length) return statusFn("saved");
    inFlight = true;
    statusFn("saving");
    try {
      const prevVersion = base ? base.__version : null;
      const res = await rpc("ms_household_save", { patch });
      // If someone else saved in between, our copy is missing their change: re-read.
      const missedOthers = prevVersion == null || res.version !== prevVersion + 1;
      base = { ...rows, __version: missedOthers ? -1 : res.version };
      inFlight = false;
      statusFn("saved");
      channel && channel.send({ type: "broadcast", event: "changed", payload: { by: clientId, version: res.version } });
      if (latest !== snapshot) schedule();
      else if (missedOthers) refresh();
    } catch (e) {
      inFlight = false;
      if (e.authLost) return authLost();
      statusFn("offline", e.message);
      timer = setTimeout(flush, 5000);
    }
  }

  // Save anything still waiting, so it lands before the passcode changes.
  async function flushNow() {
    if (timer) {
      clearTimeout(timer);
      await flush();
    }
    for (let i = 0; inFlight && i < 50; i++) await new Promise((r) => setTimeout(r, 100));
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, 450);
    statusFn("saving");
  }

  function connectRealtime(topic) {
    if (channel) client.removeChannel(channel);
    channel = client.channel(`ms-${topic}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "changed" }, (msg) => {
      if (msg.payload && msg.payload.by === clientId) return;
      refresh();
    });
    // Another device changed the passcode: re-check now, which signs this one out.
    channel.on("broadcast", { event: "passcode-changed" }, (msg) => {
      if (msg.payload && msg.payload.by === clientId) return;
      refresh();
    });
    channel.subscribe();
  }

  const onVisible = () => document.visibilityState === "visible" && refresh();

  return {
    mode: "supabase",
    needsPasscode: true,
    hasPasscode: () => Boolean(code),
    platform: () => platform,
    async signIn(newCode) {
      const prev = code;
      code = String(newCode || "").trim();
      try {
        const data = await rpc("ms_check", {});
        lsSet(CODE_KEY, code);
        return data;
      } catch (e) {
        code = prev;
        throw e;
      }
    },
    async load() {
      const data = await rpc("ms_household_load", {});
      platform = mergePlatform(data.platform);
      base = data.isNew ? null : { ...toRows(data, platform), __version: data.version };
      connectRealtime(data.channel);
      clearInterval(pollTimer);
      pollTimer = setInterval(refresh, 30000);
      document.addEventListener("visibilitychange", onVisible);
      return data.isNew ? null : data;
    },
    persist(state) {
      latest = state;
      if (!base || Object.keys(diffPatch(rowsFromState(state, platform), base)).length) schedule();
    },
    subscribe(fn) {
      listeners.push(fn);
      return () => (listeners = listeners.filter((f) => f !== fn));
    },
    onStatus(fn) {
      statusFn = fn;
    },
    onSignedOut(fn) {
      signedOutFn = fn;
    },
    // Needs the current passcode typed again, even though this device knows it.
    async changePasscode(current, next) {
      const cur = String(current || "").trim();
      const nc = String(next || "").trim();
      await flushNow();
      changing = true;
      try {
        const res = await rpc("ms_change_passcode", { new_code: nc }, cur);
        code = nc;
        lsSet(CODE_KEY, nc);
        // Tell the other devices on the old channel, then move to the new one.
        if (channel) {
          await channel.send({ type: "broadcast", event: "passcode-changed", payload: { by: clientId } });
        }
        connectRealtime(res.channel);
        return true;
      } finally {
        changing = false;
      }
    },
    signOut() {
      code = "";
      lsSet(CODE_KEY, null);
      stopSync();
    },
  };
}

export function createStore() {
  /* global __MS_BACKEND__, __SUPABASE_URL__, __SUPABASE_KEY__ */
  if (__MS_BACKEND__ === "supabase") {
    // Loaded only in the web build, so the Artifact build stays small.
    const { createClient } = require("@supabase/supabase-js");
    return createSupabaseStore({ url: __SUPABASE_URL__, key: __SUPABASE_KEY__, createClient });
  }
  return createLocalStore();
}

export { diffPatch };
