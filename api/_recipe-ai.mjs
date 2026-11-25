// Helpers for /api/ask-claude: input cleanup, the prompt, the output schema,
// and output cleanup. The leading underscore keeps Vercel from serving this as a route.
//
// AISLES and UNIT_OPTIONS mirror src/lib.js (that file is bundled for the browser
// and can't be imported here). test/ask-claude.test.mjs checks they stay in sync.

export const AISLES = ["Produce", "Meat/Seafood", "Dairy & Eggs", "Pantry & Grains", "Frozen", "Spices/Other"];
export const UNIT_OPTIONS = [
  "", "tsp", "tbsp", "cup", "fl oz", "oz", "lb", "g", "kg", "ml", "l",
  "clove", "can", "bunch", "stalk", "pint", "piece", "package", "jar", "slice", "pinch",
];

// The models the Settings view offers (mirrors AI_MODELS in src/lib.js).
export const AI_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];
export function pickModel(requested, envDefault) {
  if (AI_MODELS.includes(requested)) return requested;
  if (AI_MODELS.includes(envDefault)) return envDefault;
  return AI_MODELS[0];
}
// Haiku has no server-side refusal fallback; Opus and Sonnet use the API's default routing.
export const supportsFallback = (model) => model !== "claude-haiku-5-5";

const str = (v, max, label) => {
  const s = v == null ? "" : String(v).trim();
  if (s.length > max) throw new Error(`${label} is too long (max ${max} characters).`);
  return s;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// What the browser sent: only the fields the person actually filled in.
export function cleanDraft(d) {
  if (!d || typeof d !== "object") throw new Error("Missing recipe draft.");
  const ings = Array.isArray(d.ingredients) ? d.ingredients : [];
  if (ings.length > 60) throw new Error("Too many ingredients.");
  const steps = Array.isArray(d.steps) ? d.steps : [];
  if (steps.length > 40) throw new Error("Too many steps.");
  return {
    title: str(d.title, 120, "The title"),
    description: str(d.description, 1500, "The description"),
    cuisine: str(d.cuisine, 40, "The cuisine"),
    prepMin: num(d.prepMin),
    cookMin: num(d.cookMin),
    servings: num(d.servings),
    ingredients: ings
      .map((g) => ({
        name: str(g && g.name, 80, "An ingredient name"),
        qty: num(g && g.qty),
        unit: UNIT_OPTIONS.includes(g && g.unit) ? g.unit : null,
        aisle: AISLES.includes(g && g.aisle) ? g.aisle : null,
      }))
      .filter((g) => g.name),
    steps: steps.map((s) => str(s, 500, "A step")).filter(Boolean),
  };
}

export function buildPrompt(draft, units) {
  const known = [];
  if (draft.title) known.push(`Recipe name: ${draft.title}`);
  if (draft.description) known.push(`Description from the cook: ${draft.description}`);
  if (draft.cuisine) known.push(`Cuisine: ${draft.cuisine}`);
  if (draft.servings) known.push(`Servings: ${draft.servings} (keep this number)`);
  if (draft.prepMin) known.push(`Prep time: ${draft.prepMin} min (keep this)`);
  if (draft.cookMin) known.push(`Cook time: ${draft.cookMin} min (keep this)`);
  if (draft.ingredients.length) {
    known.push(
      "Ingredients the cook already listed (include every one, keep their names and any quantity/unit given, fill in what's missing):\n" +
        draft.ingredients
          .map((g) => `- ${g.name}${g.qty ? ` | qty ${g.qty}` : ""}${g.unit != null ? ` | unit "${g.unit || "each"}"` : ""}`)
          .join("\n")
    );
  }
  if (draft.steps.length) {
    known.push("Steps the cook already wrote (keep them, in order; you may add missing ones):\n" + draft.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  }

  return `Complete this recipe for a home cook. Treat everything the cook wrote as given, and fill in the rest.

<cook_input>
${known.join("\n\n")}
</cook_input>

Rules:
- title: the cook's name for it, tidied up (fix capitalization or typos only). If they only gave a description, name the dish.
- emoji: one food emoji that fits the dish.
- cuisine: one or two words, e.g. "Mexican", "Italian", "Thai".
- description: one or two appetizing sentences. If the cook wrote one, return theirs unchanged.
- prepMin, cookMin: realistic whole minutes. servings: whole number, default 4.
- ingredients: the full list for the stated servings, as you'd buy them. Use ${units === "metric" ? "metric units (g, kg, ml, l)" : "US units (tsp, tbsp, cup, oz, lb)"} for weights and volumes.
  - name: the grocery item, singular for countable things ("yellow onion", "lime", "garlic").
  - unit: one of the allowed values. Use "" (meaning "each") for whole countable items like onions or eggs, "clove" for garlic, "can" for canned goods.
  - qty: a number (decimals like 0.5 are fine), never 0.
  - aisle: the supermarket section. Salt, pepper, dried spices, and oils go in "Spices/Other"; rice, pasta, flour, broth, and canned goods in "Pantry & Grains".
- steps: 4 to 10 clear steps, one action-focused sentence or two each, no numbering.`;
}

export function recipeSchema() {
  return {
    type: "object",
    properties: {
      title: { type: "string" },
      emoji: { type: "string" },
      cuisine: { type: "string" },
      description: { type: "string" },
      prepMin: { type: "integer" },
      cookMin: { type: "integer" },
      servings: { type: "integer" },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            qty: { type: "number" },
            unit: { type: "string", enum: UNIT_OPTIONS },
            aisle: { type: "string", enum: AISLES },
          },
          required: ["name", "qty", "unit", "aisle"],
          additionalProperties: false,
        },
      },
      steps: { type: "array", items: { type: "string" } },
    },
    required: ["title", "emoji", "cuisine", "description", "prepMin", "cookMin", "servings", "ingredients", "steps"],
    additionalProperties: false,
  };
}

// Never trust the shape blindly: clamp numbers and drop anything odd.
export function cleanRecipe(r) {
  const s = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
  const int = (v, lo, hi, dflt) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  return {
    title: s(r.title, 120),
    emoji: [...s(r.emoji, 16)].slice(0, 2).join("") || "🍽️",
    cuisine: s(r.cuisine, 40),
    description: s(r.description, 1500),
    prepMin: int(r.prepMin, 0, 600, 15),
    cookMin: int(r.cookMin, 0, 1440, 20),
    servings: int(r.servings, 1, 24, 4),
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : [])
      .slice(0, 60)
      .map((g) => ({
        name: s(g && g.name, 80),
        qty: Number(g && g.qty) > 0 ? Math.round(Number(g.qty) * 100) / 100 : 1,
        unit: UNIT_OPTIONS.includes(g && g.unit) ? g.unit : "",
        aisle: AISLES.includes(g && g.aisle) ? g.aisle : "Spices/Other",
      }))
      .filter((g) => g.name),
    steps: (Array.isArray(r.steps) ? r.steps : []).map((x) => s(x, 500)).filter(Boolean).slice(0, 20),
  };
}
