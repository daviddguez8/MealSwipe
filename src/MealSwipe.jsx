import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  X, Heart, Clock, Users, Plus, Minus, Trash2, Pencil, Settings, ListChecks, Layers, BookOpen,
  Copy, Check, Undo2, Shuffle, RotateCcw, Upload, Download, ChevronDown, ChevronUp, Search,
  CalendarDays, ShoppingBasket, Info, Eye, EyeOff, ImagePlus, Camera, ChefHat, Maximize2, Cloud, CloudOff, LogOut, KeyRound, Loader2,
  Sparkles,
} from "lucide-react";
import { STARTER_RECIPES } from "./recipes.js";
import { PHOTOS } from "./photos.js";
import {
  AISLES, UNIT_OPTIONS, formatIngredient, formatQty, formatDinners, isStaple, portionsOf, fitMultiplier,
  stepMult, weekSummary, buildGroceryList, groceryText, parseImport, mergeRecipes, cardColors, cardEmoji,
  normalizeRecipe, slug, AI_MODELS, DEFAULT_AI_MODEL, AI_FORM_KEYS, draftForAi, mergeAiRecipe,
} from "./lib.js";

// All saving and loading lives in store.js (local browser storage or a shared Supabase household).
import { createStore } from "./store.js";

// Photo for a recipe: your own upload/link wins, then the starter photo.
function photoOf(recipe) {
  if (recipe.image) return { src: recipe.image, credit: recipe.photoCredit || null };
  const p = PHOTOS[recipe.id];
  return p ? { src: p.src, credit: p } : null;
}

function Thumb({ recipe, className = "h-14 w-14 rounded-xl text-3xl" }) {
  const [c1, c2] = cardColors(recipe);
  const photo = photoOf(recipe);
  if (photo)
    return <img src={photo.src} alt="" draggable={false} className={`${className} shrink-0 object-cover bg-chip`} />;
  return (
    <div className={`${className} shrink-0 flex items-center justify-center`} style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }} aria-hidden="true">
      {cardEmoji(recipe)}
    </div>
  );
}

// Shrink an uploaded photo so it fits comfortably in browser storage.
function fileToDataUrl(file, max = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = () => reject(new Error("That file isn't an image this browser can read."));
    img.src = url;
  });
}

const DEFAULT_SETTINGS = { household: 2, target: 5, units: "us", portionMode: "asWritten", hideStaples: true, aiModel: DEFAULT_AI_MODEL };

function freshState() {
  return hydrate(null);
}

// Turn saved data (from any backend) into app state, adding new starter recipes.
function hydrate(saved) {
  if (!saved || !Array.isArray(saved.recipes)) {
    return {
      recipes: STARTER_RECIPES.map((r) => ({ ...r })),
      seenStarterIds: STARTER_RECIPES.map((r) => r.id),
      decisions: {},
      plan: {},
      checked: {},
      settings: { ...DEFAULT_SETTINGS },
    };
  }
  // New starter recipes added to the code later appear automatically;
  // ones the user deleted stay deleted.
  const seen = new Set(saved.seenStarterIds || []);
  const fresh = STARTER_RECIPES.filter((r) => !seen.has(r.id) && !saved.recipes.some((x) => x.id === r.id));
  // Fill in fields added to starter recipes after they were saved (steps, description).
  const starterById = Object.fromEntries(STARTER_RECIPES.map((r) => [r.id, r]));
  const upgraded = saved.recipes.map((r) => {
    const st = starterById[r.id];
    if (!st) return r;
    return { ...r, steps: r.steps && r.steps.length ? r.steps : st.steps, description: r.description || st.description };
  });
  return {
    recipes: [...fresh.map((r) => ({ ...r })), ...upgraded],
    seenStarterIds: STARTER_RECIPES.map((r) => r.id).concat([...seen]).filter((v, i, a) => a.indexOf(v) === i),
    decisions: saved.decisions || {},
    plan: saved.plan || {},
    checked: saved.checked || {},
    settings: { ...DEFAULT_SETTINGS, ...(saved.settings || {}) },
  };
}

// ---------------------------------------------------------------------------
function Btn({ variant = "ghost", className = "", children, ...rest }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition active:scale-[.97] disabled:opacity-40 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  const styles = {
    primary: "bg-accent text-onaccent px-4 py-2.5 hover:brightness-110",
    soft: "bg-chip text-ink px-3 py-2 hover:bg-line",
    ghost: "text-muted px-2.5 py-2 hover:text-ink hover:bg-chip",
    danger: "bg-pass/10 text-danger px-3 py-2 hover:bg-pass/20",
  };
  return (
    <button type="button" className={`${base} ${styles[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-scrim" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} max-h-[92vh] flex flex-col bg-surface text-ink rounded-t-3xl sm:rounded-3xl shadow-2xl`}
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-line">
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="p-2 -mr-2 rounded-full text-muted hover:bg-chip">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Stepper({ value, onDec, onInc, label, display, min, max }) {
  return (
    <div className="inline-flex items-center rounded-xl bg-chip" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} onClick={onDec} disabled={min !== undefined && value <= min} className="p-2 text-ink disabled:opacity-30">
        <Minus size={15} />
      </button>
      <span className="min-w-[3.2rem] text-center text-sm font-bold tabular-nums">{display ?? value}</span>
      <button type="button" aria-label={`Increase ${label}`} onClick={onInc} disabled={max !== undefined && value >= max} className="p-2 text-ink disabled:opacity-30">
        <Plus size={15} />
      </button>
    </div>
  );
}

function Progress({ dinners, target }) {
  const pct = Math.min(100, (dinners / Math.max(1, target)) * 100);
  const over = dinners > target + 0.01;
  return (
    <div className="h-1.5 w-full rounded-full bg-chip overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-300 ${over ? "bg-warn" : "bg-good"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swipe card
function CardFace({ recipe, settings, expanded, onOpen }) {
  const [c1, c2] = cardColors(recipe);
  const photo = photoOf(recipe);
  const preview = recipe.ingredients.filter((i) => !isStaple(i)).slice(0, 4);
  const dinners = portionsOf(recipe, 1) / settings.household;
  return (
    <div className="h-full flex flex-col rounded-[28px] overflow-hidden bg-surface shadow-card border border-line select-none">
      <div className="relative h-[46%] min-h-[160px] shrink-0 overflow-hidden" style={{ background: `radial-gradient(120% 90% at 20% 10%, ${c1} 0%, ${c2} 70%)` }}>
        {photo ? (
          <>
            <img src={photo.src} alt={recipe.title} draggable={false} className="absolute inset-0 h-full w-full object-cover pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent pointer-events-none" />
            {photo.credit && photo.credit.author && (
              <a
                data-nodrag
                href={photo.credit.source || undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute right-3 bottom-2 max-w-[75%] truncate text-[10px] font-medium text-white/85 hover:text-white"
              >
                Photo: {photo.credit.author}
                {photo.credit.license ? ` · ${photo.credit.license}` : ""}
              </a>
            )}
          </>
        ) : (
          <>
            <div className="absolute inset-0 opacity-25" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,.55) 1px, transparent 1.4px)", backgroundSize: "14px 14px" }} />
            <div className="absolute inset-0 flex items-center justify-center text-[88px] leading-none drop-shadow-[0_8px_18px_rgba(0,0,0,.25)]" aria-hidden="true">
              {cardEmoji(recipe)}
            </div>
          </>
        )}
        <span className="absolute left-4 top-4 rounded-full bg-black/40 backdrop-blur px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
          {recipe.cuisine}
        </span>
        {recipe.custom && (
          <span className="absolute right-4 top-4 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-bold text-black/80">Yours</span>
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col px-5 pt-4 pb-4 gap-3">
        <h3 className="font-display text-[1.45rem] leading-tight font-extrabold text-balance">{recipe.title}</h3>
        <div className="flex flex-wrap gap-2 text-xs font-semibold text-muted">
          <span className="inline-flex items-center gap-1 rounded-full bg-chip px-2.5 py-1">
            <Clock size={13} /> {recipe.prepMin} prep + {recipe.cookMin} cook
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-chip px-2.5 py-1">
            <Users size={13} /> Serves {recipe.servings}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-good/15 text-good px-2.5 py-1">
            <CalendarDays size={13} /> {formatDinners(dinners)} {dinners === 1 ? "dinner" : "dinners"} for {settings.household}
          </span>
        </div>
        {recipe.description && (
          <p className="text-[13px] leading-snug text-muted line-clamp-2">{recipe.description}</p>
        )}
        {!expanded ? (
          <ul className="text-sm space-y-1.5 text-ink/90">
            {preview.map((ing, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c1 }} />
                <span className="min-w-0">{formatIngredient(ing, 1, settings.units)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ul data-nodrag className="text-sm space-y-1 overflow-y-auto min-h-0 flex-1 pr-1 text-ink/90">
            {recipe.ingredients.map((ing, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-line/70 py-1">
                <span className="min-w-0">{formatIngredient(ing, 1, settings.units)}</span>
                <span className="shrink-0 text-[11px] text-muted">{ing.aisle}</span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          data-nodrag
          onClick={() => onOpen && onOpen()}
          className="mt-auto self-start inline-flex items-center gap-1.5 text-xs font-bold text-accent"
        >
          <ChefHat size={14} />
          Tap for {recipe.steps && recipe.steps.length ? `${recipe.steps.length} steps & ` : ""}all {recipe.ingredients.length} ingredients
        </button>
      </div>
    </div>
  );
}

const SWIPE_THRESHOLD = 100;

function SwipeDeck({ deck, settings, onDecide, flyRef, onOpen }) {
  const top = deck[0];
  const next = deck[1];
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [fly, setFly] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const start = useRef(null);
  const dx = useRef(0);
  const moved = useRef(0);

  useEffect(() => {
    setExpanded(false);
  }, [top && top.id]);

  const launch = useCallback(
    (dir) => {
      if (!top || fly) return;
      setFly(dir);
      setTimeout(() => {
        onDecide(top.id, dir === "right" ? "pick" : "pass");
        setFly(null);
        setDrag({ x: 0, y: 0, active: false });
        dx.current = 0;
      }, 240);
    },
    [top, fly, onDecide]
  );
  flyRef.current = launch;

  if (!top) return null;

  const onDown = (e) => {
    if (fly || e.button > 0 || e.target.closest("[data-nodrag]")) return;
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    moved.current = 0;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x: 0, y: 0, active: true });
  };
  const onMove = (e) => {
    if (!start.current) return;
    dx.current = e.clientX - start.current.x;
    moved.current = Math.max(moved.current, Math.hypot(dx.current, e.clientY - start.current.y));
    setDrag({ x: dx.current, y: e.clientY - start.current.y, active: true });
  };
  const onUp = (e) => {
    if (!start.current) return;
    const wasTap = e && e.type === "pointerup" && moved.current < 8 && Date.now() - start.current.t < 500;
    start.current = null;
    if (wasTap) {
      dx.current = 0;
      setDrag({ x: 0, y: 0, active: false });
      onOpen(top);
      return;
    }
    if (dx.current > SWIPE_THRESHOLD) launch("right");
    else if (dx.current < -SWIPE_THRESHOLD) launch("left");
    else {
      dx.current = 0;
      setDrag({ x: 0, y: 0, active: false });
    }
  };

  const x = fly ? (fly === "right" ? 1 : -1) * (window.innerWidth * 0.9 + 200) : drag.x;
  const rot = fly ? (fly === "right" ? 22 : -22) : drag.x / 16;
  const y = fly ? drag.y * 0.4 + 30 : drag.y * 0.25;
  const like = fly === "right" ? 1 : Math.max(0, Math.min(1, drag.x / SWIPE_THRESHOLD));
  const nope = fly === "left" ? 1 : Math.max(0, Math.min(1, -drag.x / SWIPE_THRESHOLD));
  const progress = Math.min(1, Math.abs(x) / SWIPE_THRESHOLD);

  return (
    <div className="relative w-full h-full">
      {next && (
        <div
          key={next.id}
          className="absolute inset-0 transition-transform duration-200"
          style={{ transform: `translateY(${14 - progress * 14}px) scale(${0.94 + progress * 0.06})` }}
          aria-hidden="true"
        >
          <CardFace recipe={next} settings={settings} expanded={false} />
        </div>
      )}
      <div
        key={top.id}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
        style={{
          transform: `translate(${x}px, ${y}px) rotate(${rot}deg)`,
          transition: drag.active && !fly ? "none" : "transform 240ms cubic-bezier(.2,.8,.3,1)",
          touchAction: "pan-y",
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <CardFace recipe={top} settings={settings} expanded={false} onOpen={() => onOpen(top)} />
        <div
          className="pointer-events-none absolute left-5 top-6 rotate-[-14deg] rounded-xl border-[3px] border-good px-3 py-1 font-display text-2xl font-black tracking-wider text-good bg-surface/80"
          style={{ opacity: like }}
        >
          ADD TO WEEK
        </div>
        <div
          className="pointer-events-none absolute right-5 top-6 rotate-[14deg] rounded-xl border-[3px] border-danger px-3 py-1 font-display text-2xl font-black tracking-wider text-danger bg-surface/80"
          style={{ opacity: nope }}
        >
          PASS
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Recipe detail sheet (opens when a card is tapped)
function RecipeDetail({ recipe, settings, planMult, defaultMult, fromDeck, onClose, onAdd, onPass, onSetMult, onRemove, onEdit }) {
  const inWeek = planMult != null;
  const [localMult, setLocalMult] = useState(inWeek ? planMult : defaultMult);
  const mult = inWeek ? planMult : localMult;
  const [done, setDone] = useState({});
  const [have, setHave] = useState({});
  const photo = photoOf(recipe);
  const [c1, c2] = cardColors(recipe);
  const H = settings.household;
  const portions = portionsOf(recipe, mult);
  const dinners = portions / H;
  const steps = recipe.steps || [];
  const setMult = (m) => (inWeek ? onSetMult(recipe.id, m) : setLocalMult(m));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-scrim" onClick={onClose}>
      <div
        role="dialog"
        aria-label={recipe.title}
        onClick={(e) => e.stopPropagation()}
        className="sheet-in relative w-full sm:max-w-2xl h-[94vh] sm:h-[88vh] flex flex-col overflow-hidden rounded-t-[28px] sm:rounded-[28px] bg-surface text-ink shadow-2xl"
      >
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="relative h-60 sm:h-72 shrink-0" style={{ background: `radial-gradient(120% 90% at 20% 10%, ${c1} 0%, ${c2} 70%)` }}>
            {photo ? (
              <img src={photo.src} alt={recipe.title} className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-[110px]" aria-hidden="true">{cardEmoji(recipe)}</div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />
            <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 h-10 w-10 rounded-full bg-black/45 backdrop-blur text-white flex items-center justify-center hover:bg-black/60" style={{ top: "max(12px, env(safe-area-inset-top, 0px))" }}>
              <X size={20} />
            </button>
            <div className="absolute inset-x-0 bottom-0 p-5 space-y-1.5">
              <span className="inline-block rounded-full bg-white/20 backdrop-blur px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">{recipe.cuisine}</span>
              <h2 className="font-display text-[1.7rem] sm:text-3xl leading-tight font-extrabold text-white text-balance">{recipe.title}</h2>
              {photo && photo.credit && photo.credit.author && (
                <a href={photo.credit.source || undefined} target="_blank" rel="noopener noreferrer" className="block truncate text-[10px] text-white/75 hover:text-white">
                  Photo: {photo.credit.author}{photo.credit.license ? ` · ${photo.credit.license}` : ""}
                </a>
              )}
            </div>
          </div>

          <div className="px-5 py-5 space-y-6">
            {recipe.description && <p className="text-[15px] leading-relaxed text-ink/85">{recipe.description}</p>}

            <div className="grid grid-cols-4 gap-2 text-center">
              {[["Prep", `${recipe.prepMin}m`], ["Cook", `${recipe.cookMin}m`], ["Total", `${(+recipe.prepMin || 0) + (+recipe.cookMin || 0)}m`], ["Serves", recipe.servings]].map(([k, v]) => (
                <div key={k} className="rounded-2xl bg-chip px-2 py-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{k}</div>
                  <div className="font-display text-lg font-extrabold tabular-nums">{v}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-3">
              <div className="min-w-0">
                <div className="text-sm font-bold">
                  {formatQty(portions)} servings · <span className="text-good">{formatDinners(dinners)} {dinners === 1 ? "dinner" : "dinners"}</span> for {H}
                </div>
                <div className="text-xs text-muted">{inWeek ? "In this week. Changes update your grocery list." : "Ingredients below are scaled to this."}</div>
              </div>
              <Stepper label="recipe multiplier" value={mult} display={`${mult}×`} min={0.25} max={4} onDec={() => setMult(stepMult(mult, -1))} onInc={() => setMult(stepMult(mult, 1))} />
            </div>

            <section>
              <h3 className="mb-2 flex items-baseline justify-between font-display text-lg font-extrabold">
                Ingredients <span className="text-xs font-semibold text-muted">{settings.units === "us" ? "US units" : "Metric"}</span>
              </h3>
              <ul className="divide-y divide-line">
                {recipe.ingredients.map((ing, i) => (
                  <li key={i}>
                    <label className="flex items-start gap-3 py-2 cursor-pointer">
                      <input id={`rd-ing-${i}`} type="checkbox" checked={!!have[i]} onChange={() => setHave((p) => ({ ...p, [i]: !p[i] }))} className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--good))]" />
                      <span className={`min-w-0 flex-1 text-[15px] ${have[i] ? "line-through text-muted" : ""}`}>{formatIngredient(ing, mult, settings.units)}</span>
                      <span className="shrink-0 text-[11px] text-muted">{ing.aisle}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-3 font-display text-lg font-extrabold">Steps</h3>
              {steps.length ? (
                <ol className="space-y-3">
                  {steps.map((st, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => setDone((p) => ({ ...p, [i]: !p[i] }))} className={`w-full text-left flex gap-3 rounded-2xl p-3 transition ${done[i] ? "bg-good/10" : "bg-chip/60 hover:bg-chip"}`}>
                        <span className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-sm font-extrabold ${done[i] ? "bg-good text-white" : "bg-surface text-ink border border-line"}`}>
                          {done[i] ? <Check size={15} strokeWidth={3} /> : i + 1}
                        </span>
                        <span className={`text-[15px] leading-relaxed ${done[i] ? "text-muted" : ""}`}>{st}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-2xl bg-chip/60 p-4 text-sm text-muted">No steps yet. Use Edit to add them, one per line.</p>
              )}
              {mult !== 1 && steps.length > 0 && <p className="mt-3 text-xs text-muted">Steps are written for the original recipe ({recipe.servings} servings). Ingredient amounts above are already scaled.</p>}
            </section>
          </div>
        </div>

        <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 flex items-center gap-2" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}>
          <Btn variant="ghost" onClick={() => onEdit(recipe)} aria-label="Edit recipe">
            <Pencil size={15} /> Edit
          </Btn>
          <div className="ml-auto flex gap-2">
            {fromDeck && (
              <Btn variant="soft" className="px-5 py-3 text-danger" onClick={onPass}>
                <X size={17} strokeWidth={3} /> Pass
              </Btn>
            )}
            {inWeek ? (
              <Btn variant="danger" className="py-3" onClick={() => onRemove(recipe.id)}>
                <Trash2 size={15} /> Remove from week
              </Btn>
            ) : (
              <button type="button" onClick={() => onAdd(recipe.id, localMult)} className="inline-flex items-center gap-1.5 rounded-xl bg-good text-white px-5 py-3 text-sm font-bold hover:brightness-110 active:scale-[.97]">
                <Heart size={16} fill="currentColor" /> Add to week
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipe form
const EMPTY_ING = { name: "", qty: "", unit: "", aisle: "Produce" };
const stripMarks = (g) => {
  const { _ai, _touched, ...rest } = g;
  return rest;
};

function RecipeForm({ initial, onSave, onCancel, cuisines, askClaude }) {
  const [r, setR] = useState(() =>
    initial
      ? {
          ...initial,
          stepsText: (initial.steps || []).join("\n"),
          ingredients: initial.ingredients.map((i) => ({ ...i, qty: String(i.qty), _touched: { name: true, qty: true, unit: true, aisle: true } })),
        }
      : { title: "", cuisine: "", emoji: "", image: "", description: "", stepsText: "", prepMin: 15, cookMin: 20, servings: 4, ingredients: [{ ...EMPTY_ING }, { ...EMPTY_ING }, { ...EMPTY_ING }] }
  );
  // touched: fields the person edited (Claude leaves them alone). ai: fields Claude filled (gold until edited).
  const [touched, setTouched] = useState(() => (initial ? Object.fromEntries(AI_FORM_KEYS.map((k) => [k, true])) : {}));
  const [ai, setAi] = useState({});
  const [asking, setAsking] = useState(false);
  const latest = useRef(null);
  latest.current = { r, touched, ai };
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setBusy(true);
    try {
      const url = await fileToDataUrl(f);
      setR((p) => ({ ...p, image: url, photoCredit: undefined }));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const starterPhoto = initial && !initial.image && PHOTOS[initial.id];
  const shown = r.image || (starterPhoto && starterPhoto.src);
  const set = (k, v) => {
    setR((p) => ({ ...p, [k]: v }));
    setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
    setAi((a) => (a[k] ? { ...a, [k]: false } : a));
  };
  const setIng = (i, k, v) =>
    setR((p) => ({
      ...p,
      ingredients: p.ingredients.map((g, j) =>
        j === i ? { ...g, [k]: v, _touched: { ...(g._touched || {}), [k]: true }, _ai: g._ai && g._ai[k] ? { ...g._ai, [k]: false } : g._ai } : g
      ),
    }));

  const aiCount = Object.values(ai).filter(Boolean).length + r.ingredients.reduce((n, g) => n + (g._ai ? Object.values(g._ai).filter(Boolean).length : 0), 0);
  const canAsk = Boolean(r.title.trim() || (r.description || "").trim());

  const ask = async () => {
    if (!askClaude || asking) return;
    if (!canAsk) {
      setError("Type a recipe name (or a short description) first, then Ask Claude.");
      return;
    }
    setError("");
    setAsking(true);
    try {
      const filled = await askClaude(draftForAi(r, touched));
      // Merge against the latest form, in case the person kept typing while Claude worked.
      const cur = latest.current;
      const merged = mergeAiRecipe(cur.r, cur.touched, filled, cur.ai);
      setR(merged.form);
      setAi(merged.ai);
    } catch (err) {
      setError(err.message);
    }
    setAsking(false);
  };

  const submit = (e) => {
    e.preventDefault();
    try {
      const clean = normalizeRecipe({
        ...r,
        id: initial ? initial.id : `c-${slug(r.title)}-${Date.now().toString(36)}`,
        custom: initial ? initial.custom : true,
        ingredients: r.ingredients.filter((g) => g.name.trim()).map(stripMarks),
        steps: r.stepsText || "",
      });
      if (initial && !initial.custom) delete clean.custom;
      onSave(clean);
    } catch (err) {
      setError(err.message);
    }
  };

  const field = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-accent";
  // Claude-filled inputs are tinted yellow-gold until the person edits them.
  const aiField = "w-full rounded-xl border border-ai bg-ai/15 ring-1 ring-ai/40 px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-accent";
  const f = (on) => (on ? aiField : field);
  const label = "text-xs font-bold uppercase tracking-wide text-muted";
  const ingAi = (g, k) => Boolean(g._ai && g._ai[k]);

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-[1fr_4.5rem] gap-3">
        <label className="space-y-1">
          <span className={label}>Title</span>
          <input id="rf-title" className={f(ai.title)} value={r.title} onChange={(e) => set("title", e.target.value)} placeholder="Pozole Rojo" required />
        </label>
        <label className="space-y-1">
          <span className={label}>Emoji</span>
          <input id="rf-emoji" className={f(ai.emoji) + " text-center"} value={r.emoji} onChange={(e) => set("emoji", e.target.value)} placeholder="🍲" maxLength={4} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className={label}>Description</span>
        <textarea
          id="rf-desc"
          rows={3}
          className={f(ai.description)}
          value={r.description || ""}
          onChange={(e) => set("description", e.target.value)}
          placeholder="What makes this one good, or what you want: “my mom's spicy version with dried guajillo, ready in 40 minutes”"
        />
      </label>
      {askClaude && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ai/50 bg-ai/10 p-3">
          <button
            id="rf-ask-claude"
            type="button"
            onClick={ask}
            disabled={asking}
            className="inline-flex items-center gap-1.5 rounded-xl bg-ai px-4 py-2.5 text-sm font-bold text-onai hover:brightness-105 active:scale-[.97] disabled:opacity-70"
          >
            {asking ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {asking ? "Asking Claude…" : "Ask Claude"}
          </button>
          <p className="min-w-0 flex-1 text-xs text-muted">
            {asking
              ? "Writing the ingredients and steps. This takes a few seconds."
              : aiCount
                ? `Claude filled ${aiCount} field${aiCount === 1 ? "" : "s"}, shown in gold. Check them; editing a field clears its highlight.`
                : "Claude reads the title, description and anything else you've typed, and fills in the rest. It won't change what you wrote."}
          </p>
        </div>
      )}
      <div className="space-y-1">
        <span className={label}>Photo</span>
        <div className="flex gap-3 items-start">
          <div className="h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-chip flex items-center justify-center text-muted">
            {shown ? <img src={shown} alt="" className="h-full w-full object-cover" /> : <Camera size={22} />}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-chip px-3 py-2 text-sm font-semibold hover:bg-line">
                <ImagePlus size={15} /> {busy ? "Loading…" : shown ? "Replace photo" : "Upload photo"}
                <input id="rf-photo-file" type="file" accept="image/*" className="sr-only" onChange={onFile} />
              </label>
              {r.image && (
                <Btn variant="ghost" onClick={() => setR((p) => ({ ...p, image: "", photoCredit: undefined }))}>
                  Remove
                </Btn>
              )}
            </div>
            <input
              id="rf-photo-url"
              className={field}
              value={r.image && r.image.startsWith("data:") ? "" : r.image || ""}
              onChange={(e) => setR((p) => ({ ...p, image: e.target.value.trim(), photoCredit: undefined }))}
              placeholder="…or paste an image link (works when opened from your computer)"
            />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="space-y-1 col-span-2 sm:col-span-1">
          <span className={label}>Cuisine</span>
          <input id="rf-cuisine" list="rf-cuisines" className={f(ai.cuisine)} value={r.cuisine} onChange={(e) => set("cuisine", e.target.value)} placeholder="Mexican" />
          <datalist id="rf-cuisines">
            {cuisines.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="space-y-1">
          <span className={label}>Prep min</span>
          <input id="rf-prep" type="number" min="0" inputMode="numeric" className={f(ai.prepMin)} value={r.prepMin} onChange={(e) => set("prepMin", e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className={label}>Cook min</span>
          <input id="rf-cook" type="number" min="0" inputMode="numeric" className={f(ai.cookMin)} value={r.cookMin} onChange={(e) => set("cookMin", e.target.value)} />
        </label>
        <label className="space-y-1 col-span-2 sm:col-span-1">
          <span className={label}>Servings</span>
          <input id="rf-servings" type="number" min="1" inputMode="numeric" className={f(ai.servings)} value={r.servings} onChange={(e) => set("servings", e.target.value)} />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={label}>Ingredients</span>
          <span className="text-[11px] text-muted">Count items: leave unit blank, use the singular ("lime")</span>
        </div>
        {r.ingredients.map((g, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-chip/60 p-2">
            <input id={`rf-ing-name-${i}`} aria-label="Ingredient name" className={f(ingAi(g, "name"))} value={g.name} onChange={(e) => setIng(i, "name", e.target.value)} placeholder="Ingredient (e.g. yellow onion)" />
            <button type="button" aria-label="Remove ingredient" onClick={() => setR((p) => ({ ...p, ingredients: p.ingredients.filter((_, j) => j !== i) }))} className="px-2 text-muted hover:text-danger">
              <Trash2 size={16} />
            </button>
            <div className="col-span-2 grid grid-cols-[4.5rem_5.5rem_1fr] gap-2">
              <input id={`rf-ing-qty-${i}`} aria-label="Quantity" type="number" step="any" min="0" inputMode="decimal" className={f(ingAi(g, "qty"))} value={g.qty} onChange={(e) => setIng(i, "qty", e.target.value)} placeholder="Qty" />
              <select id={`rf-ing-unit-${i}`} aria-label="Unit" className={f(ingAi(g, "unit")) + " px-2"} value={g.unit} onChange={(e) => setIng(i, "unit", e.target.value)}>
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>
                    {u || "each"}
                  </option>
                ))}
              </select>
              <select id={`rf-ing-aisle-${i}`} aria-label="Aisle" className={f(ingAi(g, "aisle")) + " px-2"} value={g.aisle} onChange={(e) => setIng(i, "aisle", e.target.value)}>
                {AISLES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
        <Btn variant="soft" onClick={() => setR((p) => ({ ...p, ingredients: [...p.ingredients, { ...EMPTY_ING }] }))}>
          <Plus size={15} /> Add ingredient
        </Btn>
      </div>
      <label className="block space-y-1">
        <span className={label}>Steps (one per line)</span>
        <textarea id="rf-steps" rows={6} className={f(ai.stepsText)} value={r.stepsText} onChange={(e) => set("stepsText", e.target.value)} placeholder={"Brown the pork in a large pot.\nAdd the chiles and broth and simmer 40 minutes.\nStir in the hominy and serve with radishes and lime."} />
      </label>
      {error && <p className="text-sm font-semibold text-danger">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Btn onClick={onCancel}>Cancel</Btn>
        <button type="submit" disabled={asking} className="inline-flex items-center gap-1.5 rounded-xl bg-accent text-onaccent px-4 py-2.5 text-sm font-semibold hover:brightness-110 disabled:opacity-60">
          <Check size={16} /> {initial ? "Save changes" : "Add to deck"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
const JSON_EXAMPLE = `[
  {
    "title": "Pozole Rojo",
    "cuisine": "Mexican",
    "emoji": "🍲",
    "prepMin": 20,
    "cookMin": 40,
    "servings": 6,
    "ingredients": [
      { "name": "pork shoulder", "qty": 2, "unit": "lb", "aisle": "Meat/Seafood" },
      { "name": "white hominy (25 oz)", "qty": 1, "unit": "can", "aisle": "Pantry & Grains" },
      { "name": "yellow onion", "qty": 1, "unit": "", "aisle": "Produce" }
    ]
  }
]`;

function JsonModal({ recipes, fullState, onImport, onRestoreBackup, onClose }) {
  const [tab, setTab] = useState("import");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState(null);
  const [scope, setScope] = useState("all");
  const [showExample, setShowExample] = useState(false);
  const exportRef = useRef(null);
  const exportText = useMemo(() => {
    if (scope === "backup") {
      const { decisions, plan, checked, settings, seenStarterIds } = fullState;
      return JSON.stringify({ app: "MealSwipe", version: 1, backup: true, recipes, decisions, plan, checked, settings, seenStarterIds }, null, 2);
    }
    const list = scope === "custom" ? recipes.filter((r) => r.custom) : recipes;
    return JSON.stringify({ app: "MealSwipe", version: 1, recipes: list }, null, 2);
  }, [recipes, scope, fullState]);

  const run = (mode) => {
    try {
      let backup = null;
      try {
        const raw = JSON.parse(text);
        if (raw && raw.backup && Array.isArray(raw.recipes)) backup = raw;
      } catch (e) {
        /* parseImport reports the error */
      }
      if (backup) {
        onRestoreBackup(backup);
        setMsg({ ok: true, text: `Restored the full backup: ${backup.recipes.length} recipes and ${Object.keys(backup.plan || {}).length} dinners in the week.` });
        setText("");
        return;
      }
      const parsed = parseImport(text);
      const res = onImport(parsed, mode);
      setMsg({ ok: true, text: mode === "replace" ? `Replaced your deck with ${parsed.length} recipes.` : `Added ${res.added}, updated ${res.updated}.` });
      setText("");
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText);
      setMsg({ ok: true, text: "Copied to clipboard." });
    } catch (e) {
      exportRef.current?.select();
      setMsg({ ok: true, text: "Text selected. Press Ctrl/Cmd+C to copy." });
    }
  };

  return (
    <Modal title="Import or export recipes" onClose={onClose} wide>
      <div className="mb-4 inline-flex rounded-xl bg-chip p-1">
        {["import", "export"].map((t) => (
          <button key={t} type="button" onClick={() => { setTab(t); setMsg(null); }} className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize ${tab === t ? "bg-surface text-ink shadow" : "text-muted"}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "import" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Paste a JSON list of recipes, for example one Claude wrote for you. Matching titles are updated; new ones go to the top of your deck. You can also paste an "Everything" export to move a whole setup over.</p>
          <textarea id="json-import" value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder='[{ "title": "...", "ingredients": [...] }]' className="w-full rounded-xl border border-line bg-bg p-3 font-mono text-xs text-ink focus:outline-none focus:border-accent" />
          <button type="button" onClick={() => setShowExample(!showExample)} className="text-xs font-bold text-accent inline-flex items-center gap-1">
            <Info size={13} /> {showExample ? "Hide" : "Show"} the format
          </button>
          {showExample && <pre className="overflow-x-auto rounded-xl bg-chip p-3 font-mono text-[11px] text-ink">{JSON_EXAMPLE}</pre>}
          <div className="flex flex-wrap gap-2 justify-end">
            <Btn variant="danger" disabled={!text.trim()} onClick={() => run("replace")}>Replace all recipes</Btn>
            <Btn variant="primary" disabled={!text.trim()} onClick={() => run("merge")}>
              <Upload size={15} /> Import
            </Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-xl bg-chip p-1 text-sm">
              {[["all", `Recipes (${recipes.length})`], ["custom", `Only mine (${recipes.filter((r) => r.custom).length})`], ["backup", "Everything"]].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setScope(k)} className={`rounded-lg px-3 py-1 font-semibold ${scope === k ? "bg-surface text-ink shadow" : "text-muted"}`}>
                  {l}
                </button>
              ))}
            </div>
            <Btn variant="primary" onClick={copy}>
              <Copy size={15} /> Copy JSON
            </Btn>
          </div>
          <textarea id="json-export" ref={exportRef} readOnly value={exportText} rows={12} className="w-full rounded-xl border border-line bg-bg p-3 font-mono text-xs text-ink" />
          <p className="text-xs text-muted">{scope === "backup" ? "Everything: recipes, this week's picks, settings and checkmarks. Paste it into Import on another copy of MealSwipe to move over." : "Keep this as a backup, or paste it to Claude and ask for changes."}</p>
        </div>
      )}
      {msg && <p className={`mt-3 text-sm font-semibold ${msg.ok ? "text-good" : "text-danger"}`}>{msg.text}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// A memorable code like the one the household started with: word-word-word-00.
const CODE_WORDS = [
  "taco", "jicama", "chile", "mole", "salsa", "elote", "nopal", "tamal", "pozole", "lime", "cilantro", "queso",
  "basil", "pesto", "ramen", "miso", "curry", "falafel", "lemon", "olive", "paprika", "ginger", "mango", "pepper",
];
function suggestPasscode() {
  const r = (n) => {
    try {
      const a = new Uint32Array(1);
      window.crypto.getRandomValues(a);
      return a[0] % n;
    } catch (e) {
      return Math.floor(Math.random() * n);
    }
  };
  const words = [];
  while (words.length < 3) {
    const w = CODE_WORDS[r(CODE_WORDS.length)];
    if (!words.includes(w)) words.push(w);
  }
  return `${words.join("-")}-${String(r(100)).padStart(2, "0")}`;
}

function ChangePasscodeModal({ store, onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);
  const n = next.trim();
  const problem = !n
    ? ""
    : n.length < 8
    ? "At least 8 characters."
    : confirm.trim() && confirm.trim() !== n
    ? "The two new passcodes don't match."
    : n === current.trim()
    ? "That's the same as the current passcode."
    : "";
  const ready = current.trim() && n.length >= 8 && confirm.trim() === n && !problem && !busy;
  const input = "w-full rounded-xl border border-line bg-bg px-3 py-3 text-base text-ink focus:outline-none focus:border-accent";
  const label = "text-xs font-bold uppercase tracking-wide text-muted";

  if (done)
    return (
      <Modal title="Passcode changed" onClose={onClose}>
        <div className="space-y-4">
          <p className="text-sm">The household passcode is now:</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-xl bg-chip px-3 py-3 font-mono text-base">{done}</code>
            <Btn
              variant="soft"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(done);
                  setCopied(true);
                } catch (e) {}
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy"}
            </Btn>
          </div>
          <p className="text-xs text-muted">Other phones and computers were signed out and will ask for the new passcode. Share it with your household.</p>
          <Btn variant="primary" className="w-full" onClick={onClose}>Done</Btn>
        </div>
      </Modal>
    );

  return (
    <Modal title="Change passcode" onClose={busy ? () => {} : onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          setError("");
          try {
            await store.changePasscode(current, n);
            setDone(n);
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted">Everyone else will be signed out and asked for the new passcode. Your week, recipes and list stay the same.</p>
        <label className="block space-y-1">
          <span className={label}>Current passcode</span>
          <input id="current-passcode" autoFocus autoComplete="current-password" autoCapitalize="none" spellCheck={false} value={current} onChange={(e) => setCurrent(e.target.value)} className={input} />
        </label>
        <label className="block space-y-1">
          <span className="flex items-center justify-between">
            <span className={label}>New passcode</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent"
              onClick={() => {
                const c = suggestPasscode();
                setNext(c);
                setConfirm(c);
              }}
            >
              <Shuffle size={13} /> Suggest one
            </button>
          </span>
          <input id="new-passcode" autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={next} onChange={(e) => setNext(e.target.value)} className={input} placeholder="word-word-word-00" />
        </label>
        <label className="block space-y-1">
          <span className={label}>New passcode again</span>
          <input id="confirm-passcode" autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
        </label>
        {(problem || error) && <p className="text-sm font-semibold text-danger">{error || problem}</p>}
        <button type="submit" disabled={!ready} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent text-onaccent px-4 py-3 font-bold disabled:opacity-50">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />} Change passcode
        </button>
      </form>
    </Modal>
  );
}

function SettingsModal({ settings, setSettings, onClose, onReset, store, sync, onSignOut, onChangePasscode }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const s = settings;
  const upd = (k, v) => setSettings((p) => ({ ...p, [k]: v }));
  const Seg = ({ value, options, onChange }) => (
    <div className="inline-flex rounded-xl bg-chip p-1">
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${value === k ? "bg-surface text-ink shadow" : "text-muted"}`}>
          {l}
        </button>
      ))}
    </div>
  );
  return (
    <Modal title="Household & settings" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">People eating</div>
            <div className="text-xs text-muted">Portions per dinner</div>
          </div>
          <Stepper label="people" value={s.household} min={1} max={12} onDec={() => upd("household", Math.max(1, s.household - 1))} onInc={() => upd("household", Math.min(12, s.household + 1))} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Dinners this week</div>
            <div className="text-xs text-muted">Leftovers count toward this</div>
          </div>
          <Stepper label="dinners" value={s.target} min={1} max={14} onDec={() => upd("target", Math.max(1, s.target - 1))} onInc={() => upd("target", Math.min(14, s.target + 1))} />
        </div>
        <div className="rounded-2xl bg-chip/70 p-3 text-sm text-muted">
          You need <b className="text-ink">{s.target * s.household} portions</b> a week ({s.target} dinners × {s.household} {s.household === 1 ? "person" : "people"}).
        </div>
        <div className="space-y-2">
          <div className="font-semibold">Units</div>
          <Seg value={s.units} onChange={(v) => upd("units", v)} options={[["us", "US (cups, lb)"], ["metric", "Metric (ml, g)"]]} />
        </div>
        <div className="space-y-2">
          <div className="font-semibold">When I add a recipe</div>
          <Seg value={s.portionMode} onChange={(v) => upd("portionMode", v)} options={[["asWritten", "Cook as written"], ["fit", "Scale to one dinner"]]} />
          <p className="text-xs text-muted">
            {s.portionMode === "asWritten"
              ? `A recipe that serves 4 covers ${formatDinners(4 / s.household)} dinners for ${s.household}, so you swipe fewer recipes and eat leftovers.`
              : `Each recipe is scaled to feed ${s.household} once, so every dinner is a different recipe.`}
          </p>
        </div>
        {store && store.askClaude && (
          <div className="space-y-2">
            <div className="font-semibold">Ask Claude model</div>
            <div className="flex flex-wrap gap-1 rounded-xl bg-chip p-1">
              {AI_MODELS.map(([id, name]) => (
                <button key={id} type="button" onClick={() => upd("aiModel", id)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${(s.aiModel || DEFAULT_AI_MODEL) === id ? "bg-surface text-ink shadow" : "text-muted"}`}>
                  {name}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted">{(AI_MODELS.find(([id]) => id === (s.aiModel || DEFAULT_AI_MODEL)) || AI_MODELS[0])[2]}. Used when Claude fills in a recipe for you.</p>
          </div>
        )}
        {store && store.mode === "supabase" && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-chip/70 p-3">
            <div className="min-w-0 text-sm">
              <div className="font-semibold">Shared household</div>
              <div className="text-xs text-muted">Everyone with the passcode sees the same week. {sync.status === "offline" ? "Can't reach the server right now, so changes will save when it's back." : "Changes sync live."}</div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Btn variant="soft" onClick={onChangePasscode}>
                <KeyRound size={15} /> Change passcode
              </Btn>
              <Btn variant="soft" onClick={onSignOut}>
                <LogOut size={15} /> Sign out
              </Btn>
            </div>
          </div>
        )}
        <div className="border-t border-line pt-4">
          {!confirmReset ? (
            <Btn variant="danger" onClick={() => setConfirmReset(true)}>
              <RotateCcw size={15} /> Reset everything
            </Btn>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{store && store.mode === "supabase" ? "This deletes your custom recipes and the plan for everyone in the household." : "This deletes your recipes and plan."}</span>
              <Btn variant="danger" onClick={() => { onReset(); onClose(); }}>Yes, reset</Btn>
              <Btn onClick={() => setConfirmReset(false)}>Keep</Btn>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function WeekView({ onOpen, planList, settings, setSettings, summary, setMult, removeMeal, refitAll, checked, setChecked, onCopy, goSwipe }) {
  const groups = useMemo(() => buildGroceryList(planList, settings.units), [planList, settings.units]);
  const hidden = groups.reduce((n, g) => n + g.items.filter((i) => i.staple).length, 0);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const visibleCount = settings.hideStaples ? total - hidden : total;
  const doneCount = groups.reduce((n, g) => n + g.items.filter((i) => checked[i.key] && !(settings.hideStaples && i.staple)).length, 0);
  const H = settings.household;

  const status =
    summary.dinners + 0.01 < settings.target
      ? { tone: "text-muted", text: `${formatDinners(summary.remaining)} more ${summary.remaining === 1 ? "dinner" : "dinners"} to plan` }
      : summary.dinners > settings.target + 0.51
      ? { tone: "text-warn", text: `${formatDinners(-summary.remaining)} extra ${-summary.remaining === 1 ? "dinner" : "dinners"} of food` }
      : { tone: "text-good", text: "Week covered" };

  if (!planList.length) {
    return (
      <div className="mx-auto max-w-md text-center py-16 space-y-4">
        <div className="text-6xl" aria-hidden="true">🗓️</div>
        <h2 className="font-display text-2xl font-extrabold">No dinners picked yet</h2>
        <p className="text-muted">Swipe right on a recipe to add it to this week. Your grocery list builds itself from what you pick.</p>
        <Btn variant="primary" onClick={goSwipe}>
          <Layers size={16} /> Start swiping
        </Btn>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start">
      <section className="space-y-3 min-w-0">
        <div className="rounded-3xl bg-surface border border-line p-4 space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-muted">This week</div>
              <div className="font-display text-3xl font-extrabold tabular-nums">
                {formatDinners(summary.dinners)} <span className="text-muted text-xl">/ {settings.target} dinners</span>
              </div>
            </div>
            <div className={`text-sm font-bold text-right ${status.tone}`}>{status.text}</div>
          </div>
          <Progress dinners={summary.dinners} target={settings.target} />
          <div className="text-xs text-muted tabular-nums">
            {summary.recipes} {summary.recipes === 1 ? "recipe" : "recipes"} · {formatQty(summary.portions)} of {summary.needed} portions for {H} {H === 1 ? "person" : "people"}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Btn variant="soft" onClick={() => refitAll("fit")} title="Scale each recipe so it feeds the household once">
              Scale each to 1 dinner
            </Btn>
            <Btn variant="soft" onClick={() => refitAll("asWritten")}>Reset to as written</Btn>
          </div>
        </div>

        <ul className="space-y-2.5">
          {planList.map(({ recipe, mult }) => {
            const portions = portionsOf(recipe, mult);
            return (
              <li key={recipe.id} className="flex gap-3 rounded-2xl bg-surface border border-line p-3">
                <Thumb recipe={recipe} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button type="button" onClick={() => onOpen(recipe)} className="font-bold leading-snug text-left hover:text-accent">{recipe.title}</button>
                      <div className="text-xs text-muted tabular-nums">
                        {recipe.servings} servings × {mult} = {formatQty(portions)} portions · <b className="text-ink">{formatDinners(portions / H)} {portions / H === 1 ? "dinner" : "dinners"}</b>
                      </div>
                    </div>
                    <button type="button" aria-label={`Remove ${recipe.title}`} onClick={() => removeMeal(recipe.id)} className="p-1.5 -mr-1 rounded-lg text-muted hover:text-danger hover:bg-chip">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <Stepper label={`${recipe.title} multiplier`} value={mult} display={`${mult}×`} min={0.25} max={4} onDec={() => setMult(recipe.id, stepMult(mult, -1))} onInc={() => setMult(recipe.id, stepMult(mult, 1))} />
                </div>
              </li>
            );
          })}
        </ul>
        <Btn variant="ghost" onClick={goSwipe}>
          <Plus size={15} /> Swipe for more
        </Btn>
      </section>

      <section className="rounded-3xl bg-surface border border-line min-w-0">
        <div className="sticky z-10 rounded-t-3xl bg-surface/95 backdrop-blur border-b border-line p-4 space-y-3" style={{ top: "calc(env(safe-area-inset-top, 0px) + 64px)" }}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl font-extrabold flex items-center gap-2">
              <ShoppingBasket size={20} className="text-accent" /> Grocery list
            </h2>
            <span className="text-xs font-semibold text-muted tabular-nums">
              {doneCount} / {visibleCount} in cart
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="primary" onClick={() => onCopy(groceryText({ groups, planList, household: H, target: settings.target, hideStaples: settings.hideStaples, system: settings.units, summary }))}>
              <Copy size={15} /> Copy list for Claude / Notes
            </Btn>
            <Btn variant="soft" onClick={() => setSettings((p) => ({ ...p, hideStaples: !p.hideStaples }))} aria-pressed={settings.hideStaples}>
              {settings.hideStaples ? <EyeOff size={15} /> : <Eye size={15} />}
              {settings.hideStaples ? `Staples hidden (${hidden})` : "Hide pantry staples"}
            </Btn>
            <Btn variant="soft" onClick={() => setSettings((p) => ({ ...p, units: p.units === "us" ? "metric" : "us" }))}>
              {settings.units === "us" ? "US units" : "Metric"}
            </Btn>
            {doneCount > 0 && (
              <Btn variant="ghost" onClick={() => setChecked({})}>
                <RotateCcw size={14} /> Uncheck all
              </Btn>
            )}
          </div>
        </div>
        <div className="p-4 space-y-5">
          {groups.map((g) => {
            const items = g.items.filter((i) => !(settings.hideStaples && i.staple));
            if (!items.length) return null;
            return (
              <div key={g.aisle}>
                <h3 className="mb-1.5 flex items-center justify-between text-xs font-bold uppercase tracking-[.12em] text-accent">
                  {g.aisle} <span className="text-muted tabular-nums">{items.length}</span>
                </h3>
                <ul className="divide-y divide-line">
                  {items.map((i) => {
                    const on = !!checked[i.key];
                    return (
                      <li key={i.key}>
                        <label className="flex items-start gap-3 py-2.5 cursor-pointer">
                          <input
                            id={`gl-${i.key.replace(/[^a-z0-9]+/g, "-")}`}
                            type="checkbox"
                            checked={on}
                            onChange={() => setChecked((p) => ({ ...p, [i.key]: !on }))}
                            className="mt-0.5 h-5 w-5 shrink-0 rounded-md accent-[rgb(var(--good))]"
                          />
                          <span className="min-w-0">
                            <span className={`block text-[15px] leading-snug ${on ? "line-through text-muted" : ""}`}>{i.text}</span>
                            <span className="block text-[11px] text-muted truncate">{i.recipes.join(" · ")}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
function LibraryView({ onOpen, recipes, decisions, plan, onEdit, onDelete, onAdd, onJson, onRestore, missingStarters, onToggleWeek, settings }) {
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState(null);
  const list = recipes.filter((r) => (r.title + " " + r.cuisine).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input id="lib-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipes or cuisines" className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2.5 text-sm text-ink focus:outline-none focus:border-accent" />
        </div>
        <Btn variant="primary" onClick={onAdd}>
          <Plus size={16} /> Add recipe
        </Btn>
        <Btn variant="soft" onClick={onJson}>
          <Download size={15} /> JSON
        </Btn>
      </div>
      {missingStarters > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-chip px-4 py-3 text-sm">
          <span>{missingStarters} starter {missingStarters === 1 ? "recipe was" : "recipes were"} deleted.</span>
          <Btn variant="soft" onClick={onRestore}>
            <RotateCcw size={14} /> Restore
          </Btn>
        </div>
      )}
      <p className="text-xs text-muted">{recipes.length} recipes in your deck. Edit any of them, or delete the ones you don't want to see again.</p>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {list.map((r) => {
          const inWeek = plan[r.id] != null;
          const state = inWeek ? "In this week" : decisions[r.id] === "pass" ? "Passed" : "In deck";
          return (
            <li key={r.id} className="flex flex-col gap-3 rounded-2xl bg-surface border border-line p-3">
              <div className="flex gap-3">
                <Thumb recipe={r} className="h-14 w-14 rounded-xl text-2xl" />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onOpen(r)} className="font-bold leading-snug text-left hover:text-accent">{r.title}</button>
                  <div className="text-xs text-muted">
                    {r.cuisine} · {r.prepMin + r.cookMin} min · serves {r.servings} · {r.ingredients.length} ingredients
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${inWeek ? "bg-good/15 text-good" : "bg-chip text-muted"}`}>
                  {state}
                  {r.custom ? " · yours" : ""}
                </span>
                {confirm === r.id ? (
                  <div className="flex items-center gap-1">
                    <Btn variant="danger" onClick={() => { onDelete(r.id); setConfirm(null); }}>Delete</Btn>
                    <Btn onClick={() => setConfirm(null)}>Keep</Btn>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <Btn onClick={() => onToggleWeek(r.id)} aria-label={inWeek ? `Remove ${r.title} from week` : `Add ${r.title} to week`}>
                      {inWeek ? <Minus size={15} /> : <Heart size={15} />}
                    </Btn>
                    <Btn onClick={() => onEdit(r)} aria-label={`Edit ${r.title}`}>
                      <Pencil size={15} />
                    </Btn>
                    <Btn onClick={() => setConfirm(r.id)} aria-label={`Delete ${r.title}`}>
                      <Trash2 size={15} />
                    </Btn>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <details className="rounded-2xl bg-chip/60 px-4 py-3 text-xs text-muted">
        <summary className="cursor-pointer font-bold">Photo credits</summary>
        <ul className="mt-2 space-y-1">
          {recipes.filter((r) => photoOf(r)?.credit?.author).map((r) => {
            const c = photoOf(r).credit;
            return (
              <li key={r.id}>
                {r.title}: {c.source ? <a className="underline" href={c.source} target="_blank" rel="noopener noreferrer">{c.title || "photo"}</a> : "photo"} by {c.author}{c.license ? `, ${c.license}` : ""}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Planner({ initial, store, onSignOut }) {
  const [state, setState] = useState(initial);
  const [sync, setSync] = useState({ status: "saved", detail: "" });
  const { recipes, decisions, plan, checked, settings } = state;
  const [tab, setTab] = useState("swipe");
  const [modal, setModal] = useState(null); // {type: 'form'|'json'|'settings'|'copy', data}
  const [toast, setToast] = useState(null);
  const [history, setHistory] = useState([]);
  const [detail, setDetail] = useState(null); // { id, fromDeck }
  const flyRef = useRef(null);
  const pendingMult = useRef(null);

  useEffect(() => {
    store.onStatus((status, detail) => {
      setSync({ status, detail });
      if (status === "error" && detail) setToast(detail);
    });
    // Someone else in the household changed something: take their version.
    return store.subscribe((saved) => setState(hydrate(saved)));
  }, [store]);

  useEffect(() => {
    store.persist(state);
  }, [state, store]);

  const patch = useCallback((fn) => setState((s) => ({ ...s, ...fn(s) })), []);
  const setSettings = useCallback((fn) => patch((s) => ({ settings: typeof fn === "function" ? fn(s.settings) : fn })), [patch]);
  const setChecked = useCallback((fn) => patch((s) => ({ checked: typeof fn === "function" ? fn(s.checked) : fn })), [patch]);

  const showToast = useCallback((text) => {
    setToast(text);
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => setToast(null), 2200);
  }, []);

  const byId = useMemo(() => Object.fromEntries(recipes.map((r) => [r.id, r])), [recipes]);
  const deck = useMemo(() => recipes.filter((r) => !decisions[r.id]), [recipes, decisions]);
  const planList = useMemo(
    () => Object.entries(plan).filter(([id]) => byId[id]).map(([id, mult]) => ({ recipe: byId[id], mult })),
    [plan, byId]
  );
  const summary = useMemo(() => weekSummary(planList, settings.household, settings.target), [planList, settings.household, settings.target]);
  const cuisines = useMemo(() => [...new Set(recipes.map((r) => r.cuisine))].sort(), [recipes]);
  const passedCount = Object.values(decisions).filter((d) => d === "pass").length;
  const missingStarters = STARTER_RECIPES.filter((s) => !byId[s.id]).length;

  const defaultMult = useCallback(
    (r) => (settings.portionMode === "fit" ? fitMultiplier(r, settings.household) : 1),
    [settings.portionMode, settings.household]
  );

  const decide = useCallback(
    (id, decision) => {
      setHistory((h) => [...h.slice(-30), id]);
      const pm = pendingMult.current && pendingMult.current.id === id ? pendingMult.current.m : null;
      patch((s) => {
        const r = s.recipes.find((x) => x.id === id);
        const plan = { ...s.plan };
        if (decision === "pick" && r) plan[id] = pm ?? (s.settings.portionMode === "fit" ? fitMultiplier(r, s.settings.household) : 1);
        return { decisions: { ...s.decisions, [id]: decision }, plan };
      });
      pendingMult.current = null;
      if (decision === "pick") {
        const r = byId[id];
        if (r) showToast(`Added ${r.title}`);
      }
    },
    [patch, byId, showToast]
  );

  const undo = () => {
    const id = history[history.length - 1];
    if (!id) return;
    setHistory((h) => h.slice(0, -1));
    patch((s) => {
      const decisions = { ...s.decisions };
      const plan = { ...s.plan };
      delete decisions[id];
      delete plan[id];
      // put it back on top of the deck
      const r = s.recipes.find((x) => x.id === id);
      const recipes = r ? [r, ...s.recipes.filter((x) => x.id !== id)] : s.recipes;
      return { decisions, plan, recipes };
    });
  };

  const redealPassed = () => {
    patch((s) => ({ decisions: Object.fromEntries(Object.entries(s.decisions).filter(([, d]) => d !== "pass")) }));
    setHistory([]);
    showToast("Passed recipes are back in the deck");
  };

  const shuffle = () => {
    patch((s) => {
      const undecided = s.recipes.filter((r) => !s.decisions[r.id]);
      for (let i = undecided.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [undecided[i], undecided[j]] = [undecided[j], undecided[i]];
      }
      return { recipes: [...undecided, ...s.recipes.filter((r) => s.decisions[r.id])] };
    });
    showToast("Shuffled");
  };

  const startNewWeek = () => {
    patch(() => ({ decisions: {}, plan: {}, checked: {} }));
    setHistory([]);
    setTab("swipe");
    showToast("Fresh week. Happy swiping!");
  };

  const setMult = (id, m) => patch((s) => ({ plan: { ...s.plan, [id]: m } }));
  const removeMeal = (id) =>
    patch((s) => {
      const plan = { ...s.plan };
      delete plan[id];
      return { plan, decisions: { ...s.decisions, [id]: "pass" } };
    });
  const toggleWeek = (id) => {
    if (plan[id] != null) removeMeal(id);
    else {
      patch((s) => ({ plan: { ...s.plan, [id]: defaultMult(byId[id]) }, decisions: { ...s.decisions, [id]: "pick" } }));
      showToast(`Added ${byId[id].title}`);
    }
  };
  const refitAll = (mode) =>
    patch((s) => ({
      plan: Object.fromEntries(
        Object.entries(s.plan).map(([id, m]) => {
          const r = s.recipes.find((x) => x.id === id);
          return [id, r ? (mode === "fit" ? fitMultiplier(r, s.settings.household) : 1) : m];
        })
      ),
    }));

  const saveRecipe = (r) => {
    patch((s) => {
      const exists = s.recipes.some((x) => x.id === r.id);
      return { recipes: exists ? s.recipes.map((x) => (x.id === r.id ? r : x)) : [r, ...s.recipes] };
    });
    setModal(null);
    showToast(modal?.data ? "Recipe saved" : `${r.title} is next in your deck`);
  };
  const deleteRecipe = (id) =>
    patch((s) => {
      const plan = { ...s.plan };
      const decisions = { ...s.decisions };
      delete plan[id];
      delete decisions[id];
      return { recipes: s.recipes.filter((r) => r.id !== id), plan, decisions };
    });
  const restoreStarters = () =>
    patch((s) => ({ recipes: [...s.recipes, ...STARTER_RECIPES.filter((x) => !s.recipes.some((r) => r.id === x.id)).map((x) => ({ ...x }))] }));
  const importRecipes = (list, mode) => {
    if (mode === "replace") {
      patch(() => ({ recipes: list, decisions: {}, plan: {}, checked: {} }));
      return { added: list.length, updated: 0 };
    }
    const res = mergeRecipes(recipes, list);
    patch(() => ({ recipes: res.recipes }));
    return res;
  };
  const resetAll = () => {
    setState(freshState());
    setHistory([]);
    setTab("swipe");
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Grocery list copied");
    } catch (e) {
      setModal({ type: "copy", data: text });
    }
  };

  // keyboard: ← pass, → add
  useEffect(() => {
    const onKey = (e) => {
      if (tab !== "swipe" || modal || detail) return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") flyRef.current?.("right");
      if (e.key === "ArrowLeft") flyRef.current?.("left");
      if ((e.metaKey || e.ctrlKey) && e.key === "z") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const weekFull = summary.dinners + 0.01 >= settings.target;
  const TABS = [
    ["swipe", "Swipe", Layers],
    ["week", "Week", ListChecks],
    ["library", "Recipes", BookOpen],
  ];

  return (
    <div className="min-h-full bg-bg text-ink font-body">
      <header className="sticky z-40 bg-bg/90 backdrop-blur border-b border-line" style={{ top: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto max-w-5xl flex items-center gap-3 py-2.5 gutter">
          <div className="flex items-center gap-2 mr-auto">
            <div className="h-8 w-8 rounded-[10px] bg-accent text-onaccent flex items-center justify-center font-display font-black text-lg -rotate-6">M</div>
            <span className="font-display text-xl font-extrabold tracking-tight hidden min-[380px]:inline">MealSwipe</span>
          </div>
          <button type="button" onClick={() => setTab("week")} className="text-right leading-tight rounded-xl px-2 py-1 hover:bg-chip" aria-label="View weekly plan">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted">
              {summary.recipes} {summary.recipes === 1 ? "recipe" : "recipes"} · {settings.household} {settings.household === 1 ? "person" : "people"}
            </div>
            <div className="font-display text-base font-extrabold tabular-nums whitespace-nowrap">
              <span className="hidden sm:inline">Selected: </span><span className={weekFull ? "text-good" : "text-accent"}>{formatDinners(summary.dinners)}</span> / {settings.target} dinners
            </div>
          </button>
          <button type="button" aria-label="Household and settings" onClick={() => setModal({ type: "settings" })} className="relative p-2 rounded-xl text-muted hover:text-ink hover:bg-chip">
            <Settings size={20} />
            {store.mode === "supabase" && (
              <span
                title={sync.status === "offline" ? "Offline: changes will sync when you're back online" : sync.status === "saving" ? "Saving" : "Synced with your household"}
                className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${sync.status === "offline" || sync.status === "error" ? "bg-warn" : sync.status === "saving" ? "bg-muted animate-pulse" : "bg-good"}`}
              />
            )}
          </button>
        </div>
        <div className="mx-auto max-w-5xl gutter pb-2">
          <Progress dinners={summary.dinners} target={settings.target} />
        </div>
        <nav className="mx-auto max-w-5xl gutter pb-2.5 flex gap-1">
          {TABS.map(([k, l, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition ${tab === k ? "bg-ink text-bg" : "text-muted hover:bg-chip"}`}
            >
              <Icon size={16} /> {l}
            </button>
          ))}
        </nav>
      </header>

      <main className="gutter py-5 overflow-x-clip">
        {tab === "swipe" && (
          <div className="mx-auto max-w-[26rem] flex flex-col items-center gap-4">
            {weekFull && deck.length > 0 && (
              <button type="button" onClick={() => setTab("week")} className="w-full rounded-2xl bg-good/15 text-good px-4 py-2.5 text-sm font-bold flex items-center justify-between">
                <span>Your {settings.target} dinners are covered.</span>
                <span className="underline">See plan</span>
              </button>
            )}
            <div className="relative w-full" style={{ height: "min(32rem, calc(100svh - 17rem))", minHeight: "26rem" }}>
              {deck.length > 0 ? (
                <SwipeDeck deck={deck} settings={settings} onDecide={decide} flyRef={flyRef} onOpen={(r) => setDetail({ id: r.id, fromDeck: true })} />
              ) : (
                <div className="h-full rounded-[28px] border-2 border-dashed border-line flex flex-col items-center justify-center text-center gap-3 p-6">
                  <div className="text-5xl" aria-hidden="true">🍽️</div>
                  <h2 className="font-display text-xl font-extrabold">That's the whole deck</h2>
                  <p className="text-sm text-muted">
                    {summary.recipes} picked, {passedCount} passed. Re-deal the ones you passed, add your own, or go build the list.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {passedCount > 0 && (
                      <Btn variant="soft" onClick={redealPassed}>
                        <RotateCcw size={15} /> Re-deal passed
                      </Btn>
                    )}
                    <Btn variant="soft" onClick={() => setModal({ type: "form" })}>
                      <Plus size={15} /> Add recipe
                    </Btn>
                  </div>
                </div>
              )}
            </div>

            {deck.length > 0 && (
              <div className="flex items-center justify-center gap-5">
                <button type="button" aria-label="Undo last swipe" onClick={undo} disabled={!history.length} className="h-11 w-11 rounded-full bg-surface border border-line text-muted flex items-center justify-center shadow-sm disabled:opacity-30 hover:text-ink">
                  <Undo2 size={18} />
                </button>
                <button type="button" aria-label="Pass" onClick={() => flyRef.current?.("left")} className="h-16 w-16 rounded-full bg-surface border border-line text-danger flex items-center justify-center shadow-card active:scale-95 transition hover:scale-105">
                  <X size={30} strokeWidth={3} />
                </button>
                <button type="button" aria-label="Add to week" onClick={() => flyRef.current?.("right")} className="h-16 w-16 rounded-full bg-good text-white flex items-center justify-center shadow-card active:scale-95 transition hover:scale-105">
                  <Heart size={28} strokeWidth={2.5} fill="currentColor" />
                </button>
                <button type="button" aria-label="Shuffle deck" onClick={shuffle} className="h-11 w-11 rounded-full bg-surface border border-line text-muted flex items-center justify-center shadow-sm hover:text-ink">
                  <Shuffle size={18} />
                </button>
              </div>
            )}

            <div className="w-full flex flex-col gap-2">
              <Btn variant="primary" className="w-full py-3" onClick={() => setTab("week")}>
                <ShoppingBasket size={17} /> View weekly plan & grocery list
              </Btn>
              <div className="flex justify-between text-xs text-muted">
                <span className="tabular-nums">{deck.length} left in deck</span>
                <span className="hidden sm:inline">← pass · → add · drag the card</span>
                <button type="button" className="font-bold text-accent" onClick={() => setModal({ type: "form" })}>
                  + Add recipe
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "week" && (
          <>
            <WeekView
              planList={planList}
              settings={settings}
              setSettings={setSettings}
              summary={summary}
              setMult={setMult}
              removeMeal={removeMeal}
              refitAll={refitAll}
              checked={checked}
              setChecked={setChecked}
              onCopy={copyText}
              goSwipe={() => setTab("swipe")}
              onOpen={(r) => setDetail({ id: r.id, fromDeck: false })}
            />
            {planList.length > 0 && (
              <div className="mx-auto max-w-5xl pt-6 flex justify-center">
                <Btn variant="ghost" onClick={startNewWeek}>
                  <RotateCcw size={14} /> Start a new week (clears picks and checkmarks)
                </Btn>
              </div>
            )}
          </>
        )}

        {tab === "library" && (
          <LibraryView
            recipes={recipes}
            decisions={decisions}
            plan={plan}
            settings={settings}
            onEdit={(r) => setModal({ type: "form", data: r })}
            onDelete={deleteRecipe}
            onAdd={() => setModal({ type: "form" })}
            onJson={() => setModal({ type: "json" })}
            onRestore={restoreStarters}
            missingStarters={missingStarters}
            onToggleWeek={toggleWeek}
            onOpen={(r) => setDetail({ id: r.id, fromDeck: false })}
          />
        )}
      </main>

      {detail && byId[detail.id] && (
        <RecipeDetail
          key={detail.id}
          recipe={byId[detail.id]}
          settings={settings}
          planMult={plan[detail.id]}
          defaultMult={defaultMult(byId[detail.id])}
          fromDeck={detail.fromDeck && !decisions[detail.id]}
          onClose={() => setDetail(null)}
          onSetMult={setMult}
          onRemove={(id) => { removeMeal(id); setDetail(null); }}
          onEdit={(r) => { setDetail(null); setModal({ type: "form", data: r }); }}
          onPass={() => { setDetail(null); setTimeout(() => flyRef.current?.("left"), 60); }}
          onAdd={(id, m) => {
            if (detail.fromDeck && !decisions[id]) {
              setDetail(null);
              pendingMult.current = { id, m };
              setTimeout(() => flyRef.current?.("right"), 60);
            } else {
              patch((s) => ({ plan: { ...s.plan, [id]: m }, decisions: { ...s.decisions, [id]: "pick" } }));
              showToast(`Added ${byId[id].title}`);
              setDetail(null);
            }
          }}
        />
      )}
      {modal?.type === "form" && (
        <Modal title={modal.data ? "Edit recipe" : "Add a recipe"} onClose={() => setModal(null)} wide>
          <RecipeForm initial={modal.data} onSave={saveRecipe} onCancel={() => setModal(null)} cuisines={cuisines} askClaude={store && store.askClaude ? (draft) => store.askClaude(draft, settings.units, settings.aiModel || DEFAULT_AI_MODEL) : null} />
        </Modal>
      )}
      {modal?.type === "json" && (
        <JsonModal
          recipes={recipes}
          fullState={state}
          onImport={importRecipes}
          onRestoreBackup={(b) => {
            setState(hydrate(b));
            setHistory([]);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "settings" && <SettingsModal settings={settings} setSettings={setSettings} onClose={() => setModal(null)} onReset={resetAll} store={store} sync={sync} onSignOut={onSignOut} onChangePasscode={() => setModal({ type: "passcode" })} />}
      {modal?.type === "passcode" && <ChangePasscodeModal store={store} onClose={() => setModal(null)} />}
      {modal?.type === "copy" && (
        <Modal title="Copy your list" onClose={() => setModal(null)}>
          <p className="mb-2 text-sm text-muted">Your browser blocked automatic copying. The text is selected: press Ctrl/Cmd+C.</p>
          <textarea id="copy-fallback" readOnly autoFocus onFocus={(e) => e.target.select()} value={modal.data} rows={14} className="w-full rounded-xl border border-line bg-bg p-3 font-mono text-xs text-ink" />
        </Modal>
      )}

      <div
        aria-live="polite"
        className={`fixed left-1/2 -translate-x-1/2 z-[60] rounded-full bg-ink text-bg px-4 py-2 text-sm font-semibold shadow-lg transition-all duration-200 ${toast ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"}`}
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
      >
        {toast}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry: picks the storage backend, asks for the household passcode when shared.
function PasscodeGate({ onSubmit, error, busy }) {
  const [code, setCode] = useState("");
  return (
    <div className="min-h-full bg-bg text-ink font-body flex items-center justify-center gutter py-10">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) onSubmit(code);
        }}
        className="w-full max-w-sm space-y-5 rounded-3xl border border-line bg-surface p-6 shadow-card"
      >
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 rounded-xl bg-accent text-onaccent flex items-center justify-center font-display font-black text-xl -rotate-6">M</div>
          <span className="font-display text-2xl font-extrabold tracking-tight">MealSwipe</span>
        </div>
        <div className="space-y-1">
          <h1 className="font-display text-xl font-extrabold">Enter your household passcode</h1>
          <p className="text-sm text-muted">Everyone with the passcode shares the same week, recipes and grocery list. You only need to enter it once on this device.</p>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">Passcode</span>
          <div className="relative">
            <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="passcode"
              autoFocus
              autoComplete="current-password"
              autoCapitalize="none"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-xl border border-line bg-bg pl-9 pr-3 py-3 text-base text-ink focus:outline-none focus:border-accent"
              placeholder="word-word-word-00"
            />
          </div>
        </label>
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
        <button type="submit" disabled={busy || !code.trim()} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-accent text-onaccent px-4 py-3 font-bold disabled:opacity-50">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />} Open our week
        </button>
      </form>
    </div>
  );
}

export default function MealSwipe() {
  const store = useMemo(() => createStore(), []);
  const [phase, setPhase] = useState(() => (store.needsPasscode ? (store.hasPasscode() ? "loading" : "gate") : "ready"));
  const [initial, setInitial] = useState(() => (store.needsPasscode ? null : hydrate(store.loadSync())));
  const [error, setError] = useState("");
  const [session, setSession] = useState(0);
  const CHANGED_MSG = "The household passcode was changed. Enter the new one.";

  // Someone changed the passcode on another device: ask this one for the new code.
  useEffect(() => {
    store.onSignedOut(() => {
      setInitial(null);
      setError(CHANGED_MSG);
      setPhase("gate");
    });
  }, [store]);

  const open = useCallback(async () => {
    try {
      const saved = await store.load();
      setInitial(hydrate(saved));
      setPhase("ready");
      setSession((n) => n + 1);
    } catch (e) {
      setError(e.authLost ? CHANGED_MSG : e.message);
      setPhase(/passcode/i.test(e.message) ? "gate" : "failed");
    }
  }, [store]);

  useEffect(() => {
    if (phase === "loading") open();
  }, [phase, open]);

  if (phase === "gate" || phase === "signing-in")
    return (
      <PasscodeGate
        busy={phase === "signing-in"}
        error={error}
        onSubmit={async (code) => {
          setPhase("signing-in");
          setError("");
          try {
            await store.signIn(code);
            setPhase("loading");
          } catch (e) {
            setError(e.message);
            setPhase("gate");
          }
        }}
      />
    );
  if (phase === "failed")
    return (
      <div className="min-h-full bg-bg text-ink flex flex-col items-center justify-center gap-3 gutter text-center">
        <CloudOff size={32} className="text-muted" />
        <p className="font-semibold">Couldn't reach your household.</p>
        <p className="text-sm text-muted">{error}</p>
        <Btn variant="primary" onClick={() => setPhase("loading")}>Try again</Btn>
      </div>
    );
  if (phase !== "ready" || !initial)
    return (
      <div className="min-h-full bg-bg flex items-center justify-center text-muted gap-2">
        <Loader2 size={18} className="animate-spin" /> Loading your week…
      </div>
    );
  return (
    <Planner
      key={session}
      initial={initial}
      store={store}
      onSignOut={() => {
        store.signOut();
        setInitial(null);
        setError("");
        setPhase("gate");
      }}
    />
  );
}
