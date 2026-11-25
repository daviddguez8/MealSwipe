// ============================================================================
// Group by and sort for the Recipes tab. Pure functions, no React.
//
// organizeRecipes(recipes, { q, groupBy, sortBy, ctx })
//   -> [{ key, label, items: [recipe, ...] }]   (one group with key "all" when groupBy is "none")
//
// ctx lets the app plug in data that doesn't live on the recipe itself:
//   ctx.ratingOf(recipe) -> number 1..5, or null when unrated
//   ctx.statusOf(recipe) -> "week" | "deck" | "passed"
// Ratings come from the household's data; until they exist every recipe is unrated.
// ============================================================================

export const GROUP_OPTIONS = [
  { value: "none", label: "No grouping" },
  { value: "cuisine", label: "Cuisine" },
  { value: "time", label: "Total time" },
  { value: "protein", label: "Main protein" },
  { value: "rating", label: "Rating" },
  { value: "status", label: "Status" },
  { value: "source", label: "Source" },
];

export const SORT_OPTIONS = [
  { value: "recent", label: "Recently added" },
  { value: "name", label: "Name A to Z" },
  { value: "quickest", label: "Quickest first" },
  { value: "rating", label: "Highest rated" },
  { value: "fewest", label: "Fewest ingredients" },
];

export const DEFAULT_VIEW = { groupBy: "none", sortBy: "recent" };

export function totalMin(r) {
  return (Number(r.prepMin) || 0) + (Number(r.cookMin) || 0);
}

// --- Time buckets -----------------------------------------------------------
const TIME_BUCKETS = [
  { key: "t30", label: "Under 30 min", max: 29 },
  { key: "t45", label: "30 to 45 min", max: 45 },
  { key: "t60", label: "45 to 60 min", max: 60 },
  { key: "t60+", label: "Over 60 min", max: Infinity },
];
function timeBucket(r) {
  const t = totalMin(r);
  return TIME_BUCKETS.find((b) => t <= b.max);
}

// --- Main protein -----------------------------------------------------------
// The first Meat/Seafood ingredient decides it; recipes with none are Vegetarian.
const PROTEINS = [
  { key: "chicken", label: "Chicken", words: ["chicken"] },
  { key: "turkey", label: "Turkey", words: ["turkey"] },
  { key: "beef", label: "Beef", words: ["beef", "steak", "brisket", "sirloin", "ribeye", "chuck", "short rib", "veal"] },
  { key: "pork", label: "Pork", words: ["pork", "sausage", "bacon", "ham", "chorizo", "prosciutto", "pancetta", "carnitas"] },
  { key: "lamb", label: "Lamb", words: ["lamb", "mutton", "goat"] },
  {
    key: "seafood",
    label: "Seafood",
    words: ["shrimp", "prawn", "salmon", "fish", "cod", "tuna", "tilapia", "halibut", "scallop", "crab", "lobster", "mussel", "clam", "squid", "calamari", "mahi", "snapper", "trout", "anchov"],
  },
  { key: "other", label: "Other meat", words: [] },
  { key: "veg", label: "Vegetarian", words: [] },
];
const PROTEIN_BY_KEY = Object.fromEntries(PROTEINS.map((p) => [p.key, p]));

export function mainProtein(r) {
  const meats = (r.ingredients || []).filter((g) => g.aisle === "Meat/Seafood");
  if (!meats.length) return PROTEIN_BY_KEY.veg;
  for (const g of meats) {
    const name = String(g.name || "").toLowerCase();
    const hit = PROTEINS.find((p) => p.words.some((w) => name.includes(w)));
    if (hit) return hit;
  }
  return PROTEIN_BY_KEY.other;
}

// --- Status and source -------------------------------------------------------
const STATUSES = [
  { key: "week", label: "In this week" },
  { key: "deck", label: "In deck" },
  { key: "passed", label: "Passed" },
];
// r.source is "classic" | "custom" (an edited classic) | "own". Older data only has r.custom.
const SOURCES = [
  { key: "classic", label: "MealSwipe Classic", short: "classic" },
  { key: "custom", label: "MealSwipe Custom", short: "edited" },
  { key: "own", label: "Your Own", short: "yours" },
];
export function sourceOf(r) {
  const k = r.source || (r.custom ? "own" : "classic");
  return SOURCES.find((s) => s.key === k) || SOURCES[0];
}

// --- Rating -------------------------------------------------------------------
function ratingValue(r, ctx) {
  const v = ctx && ctx.ratingOf ? ctx.ratingOf(r) : r.rating;
  const n = Number(v);
  return v == null || !Number.isFinite(n) || n <= 0 ? null : n;
}
function ratingGroup(r, ctx) {
  const v = ratingValue(r, ctx);
  if (v == null) return { key: "r0", label: "Unrated", order: 99 };
  const stars = Math.max(1, Math.min(5, Math.round(v)));
  return { key: `r${stars}`, label: `${stars} ${stars === 1 ? "star" : "stars"}`, order: 5 - stars };
}

// --- Sorting ------------------------------------------------------------------
const byName = (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

function sorter(sortBy, ctx, index) {
  switch (sortBy) {
    case "name":
      return byName;
    case "quickest":
      return (a, b) => totalMin(a) - totalMin(b) || byName(a, b);
    case "fewest":
      return (a, b) => a.ingredients.length - b.ingredients.length || byName(a, b);
    case "rating":
      return (a, b) => {
        const ra = ratingValue(a, ctx);
        const rb = ratingValue(b, ctx);
        if (ra == null && rb == null) return index.get(a.id) - index.get(b.id);
        if (ra == null) return 1; // unrated last
        if (rb == null) return -1;
        return rb - ra || byName(a, b);
      };
    case "recent":
    default:
      // New recipes are added to the front of the list, so list order is newest first.
      return (a, b) => index.get(a.id) - index.get(b.id);
  }
}

// --- Grouping -------------------------------------------------------------------
// Each returns { key, label, order } for a recipe; groups are shown by order, then label.
function grouper(groupBy, ctx) {
  switch (groupBy) {
    case "cuisine":
      return (r) => {
        const c = String(r.cuisine || "Other").trim() || "Other";
        return { key: c.toLowerCase(), label: c, order: 0 };
      };
    case "time":
      return (r) => {
        const b = timeBucket(r);
        return { key: b.key, label: b.label, order: TIME_BUCKETS.indexOf(b) };
      };
    case "protein":
      return (r) => {
        const p = mainProtein(r);
        return { key: p.key, label: p.label, order: PROTEINS.indexOf(p) };
      };
    case "rating":
      return (r) => ratingGroup(r, ctx);
    case "status":
      return (r) => {
        const k = (ctx && ctx.statusOf && ctx.statusOf(r)) || "deck";
        const i = Math.max(0, STATUSES.findIndex((s) => s.key === k));
        return { ...STATUSES[i], order: i };
      };
    case "source":
      return (r) => {
        const s = sourceOf(r);
        return { ...s, order: SOURCES.indexOf(s) };
      };
    default:
      return null;
  }
}

export function matchesQuery(r, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  const hay = [r.title, r.cuisine, r.description, ...(r.ingredients || []).map((g) => g.name)].join(" ").toLowerCase();
  return s.split(/\s+/).every((w) => hay.includes(w));
}

export function organizeRecipes(recipes, { q = "", groupBy = "none", sortBy = "recent", ctx = {} } = {}) {
  const index = new Map(recipes.map((r, i) => [r.id, i]));
  const list = recipes.filter((r) => matchesQuery(r, q)).sort(sorter(sortBy, ctx, index));
  const keyOf = grouper(groupBy, ctx);
  if (!keyOf) return [{ key: "all", label: "", items: list }];
  const groups = new Map();
  for (const r of list) {
    const g = keyOf(r);
    if (!groups.has(g.key)) groups.set(g.key, { key: g.key, label: g.label, order: g.order, items: [] });
    groups.get(g.key).items.push(r);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ order, ...g }) => g);
}

export function cleanView(v) {
  const o = v && typeof v === "object" ? v : {};
  return {
    groupBy: GROUP_OPTIONS.some((x) => x.value === o.groupBy) ? o.groupBy : DEFAULT_VIEW.groupBy,
    sortBy: SORT_OPTIONS.some((x) => x.value === o.sortBy) ? o.sortBy : DEFAULT_VIEW.sortBy,
  };
}
