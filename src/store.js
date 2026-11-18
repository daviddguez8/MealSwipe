// ============================================================================
// All reading and writing of MealSwipe data happens in this file.
// Two backends share one interface, so swapping storage later (Railway,
// plain Postgres, anything else) means writing one more backend here.
//
//   store.mode            "local" | "supabase"
//   store.needsPasscode   true for shared backends
//   store.load()          -> saved state object, or null for a fresh start
//   store.persist(state)  called on every change; the store decides how/when to save
//   store.subscribe(fn)   fn(savedState) when someone else changes the data
//   store.onStatus(fn)    fn("saved" | "saving" | "offline" | "error", detail)
//   store.signOut()
// ============================================================================

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

const SYNCED_KEYS = ["recipes", "decisions", "plan", "checked", "settings", "seenStarterIds"];
const MAP_KEYS = ["decisions", "plan", "checked"];

function pick(state) {
  const o = {};
  for (const k of SYNCED_KEYS) o[k] = state[k];
  return o;
}

// ---------------------------------------------------------------------------
function createLocalStore() {
  let statusFn = () => {};
  return {
    mode: "local",
    needsPasscode: false,
    async load() {
      try {
        const raw = lsGet(LOCAL_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    loadSync() {
      try {
        const raw = lsGet(LOCAL_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    persist(state) {
      const r = lsSet(LOCAL_KEY, JSON.stringify({ ...pick(state), savedAt: Date.now() }));
      statusFn(r === true ? "saved" : r === "quota" ? "error" : "offline", r === "quota" ? "Browser storage is full. Try smaller photos or remove a few." : "");
    },
    subscribe() {
      return () => {};
    },
    onStatus(fn) {
      statusFn = fn;
    },
    signOut() {},
  };
}

// ---------------------------------------------------------------------------
// Shared household backed by Supabase. The browser never touches tables
// directly: two database functions check the passcode on every call.
function diffPatch(next, base) {
  const patch = {};
  for (const k of MAP_KEYS) {
    const a = next[k] || {};
    const b = (base && base[k]) || {};
    const d = {};
    for (const key of Object.keys(a)) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) d[key] = a[key];
    for (const key of Object.keys(b)) if (!(key in a)) d[key] = null;
    if (Object.keys(d).length) patch[k] = d;
  }
  if (!base || JSON.stringify(next.recipes) !== JSON.stringify(base.recipes)) patch.recipes = next.recipes;
  if (!base || JSON.stringify(next.settings) !== JSON.stringify(base.settings)) patch.settings = next.settings;
  if (!base || JSON.stringify(next.seenStarterIds) !== JSON.stringify(base.seenStarterIds)) patch.seenStarterIds = next.seenStarterIds;
  return patch;
}

function createSupabaseStore({ url, key, createClient }) {
  const client = createClient(url, key, { auth: { persistSession: false } });
  const clientId = Math.random().toString(36).slice(2);
  let code = lsGet(CODE_KEY) || "";
  let base = null; // last state known to be saved on the server
  let latest = null;
  let timer = null;
  let inFlight = false;
  let channel = null;
  let listeners = [];
  let statusFn = () => {};
  let pollTimer = null;

  const pending = () => Boolean(timer || inFlight);

  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, { code, ...args });
    if (error) throw new Error(error.message || "Couldn't reach the server.");
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  async function refresh() {
    if (pending() || !code) return;
    try {
      const data = await rpc("ms_load", {});
      if (pending()) return;
      if (base && data.version === base.__version) return;
      base = { ...pick(data), __version: data.version };
      listeners.forEach((fn) => fn(data));
      statusFn("saved");
    } catch (e) {
      statusFn("offline", e.message);
    }
  }

  async function flush() {
    timer = null;
    if (!latest) return;
    const snapshot = latest;
    const patch = diffPatch(snapshot, base);
    if (!Object.keys(patch).length) return statusFn("saved");
    inFlight = true;
    statusFn("saving");
    try {
      const prevVersion = base ? base.__version : null;
      const res = await rpc("ms_save", { patch });
      // If someone else saved in between, our copy is missing their change: re-read.
      const missedOthers = prevVersion == null || res.version !== prevVersion + 1;
      base = { ...pick(snapshot), __version: missedOthers ? -1 : res.version };
      inFlight = false;
      statusFn("saved");
      channel && channel.send({ type: "broadcast", event: "changed", payload: { by: clientId, version: res.version } });
      if (latest !== snapshot) schedule();
      else if (missedOthers) refresh();
    } catch (e) {
      inFlight = false;
      statusFn("offline", e.message);
      timer = setTimeout(flush, 5000);
    }
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
    channel.subscribe();
  }

  const onVisible = () => document.visibilityState === "visible" && refresh();

  return {
    mode: "supabase",
    needsPasscode: true,
    hasPasscode: () => Boolean(code),
    async signIn(newCode) {
      const prev = code;
      code = String(newCode || "").trim();
      try {
        const data = await rpc("ms_load", {});
        lsSet(CODE_KEY, code);
        return data;
      } catch (e) {
        code = prev;
        throw e;
      }
    },
    async load() {
      const data = await rpc("ms_load", {});
      base = data.recipes ? { ...pick(data), __version: data.version } : null;
      connectRealtime(data.channel);
      clearInterval(pollTimer);
      pollTimer = setInterval(refresh, 30000);
      document.addEventListener("visibilitychange", onVisible);
      return data.recipes ? data : null;
    },
    persist(state) {
      latest = state;
      if (!base || Object.keys(diffPatch(state, base)).length) schedule();
    },
    subscribe(fn) {
      listeners.push(fn);
      return () => (listeners = listeners.filter((f) => f !== fn));
    },
    onStatus(fn) {
      statusFn = fn;
    },
    signOut() {
      code = "";
      lsSet(CODE_KEY, null);
      if (channel) client.removeChannel(channel);
      clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      base = null;
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
