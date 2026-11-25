// Run: npm test
// Covers the Ask Claude server function (with Supabase and the Anthropic API faked)
// and the browser-side merge rules in src/lib.js.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as ai from "../api/_recipe-ai.mjs";

// src/lib.js is ESM inside a CommonJS package, so load a .mjs copy of it.
const libCopy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ms-")), "lib.mjs");
fs.copyFileSync(new URL("../src/lib.js", import.meta.url), libCopy);
const lib = await import(pathToFileURL(libCopy).href);

test("server allowlists stay in sync with the app", () => {
  assert.deepEqual(ai.AISLES, lib.AISLES);
  assert.deepEqual(ai.UNIT_OPTIONS, lib.UNIT_OPTIONS);
  assert.deepEqual(ai.AI_MODELS, lib.AI_MODELS.map(([id]) => id));
  assert.equal(lib.DEFAULT_AI_MODEL, ai.AI_MODELS[0]);
});

test("pickModel only accepts listed models", () => {
  assert.equal(ai.pickModel("claude-haiku-5-5"), "claude-haiku-5-5");
  assert.equal(ai.pickModel("gpt-whatever", "claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(ai.pickModel("nope", "nope"), "claude-opus-5-5");
});

test("cleanDraft rejects oversized input and drops empty rows", () => {
  assert.throws(() => ai.cleanDraft({ title: "x".repeat(200) }), /too long/);
  const d = ai.cleanDraft({ title: " Pozole ", ingredients: [{ name: "" }, { name: "hominy", qty: "2", unit: "can", aisle: "Pantry & Grains" }] });
  assert.equal(d.title, "Pozole");
  assert.deepEqual(d.ingredients, [{ name: "hominy", qty: 2, unit: "can", aisle: "Pantry & Grains" }]);
});

test("cleanRecipe clamps numbers and forces allowed units/aisles", () => {
  const r = ai.cleanRecipe({ title: "T", emoji: "", servings: 999, prepMin: -5, ingredients: [{ name: "salt", qty: 0, unit: "smidge", aisle: "Junk" }], steps: ["a", ""] });
  assert.equal(r.servings, 24);
  assert.equal(r.prepMin, 0);
  assert.equal(r.emoji, "🍽️");
  assert.deepEqual(r.ingredients[0], { name: "salt", qty: 1, unit: "", aisle: "Spices/Other" });
  assert.deepEqual(r.steps, ["a"]);
});

test("draftForAi sends only what the person provided", () => {
  const form = {
    title: "Chicken tinga", description: "smoky", cuisine: "", prepMin: 15, cookMin: 20, servings: "6", stepsText: "",
    ingredients: [{ name: "chicken thighs", qty: "", unit: "", aisle: "Produce" }, { name: "", qty: "", unit: "", aisle: "Produce" }],
  };
  const d = lib.draftForAi(form, { servings: true });
  assert.equal(d.servings, 6);
  assert.equal(d.prepMin, undefined);
  assert.deepEqual(d.ingredients, [{ name: "chicken thighs" }]);
});

const claudeRecipe = {
  title: "Chicken Tinga", emoji: "🌮", cuisine: "Mexican", description: "Smoky shredded chicken.",
  prepMin: 10, cookMin: 30, servings: 4,
  ingredients: [
    { name: "chicken thigh", qty: 1.5, unit: "lb", aisle: "Meat/Seafood" },
    { name: "chipotle in adobo", qty: 1, unit: "can", aisle: "Pantry & Grains" },
    { name: "white onion", qty: 1, unit: "", aisle: "Produce" },
  ],
  steps: ["Simmer the chicken.", "Blend the sauce.", "Shred and combine."],
};

test("mergeAiRecipe never overwrites what the person typed, and marks what it filled", () => {
  const form = {
    title: "chicken tinga", emoji: "", cuisine: "", description: "my way", prepMin: 15, cookMin: 20, servings: "6", stepsText: "",
    ingredients: [
      { name: "chicken thighs", qty: "", unit: "", aisle: "Produce", _touched: { name: true } },
      { name: "", qty: "", unit: "", aisle: "Produce" },
    ],
  };
  const touched = { title: true, description: true, servings: true };
  const { form: out, ai: marks } = lib.mergeAiRecipe(form, touched, claudeRecipe);
  assert.equal(out.title, "chicken tinga");
  assert.equal(out.description, "my way");
  assert.equal(out.servings, "6");
  assert.equal(out.cuisine, "Mexican");
  assert.equal(out.prepMin, "10");
  assert.equal(out.stepsText, claudeRecipe.steps.join("\n"));
  assert.deepEqual(marks, { emoji: true, cuisine: true, prepMin: true, cookMin: true, stepsText: true });
  // The person's row is finished, not replaced; the empty row is gone; new rows are marked.
  assert.equal(out.ingredients.length, 3);
  assert.equal(out.ingredients[0].name, "chicken thighs");
  assert.equal(out.ingredients[0].qty, "1.5");
  assert.equal(out.ingredients[0].unit, "lb");
  assert.equal(out.ingredients[0].aisle, "Meat/Seafood");
  assert.deepEqual(out.ingredients[0]._ai, { qty: true, unit: true, aisle: true });
  assert.deepEqual(out.ingredients[2]._ai, { name: true, qty: true, unit: true, aisle: true });

  // Asking again replaces Claude's own untouched rows instead of duplicating them.
  const again = lib.mergeAiRecipe(out, touched, claudeRecipe, marks);
  assert.equal(again.form.ingredients.length, 3);
});

// ---------------------------------------------------------------------------
// The HTTP handler, with Supabase and the Anthropic API replaced by a fake fetch.
function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b; },
    json() { return JSON.parse(this.body); },
  };
}

async function withFakes({ passcodeOk = true, msCheckMissing = false, claude = claudeRecipe, stop = "end_turn" }, fn) {
  const calls = [];
  const realFetch = globalThis.fetch;
  const env = { ...process.env };
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.SUPABASE_URL = "https://fake.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon";
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url instanceof Request ? url.url : url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url: u, body, headers: init.headers });
    if (u.includes("/rpc/ms_check") && msCheckMissing) return new Response("{}", { status: 404 });
    if (u.includes("/rpc/")) return Response.json(passcodeOk ? { ok: true } : { error: "That passcode doesn't match a household." });
    if (u.includes("api.anthropic.com")) {
      return Response.json({
        id: "msg_1", type: "message", role: "assistant", model: body.model, stop_reason: stop, stop_sequence: null,
        content: [{ type: "text", text: JSON.stringify(claude) }],
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    }
    throw new Error("unexpected fetch " + u);
  };
  try {
    const { default: handler } = await import("../api/ask-claude.mjs");
    await fn(handler, calls);
  } finally {
    globalThis.fetch = realFetch;
    process.env = env;
  }
}

const post = (body) => ({ method: "POST", body });

test("handler: checks the passcode, then calls Claude with the chosen model and a JSON schema", async () => {
  await withFakes({}, async (handler, calls) => {
    const res = fakeRes();
    await handler(post({ code: "secret123", draft: { title: "Chicken tinga" }, units: "us", model: "claude-sonnet-5-5" }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().recipe.title, "Chicken Tinga");
    assert.match(calls[0].url, /rpc\/ms_check$/);
    assert.deepEqual(calls[0].body, { code: "secret123" });
    const api = calls.find((c) => c.url.includes("api.anthropic.com"));
    assert.equal(api.body.model, "claude-sonnet-5-5");
    assert.equal(api.body.output_config.format.type, "json_schema");
    assert.equal(api.body.output_config.effort, "low");
    assert.equal(api.body.fallbacks, "default");
    assert.equal(api.body.thinking, undefined);
    assert.match(api.body.messages[0].content, /Chicken tinga/);
  });
});

test("handler: Haiku goes without server-side fallbacks", async () => {
  await withFakes({}, async (handler, calls) => {
    const res = fakeRes();
    await handler(post({ code: "secret123", draft: { title: "Soup" }, model: "claude-haiku-5-5" }), res);
    assert.equal(res.statusCode, 200, res.body);
    const api = calls.find((c) => c.url.includes("api.anthropic.com"));
    assert.equal(api.body.fallbacks, undefined);
  });
});

test("handler: falls back to ms_load where ms_check doesn't exist yet", async () => {
  await withFakes({ msCheckMissing: true }, async (handler, calls) => {
    const res = fakeRes();
    await handler(post({ code: "secret123", draft: { title: "Soup" } }), res);
    assert.equal(res.statusCode, 200, res.body);
    assert.match(calls[1].url, /rpc\/ms_load$/);
  });
});

test("handler: wrong passcode never reaches Claude", async () => {
  await withFakes({ passcodeOk: false }, async (handler, calls) => {
    const res = fakeRes();
    await handler(post({ code: "nope", draft: { title: "Soup" } }), res);
    assert.equal(res.statusCode, 401);
    assert.ok(!calls.some((c) => c.url.includes("anthropic")));
  });
});

test("handler: refusals and missing input give clear errors", async () => {
  await withFakes({ stop: "refusal" }, async (handler) => {
    const res = fakeRes();
    await handler(post({ code: "secret123", draft: { title: "Soup" } }), res);
    assert.equal(res.statusCode, 422);
    const res2 = fakeRes();
    await handler(post({ code: "secret123", draft: { title: "" } }), res2);
    assert.equal(res2.statusCode, 400);
    const res3 = fakeRes();
    await handler({ method: "GET" }, res3);
    assert.equal(res3.statusCode, 405);
  });
});
