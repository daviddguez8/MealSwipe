// Pure helpers: units, scaling, aggregation, import parsing. No React here.

export const AISLES = [
  "Produce",
  "Meat/Seafood",
  "Dairy & Eggs",
  "Pantry & Grains",
  "Frozen",
  "Spices/Other",
];

export const UNIT_OPTIONS = [
  "", "tsp", "tbsp", "cup", "fl oz", "oz", "lb", "g", "kg", "ml", "l",
  "clove", "can", "bunch", "stalk", "pint", "piece", "package", "jar", "slice", "pinch",
];

const VOL = { tsp: 4.92892, tbsp: 14.7868, cup: 236.588, "fl oz": 29.5735, ml: 1, l: 1000 };
const WT = { oz: 28.3495, lb: 453.592, g: 1, kg: 1000 };
const US_UNITS = new Set(["tsp", "tbsp", "cup", "fl oz", "oz", "lb"]);

const UNIT_ALIASES = {
  teaspoon: "tsp", teaspoons: "tsp", t: "tsp",
  tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp", tbl: "tbsp",
  cups: "cup", c: "cup",
  ounce: "oz", ounces: "oz",
  pound: "lb", pounds: "lb", lbs: "lb",
  gram: "g", grams: "g", gr: "g",
  kilogram: "kg", kilograms: "kg", kgs: "kg",
  milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  liter: "l", liters: "l", litre: "l", litres: "l",
  floz: "fl oz", "fl. oz": "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz",
  each: "", ea: "", whole: "", x: "", unit: "", units: "", count: "",
  cloves: "clove", cans: "can", bunches: "bunch", stalks: "stalk", pints: "pint",
  pieces: "piece", packages: "package", pkg: "package", jars: "jar", slices: "slice",
  pinches: "pinch",
};

export function normUnit(u) {
  const s = String(u ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (s in UNIT_ALIASES) return UNIT_ALIASES[s];
  return s;
}

export function normName(name) {
  let s = String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  // light singularization of the last word, for matching only
  s = s.replace(/(\w+)(oes|ies|s)$/, (m, stem, suf) => {
    if (suf === "oes") return stem + "o";
    if (suf === "ies") return stem + "y";
    if (stem.endsWith("s") || stem.length < 3) return m;
    return stem;
  });
  return s;
}

const STAPLES = new Set(
  [
    "salt", "kosher salt", "sea salt", "black pepper", "pepper", "ground black pepper",
    "olive oil", "extra-virgin olive oil", "extra virgin olive oil", "vegetable oil",
    "canola oil", "cooking spray", "water", "sugar", "granulated sugar", "all-purpose flour",
  ].map(normName)
);

export function isStaple(ing) {
  return Boolean(ing.staple) || STAPLES.has(normName(ing.name));
}

function pluralWord(w) {
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + "ies";
  if (/(s|sh|ch|x|z)$/i.test(w)) return w + "es";
  if (/(potato|tomato)$/i.test(w)) return w + "es";
  return w + "s";
}

export function pluralName(name) {
  const m = String(name).match(/^(.*?)(\s*\(.*\))?$/);
  const base = m[1];
  const tail = m[2] || "";
  if (/s$/i.test(base)) return name;
  const words = base.split(" ");
  words[words.length - 1] = pluralWord(words[words.length - 1]);
  return words.join(" ") + tail;
}

function unitLabel(unit, qty) {
  if (!unit) return "";
  if (VOL[unit] || WT[unit]) return unit === "cup" && qty > 1.001 ? "cups" : unit;
  return qty > 1.001 ? pluralWord(unit) : unit;
}

const FRACTIONS = [
  [0, ""], [1 / 8, "⅛"], [1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"], [1, ""],
];

export function formatQty(n, unit = "") {
  if (!isFinite(n) || n <= 0) return "";
  if (unit === "g" || unit === "ml") return String(Math.round(n));
  if (unit === "kg" || unit === "l") return String(Math.round(n * 100) / 100);
  if (n >= 10) return String(Math.round(n));
  let whole = Math.floor(n);
  const frac = n - whole;
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] - frac) < Math.abs(best[0] - frac)) best = f;
  if (best[0] === 1) whole += 1;
  const glyph = best[0] === 1 ? "" : best[1];
  if (whole === 0 && !glyph) return "⅛";
  return whole === 0 ? glyph : glyph ? `${whole} ${glyph}` : String(whole);
}

export function unitFamily(unit) {
  const u = normUnit(unit);
  if (VOL[u]) return "vol";
  if (WT[u]) return "wt";
  return "count:" + u;
}

function roundTo(n, step) {
  return Math.max(step, Math.round(n / step) * step);
}

// Convert an amount to the display system. For US with a US unit already, keep it.
export function toDisplay(qty, unit, system, { keepUnit = false } = {}) {
  const u = normUnit(unit);
  if (VOL[u]) {
    if (system === "us" && keepUnit && US_UNITS.has(u)) return { qty, unit: u };
    const ml = qty * VOL[u];
    if (system === "metric") {
      if (ml >= 1000) return { qty: Math.round(ml / 100) / 10, unit: "l" };
      return { qty: ml >= 30 ? roundTo(ml, 5) : Math.round(ml), unit: "ml" };
    }
    if (ml >= 59) return { qty: ml / VOL.cup, unit: "cup" };
    const tb = ml / VOL.tbsp;
    if (ml >= 14 && (Math.abs(tb * 2 - Math.round(tb * 2)) < 0.1 || ml >= 44)) return { qty: tb, unit: "tbsp" };
    return { qty: ml / VOL.tsp, unit: "tsp" };
  }
  if (WT[u]) {
    if (system === "us" && keepUnit && US_UNITS.has(u)) return { qty, unit: u };
    const g = qty * WT[u];
    if (system === "metric") {
      if (g >= 1000) return { qty: Math.round(g / 10) / 100, unit: "kg" };
      return { qty: g >= 30 ? roundTo(g, 5) : Math.round(g), unit: "g" };
    }
    if (g >= 453) return { qty: g / WT.lb, unit: "lb" };
    return { qty: roundTo(g / WT.oz, 0.5), unit: "oz" };
  }
  return { qty, unit: u };
}

export function toBase(qty, unit) {
  const u = normUnit(unit);
  if (VOL[u]) return qty * VOL[u];
  if (WT[u]) return qty * WT[u];
  return qty;
}

// "2 yellow onions", "3 cloves garlic", "1 ½ lb flank steak"
export function formatAmount(qty, unit, name) {
  const q = formatQty(qty, unit);
  if (!unit) return `${q} ${qty > 1.001 ? pluralName(name) : name}`;
  return `${q} ${unitLabel(unit, qty)} ${name}`;
}

export function formatIngredient(ing, mult, system) {
  const d = toDisplay((Number(ing.qty) || 0) * mult, ing.unit, system, { keepUnit: true });
  if (!d.qty) return ing.name;
  return formatAmount(d.qty, d.unit, ing.name);
}

// ---------------------------------------------------------------------------
// Meal math. A recipe at multiplier m makes servings*m portions; each dinner
// for the household uses `household` portions.
export function portionsOf(recipe, mult) {
  return (Number(recipe.servings) || 1) * mult;
}

export function fitMultiplier(recipe, household) {
  const m = household / (Number(recipe.servings) || 1);
  return Math.max(0.25, Math.round(m * 4) / 4);
}

export const MULT_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

export function stepMult(m, dir) {
  const i = MULT_STEPS.findIndex((s) => s >= m - 1e-9);
  const idx = i === -1 ? MULT_STEPS.length - 1 : i;
  const exact = Math.abs(MULT_STEPS[idx] - m) < 1e-9;
  if (dir > 0) return MULT_STEPS[Math.min(MULT_STEPS.length - 1, exact ? idx + 1 : idx)];
  return MULT_STEPS[Math.max(0, idx - 1)];
}

export function weekSummary(planList, household, target) {
  let portions = 0;
  for (const { recipe, mult } of planList) portions += portionsOf(recipe, mult);
  const dinners = portions / household;
  const needed = target * household;
  return { portions, dinners, needed, recipes: planList.length, remaining: target - dinners };
}

export function formatDinners(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// ---------------------------------------------------------------------------
// Grocery aggregation
const ROUND_UP_COUNTS = true;

export function buildGroceryList(planList, system) {
  const items = new Map();
  for (const { recipe, mult } of planList) {
    for (const ing of recipe.ingredients || []) {
      if (!ing.name) continue;
      const key = normName(ing.name);
      let item = items.get(key);
      if (!item) {
        item = {
          key,
          name: String(ing.name).trim(),
          aisle: AISLES.includes(ing.aisle) ? ing.aisle : "Spices/Other",
          staple: isStaple(ing),
          parts: new Map(),
          recipes: [],
        };
        items.set(key, item);
      }
      if (ing.staple) item.staple = true;
      const fam = unitFamily(ing.unit);
      const amount = toBase((Number(ing.qty) || 0) * mult, ing.unit);
      item.parts.set(fam, (item.parts.get(fam) || 0) + amount);
      if (!item.recipes.includes(recipe.title)) item.recipes.push(recipe.title);
    }
  }

  const out = [];
  for (const item of items.values()) {
    const shown = [];
    for (const [fam, amount] of item.parts) {
      if (!amount) continue;
      if (fam === "vol") shown.push(toDisplay(amount, "ml", system));
      else if (fam === "wt") shown.push(toDisplay(amount, "g", system));
      else {
        const unit = fam.slice(6);
        shown.push({ qty: ROUND_UP_COUNTS ? Math.ceil(amount - 0.05) || 1 : amount, unit });
      }
    }
    let text;
    if (shown.length === 0) text = item.name;
    else if (shown.length === 1) text = formatAmount(shown[0].qty, shown[0].unit, item.name);
    else
      text = `${item.name}: ${shown
        .map((s) => `${formatQty(s.qty, s.unit)}${s.unit ? " " + unitLabel(s.unit, s.qty) : ""}`)
        .join(" + ")}`;
    out.push({ key: item.key, text, aisle: item.aisle, staple: item.staple, recipes: item.recipes, name: item.name });
  }

  const groups = AISLES.map((aisle) => ({
    aisle,
    items: out.filter((i) => i.aisle === aisle).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.items.length);
  return groups;
}

export function groceryText({ groups, planList, household, target, hideStaples, system, summary }) {
  const lines = [];
  lines.push(`MealSwipe grocery list (${household} ${household === 1 ? "person" : "people"}, ${formatDinners(summary.dinners)} of ${target} dinners, ${system === "us" ? "US" : "metric"} units)`);
  lines.push("");
  lines.push("This week's dinners:");
  for (const { recipe, mult } of planList) {
    const portions = portionsOf(recipe, mult);
    const d = portions / household;
    lines.push(`- ${recipe.title} (${mult}x, ${formatQty(portions)} servings = ${formatDinners(d)} ${d === 1 ? "dinner" : "dinners"})`);
  }
  for (const g of groups) {
    const items = g.items.filter((i) => !(hideStaples && i.staple));
    if (!items.length) continue;
    lines.push("");
    lines.push(g.aisle.toUpperCase());
    for (const i of items) lines.push(`- ${i.text}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Import / validation
function normAisle(a) {
  const s = String(a ?? "").toLowerCase();
  if (/produce|fruit|veg/.test(s)) return "Produce";
  if (/meat|seafood|fish|poultry|butcher/.test(s)) return "Meat/Seafood";
  if (/dairy|egg|cheese/.test(s)) return "Dairy & Eggs";
  if (/frozen/.test(s)) return "Frozen";
  if (/pantry|grain|canned|dry|baking|bread/.test(s)) return "Pantry & Grains";
  if (/spice|other|season|condiment/.test(s)) return "Spices/Other";
  return "Spices/Other";
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function normalizeRecipe(r, i = 0) {
  if (!r || typeof r !== "object") throw new Error(`Recipe ${i + 1} is not an object.`);
  const title = String(r.title ?? r.name ?? "").trim();
  if (!title) throw new Error(`Recipe ${i + 1} needs a "title".`);
  const ingsIn = r.ingredients;
  if (!Array.isArray(ingsIn) || !ingsIn.length) throw new Error(`"${title}" needs an "ingredients" list.`);
  const ingredients = ingsIn
    .map((g) => ({
      name: String(g.name ?? g.item ?? "").trim(),
      qty: Number(g.qty ?? g.quantity ?? g.amount ?? 0) || 0,
      unit: normUnit(g.unit ?? ""),
      aisle: normAisle(g.aisle ?? g.category ?? ""),
      ...(g.staple ? { staple: true } : {}),
    }))
    .filter((g) => g.name);
  if (!ingredients.length) throw new Error(`"${title}" has no named ingredients.`);
  const total = Number(r.totalMin ?? r.time ?? 0) || 0;
  const prepMin = Number(r.prepMin ?? r.prep ?? (total ? Math.round(total / 3) : 15)) || 0;
  const cookMin = Number(r.cookMin ?? r.cook ?? (total ? total - prepMin : 20)) || 0;
  return {
    id: String(r.id || `c-${slug(title)}`),
    title,
    cuisine: String(r.cuisine ?? "Other").trim() || "Other",
    emoji: r.emoji ? String(r.emoji) : "",
    ...(r.image ? { image: String(r.image) } : {}),
    ...(r.description ? { description: String(r.description) } : {}),
    ...(() => {
      const st = Array.isArray(r.steps) ? r.steps : typeof r.steps === "string" ? r.steps.split(/\n+/) : [];
      const clean = st.map((x) => String(x).replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
      return clean.length ? { steps: clean } : {};
    })(),
    ...(r.photoCredit && typeof r.photoCredit === "object" ? { photoCredit: r.photoCredit } : {}),
    prepMin,
    cookMin,
    servings: Math.max(1, Number(r.servings) || 4),
    ingredients,
    ...(r.custom === false ? {} : r.id && String(r.id).startsWith("s-") ? {} : { custom: true }),
  };
}

export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("That isn't valid JSON. Check for a missing comma or bracket.");
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.recipes) ? data.recipes : data && data.title ? [data] : null;
  if (!list) throw new Error('Paste a list of recipes, or an object with a "recipes" list.');
  return list.map(normalizeRecipe);
}

// Merge imported recipes into the current list: same id or same title updates.
export function mergeRecipes(current, incoming) {
  const next = current.slice();
  let added = 0;
  let updated = 0;
  for (const r of incoming) {
    const idx = next.findIndex((c) => c.id === r.id || c.title.toLowerCase() === r.title.toLowerCase());
    if (idx >= 0) {
      next[idx] = { ...r, id: next[idx].id };
      updated++;
    } else {
      let id = r.id;
      while (next.some((c) => c.id === id)) id = `${r.id}-${Math.random().toString(36).slice(2, 5)}`;
      next.unshift({ ...r, id });
      added++;
    }
  }
  return { recipes: next, added, updated };
}

const CUISINE_COLORS = {
  mexican: ["#FF8A3D", "#C81D4E"],
  "tex-mex": ["#FFB238", "#D6402B"],
  italian: ["#EE6B4D", "#7C2340"],
  "chinese-american": ["#F2A541", "#B23A48"],
  chinese: ["#F2A541", "#B23A48"],
  thai: ["#95C45F", "#1F7A57"],
  mediterranean: ["#46A9D9", "#1C4A86"],
  greek: ["#46A9D9", "#1C4A86"],
  indian: ["#F7B32B", "#D9541E"],
  american: ["#5E9C86", "#21434F"],
  korean: ["#F25C78", "#9E1846"],
  japanese: ["#E86A6A", "#3A3F70"],
};
const FALLBACK_COLORS = [
  ["#2EC4B6", "#14607A"], ["#FF9F1C", "#B5361C"], ["#E76F51", "#6D213C"], ["#7FB069", "#2D5D46"], ["#4D9DE0", "#283D7A"],
];
const CUISINE_EMOJI = {
  mexican: "🌮", italian: "🍝", thai: "🍜", indian: "🍛", korean: "🍚", chinese: "🥢", "chinese-american": "🥡",
  mediterranean: "🫒", greek: "🥙", american: "🍔", japanese: "🍣", french: "🥖", other: "🍽️",
};

export function cardColors(recipe) {
  const c = String(recipe.cuisine || "").toLowerCase();
  if (CUISINE_COLORS[c]) return CUISINE_COLORS[c];
  let h = 0;
  for (const ch of c + recipe.title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

export function cardEmoji(recipe) {
  return recipe.emoji || CUISINE_EMOJI[String(recipe.cuisine || "").toLowerCase()] || "🍽️";
}

// ---------------------------------------------------------------------------
// "Ask Claude" form helpers. The form keeps two kinds of marks:
//   touched[key]        the person edited this field (Claude must not overwrite it)
//   ai[key]             Claude filled this field (shown highlighted until edited)
// Ingredient rows carry their own row._touched / row._ai objects keyed by
// name | qty | unit | aisle. Keys starting with "_" are dropped on save.
// Models offered in Settings. The server only accepts these ids (api/_recipe-ai.mjs).
export const AI_MODELS = [
  ["claude-opus-5-5", "Opus 5.5", "Best results, about 3 to 5¢ a fill"],
  ["claude-sonnet-5-5", "Sonnet 5.5", "Faster, about 1 to 2¢ a fill"],
  ["claude-haiku-5-5", "Haiku 5.5", "Fastest, a fraction of a cent"],
];
export const DEFAULT_AI_MODEL = "claude-opus-5-5";

export const AI_FORM_KEYS = ["title", "emoji", "cuisine", "description", "prepMin", "cookMin", "servings", "stepsText"];

const blank = (v) => v == null || String(v).trim() === "";

// What to send to Claude: only what the person actually provided.
export function draftForAi(form, touched) {
  const d = { title: form.title, description: form.description, cuisine: form.cuisine, ingredients: [], steps: [] };
  for (const k of ["prepMin", "cookMin", "servings"]) if (touched[k] && !blank(form[k])) d[k] = Number(form[k]);
  for (const g of form.ingredients || []) {
    if (blank(g.name)) continue;
    const t = g._touched || {};
    const row = { name: g.name.trim() };
    if (!blank(g.qty)) row.qty = Number(g.qty);
    if (t.unit || !blank(g.qty)) row.unit = g.unit;
    if (t.aisle) row.aisle = g.aisle;
    d.ingredients.push(row);
  }
  d.steps = String(form.stepsText || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  return d;
}

function sameIngredient(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// Merge Claude's recipe into the form without touching anything the person wrote.
// Returns { form, ai } where ai marks the top-level fields Claude filled.
export function mergeAiRecipe(form, touched, aiRecipe, prevAi = {}) {
  const next = { ...form };
  const ai = { ...prevAi };
  const fill = (key, value, canFill) => {
    if (!canFill || blank(value)) return;
    next[key] = value;
    ai[key] = true;
  };
  // A field Claude filled earlier (and nobody edited since) can be refreshed on a second ask.
  const free = (key) => !touched[key] && (blank(form[key]) || ai[key]);
  fill("title", aiRecipe.title, blank(form.title));
  fill("emoji", aiRecipe.emoji, free("emoji"));
  fill("cuisine", aiRecipe.cuisine, free("cuisine"));
  fill("description", aiRecipe.description, free("description"));
  for (const k of ["prepMin", "cookMin", "servings"]) fill(k, aiRecipe[k] != null ? String(aiRecipe[k]) : "", !touched[k]);
  fill("stepsText", (aiRecipe.steps || []).join("\n"), free("stepsText"));

  // Ingredients: keep the person's rows (and finish them), replace Claude's earlier
  // untouched rows, drop empty rows, then add what's still missing.
  const theirs = (form.ingredients || []).filter((g) => !blank(g.name) && !(g._ai && g._ai.name && !Object.keys(g._touched || {}).length));
  const pool = [...(aiRecipe.ingredients || [])];
  const rows = theirs.map((g) => {
    const idx = pool.findIndex((p) => sameIngredient(p.name, g.name));
    if (idx < 0) return g;
    const p = pool.splice(idx, 1)[0];
    const t = g._touched || {};
    const row = { ...g, _ai: { ...(g._ai || {}) } };
    if (blank(g.qty) && !t.qty) {
      row.qty = String(p.qty);
      row._ai.qty = true;
      if (!t.unit) {
        row.unit = p.unit;
        row._ai.unit = true;
      }
    }
    if (!t.aisle) {
      row.aisle = p.aisle;
      row._ai.aisle = true;
    }
    return row;
  });
  for (const p of pool) {
    rows.push({ name: p.name, qty: String(p.qty), unit: p.unit, aisle: p.aisle, _ai: { name: true, qty: true, unit: true, aisle: true } });
  }
  next.ingredients = rows.length ? rows : form.ingredients;
  return { form: next, ai };
}
