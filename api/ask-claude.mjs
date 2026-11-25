// Vercel function: POST /api/ask-claude
// Fills in a recipe draft with Claude. The Anthropic API key lives only here,
// in the ANTHROPIC_API_KEY environment variable, and never reaches the browser.
//
// Body:  { code: "<household passcode>", draft: { title, description, cuisine, ... },
//          units: "us" | "metric", model: "claude-opus-5-5" | "claude-sonnet-5-5" | "claude-haiku-5-5" }
// Reply: { recipe: { title, emoji, cuisine, description, prepMin, cookMin, servings, ingredients, steps } }
//        or { error: "message" } with a 4xx/5xx status.
//
// Env: ANTHROPIC_API_KEY (required), SUPABASE_URL + SUPABASE_ANON_KEY (already set
// for the build), ANTHROPIC_MODEL (optional default when the request names no model).
// The household picks the model in Settings; the request's "model" must be on the allowlist.
import Anthropic from "@anthropic-ai/sdk";
import { pickModel, supportsFallback, buildPrompt, recipeSchema, cleanRecipe, cleanDraft } from "./_recipe-ai.mjs";

export const config = { maxDuration: 60 };


function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body);
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 50_000) throw new Error("too large");
  }
  return JSON.parse(raw || "{}");
}

// Same passcode check (and wrong-code throttling) the app itself uses.
// Prefers the lightweight ms_check RPC; falls back to ms_load where it doesn't exist yet.
async function checkPasscode(code) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { error: "The server is missing its Supabase settings." };
  const call = (fn) =>
    fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  let r = await call("ms_check");
  if (r.status === 404) r = await call("ms_load");
  if (!r.ok) return { error: "Couldn't check the passcode right now." };
  const data = await r.json().catch(() => null);
  if (!data || data.error) return { error: (data && data.error) || "Wrong passcode.", auth: true };
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) {
    return send(res, 503, { error: "Ask Claude isn't set up yet: add ANTHROPIC_API_KEY in Vercel." });
  }

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return send(res, 400, { error: "That request didn't look right." });
  }
  const code = String(body.code || "").trim();
  if (!code) return send(res, 401, { error: "Sign in with your household passcode first." });

  let draft;
  try {
    draft = cleanDraft(body.draft);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
  if (!draft.title && !draft.description) {
    return send(res, 400, { error: "Type a recipe name (or a short description) first." });
  }

  const auth = await checkPasscode(code);
  if (!auth.ok) return send(res, auth.auth ? 401 : 502, { error: auth.error });

  const model = pickModel(body.model, process.env.ANTHROPIC_MODEL);
  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      // If the main model declines, the API retries on a fallback model in the same call.
      ...(supportsFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: recipeSchema() },
      },
      system:
        "You write reliable, home-cook-friendly weeknight dinner recipes for a meal-planning app. " +
        "Use realistic grocery-store quantities so the app can build an accurate shopping list.",
      messages: [{ role: "user", content: buildPrompt(draft, body.units === "metric" ? "metric" : "us") }],
    });

    if (response.stop_reason === "refusal") {
      return send(res, 422, { error: "Claude couldn't help with that one. Try a different recipe name." });
    }
    if (response.stop_reason === "max_tokens") {
      return send(res, 502, { error: "Claude's answer was cut off. Please try again." });
    }
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return send(res, 502, { error: "Claude's answer couldn't be read. Please try again." });
    }
    return send(res, 200, { recipe: cleanRecipe(parsed), model: response.model });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return send(res, 503, { error: "The Anthropic API key in Vercel isn't working." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return send(res, 429, { error: "Claude is busy (or the spend limit was reached). Try again in a minute." });
    }
    if (err instanceof Anthropic.BadRequestError) {
      console.error("ask-claude bad request", err.message);
      return send(res, 502, { error: "Claude rejected the request. Check the server logs." });
    }
    if (err instanceof Anthropic.APIError) {
      console.error("ask-claude api error", err.status, err.message);
      return send(res, 502, { error: "Claude had a problem. Please try again." });
    }
    console.error("ask-claude", err);
    return send(res, 500, { error: "Something went wrong asking Claude." });
  }
}

