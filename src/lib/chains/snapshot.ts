/**
 * Chain-menu snapshots: the file format and the gates a snapshot must pass before it may load (chain row 1, 2026-11-16).
 *
 * WHAT IT IS. One JSON file per chain, `chains/menus/<chain>.json`, holding a chain's OWN published nutrition: its
 * items, the components each item is built from, and spot checks against the chain's own calculator or PDF. (Not
 * `chains/snapshots/`: the backend .gitignore ignores every directory named `snapshots/`.) Every collector (a curl
 * adapter, a PDF read, a Claude-in-Chrome pass) emits this one format, so a monthly refresh is a PR whose diff reads as
 * "what changed on the menu" and whose CI runs these gates. Nothing here touches the database or the mapping pipeline;
 * the loader and the chain lane are later rows. Plan and decisions:
 * `sync-docs/reports/2026-11-15_chain-menu-survey-of-102-chains-and-the-ingest-plan.md` in the mobile repo (§2, §5).
 *
 * NULL IS NOT ZERO. Every panel field is `number | null`; null means "the source does not publish it" (the same rule
 * as the parse wire's sugar and sodium). A gate that needs a field skips a row whose field is null; it never reads 0.
 *
 * UNITS. kcal; grams for protein / carbs / fat / sat fat / trans fat / fiber / sugar / added sugar; MILLIGRAMS for
 * cholesterol and sodium (as chains publish them). This differs from `component-table.ts`, whose sodium is grams per
 * 100 g; a later consumer converts at its own seam.
 *
 * PARTS AND PORTIONS. `components[].portions[]` holds standalone panels a chain publishes for a component (a Five Guys
 * topping with grams, a Moe's "Ingredient for Burrito" portion without grams, a Jimmy John's EZ / REG / XTRA, a
 * Peet's "1 pump"). `item.parts[]` links an item to that catalogue: `portionLabel` + `quantity` name the published
 * portion when the item is built from one (a Nutritionix default modifier, a Domino's topping on a 14" pie); `grams`,
 * the rounded `kcalPublished`, a `contribution` panel and the chain's own `without` panel (the item minus this part, as
 * its calculator shows it) carry what the chain publishes for the part inside this item. McDonald's publishes no
 * portions: its contributions are kcal per 100 g x grams with leave-one-out macro deltas, and those deltas MAY be
 * negative (a +-1 g rounding flip), so contribution panels alone accept negative numbers.
 *
 * VARIANTS. `item.variant` is null or canonical `key=value` pairs joined by `;` with the keys in alphabetical order
 * (`milk=oat;size=medium;temp=iced`), so a size x milk x temp grid (Dunkin', Peet's) or size x crust (Domino's) stays
 * one item per cell with a machine-readable variant.
 *
 * THE GATES (`checkSnapshot()`; each returns problems, an empty list is a pass):
 *  1. structure  - schemaVersion 1; the chain slug matches the file name; keys unique; every part, portion label and
 *                  spot-check part resolves; every row names a source; numbers finite and >= 0 (contributions may be
 *                  negative); dates YYYY-MM-DD; variants canonical.
 *  2. atwater    - an item or portion panel with kcal >= 20 and protein, carbs and fat all present must satisfy
 *                  |kcal - (4P + 4C + 9F)| <= max(20, 15% of kcal), unless the row sets `atwaterExempt` (a reason:
 *                  alcohol, sugar alcohols). Part `contribution` panels are NOT checked: derived macros carry rounding.
 *  3. closure    - an item whose default parts ALL carry `contribution.kcal` must sum to the item's kcal within
 *                  max(10, 5% of kcal).
 *  4. freshness  - a source whose `sourceDate` (else `generatedAt`, else `fetchedAt`) is more than 365 days before `now`
 *                  is stale. CI passes `now` = the snapshot's newest `fetchedAt` (`newestFetchedAt()`), so CI proves the
 *                  source was current WHEN COLLECTED and a stale source cannot be committed; whether a committed
 *                  snapshot has since gone stale is the weekly report's job, never a CI red. An undated source falls
 *                  back to `fetchedAt` and so always passes: the gate cannot see an undated source's age.
 *  5. spotChecks - at least 3; each recomputes its build from the snapshot and must land within 10 kcal of `observed`.
 *                  The base is the item (one removed part with a `without` panel reads that panel; otherwise item kcal
 *                  minus the removed parts' `contribution.kcal`) or nothing when `itemKey` is null (a build from
 *                  components alone: a Chipotle bowl, a Domino's build-your-own); then each `addParts` entry adds its
 *                  portion's kcal x quantity. A build that cannot be computed is a failure, never a skip.
 * `checkChurn()` is the sixth gate and needs the previous snapshot: more than 20% of item and component keys added,
 * removed or changed marks the collector broken, not the menu. It compares canonical JSON (keys sorted), and the first
 * refresh that grows a chain's menu will trip it by design: that PR says so.
 */

export const SNAPSHOT_SCHEMA_VERSION = 1;

export type Panel = {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  satFatG: number | null;
  transFatG: number | null;
  cholesterolMg: number | null;
  sodiumMg: number | null;
  fiberG: number | null;
  sugarG: number | null;
  addedSugarG: number | null;
};

export const PANEL_FIELDS: readonly (keyof Panel)[] = [
  'kcal', 'proteinG', 'carbsG', 'fatG', 'satFatG', 'transFatG',
  'cholesterolMg', 'sodiumMg', 'fiberG', 'sugarG', 'addedSugarG',
];

export type ChainRoute = 'chrome' | 'pdf' | 'html-json' | 'html-table' | 'nutritionix';

export type ChainSource = {
  id: string;
  kind: ChainRoute;
  url: string;
  landingUrl: string | null;
  /** The date the chain prints on the source ("October 2026" -> 2026-10-01), if any. */
  sourceDate: string | null;
  /** A machine timestamp the source carries (Nutritionix `generatedAt`), date part only. */
  generatedAt: string | null;
  fetchedAt: string;
  /** sha256 of the fetched bytes, for the weekly change check; null when a browser pass read it. */
  contentHash: string | null;
};

export type ComponentPortion = {
  label: string;
  grams: number | null;
  panel: Panel;
  sourceId: string;
  atwaterExempt?: string;
};

export type ChainComponent = {
  key: string;
  name: string;
  /** Lowercase words a user types to remove it (`no mayo` -> 'mayo'). */
  removalKeys: string[];
  portions: ComponentPortion[];
};

export type ItemPart = {
  componentKey: string;
  portionLabel: string | null;
  quantity: number | null;
  grams: number | null;
  isDefault: boolean;
  kcalPublished: number | null;
  contribution: Panel | null;
  contributionBasis?: string;
  without: Panel | null;
};

export type ChainItem = {
  key: string;
  name: string;
  aliases: string[];
  variant: string | null;
  servingG: number | null;
  panel: Panel;
  sourceId: string;
  parts: ItemPart[];
  atwaterExempt?: string;
};

export type SpotCheckAdd = {
  componentKey: string;
  portionLabel: string;
  quantity: number;
};

export type SpotCheck = {
  id: string;
  /** null = a build from components alone. */
  itemKey: string | null;
  removeComponentKeys: string[];
  addParts: SpotCheckAdd[];
  observed: Panel;
  observedAt: string;
  where: string;
};

export type ChainSnapshot = {
  schemaVersion: number;
  chain: string;
  chainName: string;
  country: string;
  /** The route the chain is collected by as a whole (the hardest of its sources' kinds). */
  route: ChainRoute;
  sources: ChainSource[];
  components: ChainComponent[];
  items: ChainItem[];
  spotChecks: SpotCheck[];
};

export const ATWATER_MIN_KCAL = 20;
export const ATWATER_ABS_TOLERANCE = 20;
export const ATWATER_REL_TOLERANCE = 0.15;
export const CLOSURE_ABS_TOLERANCE = 10;
export const CLOSURE_REL_TOLERANCE = 0.05;
export const FRESHNESS_MAX_DAYS = 365;
export const SPOT_CHECK_MIN = 3;
export const SPOT_CHECK_TOLERANCE_KCAL = 10;
export const CHURN_MAX_FRACTION = 0.2;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VARIANT = /^[a-z0-9-]+=[^;=]+(;[a-z0-9-]+=[^;=]+)*$/;
const ROUTES: readonly ChainRoute[] = ['chrome', 'pdf', 'html-json', 'html-table', 'nutritionix'];
const DAY_MS = 24 * 60 * 60 * 1000;

function badNumber(v: unknown, allowNegative = false): boolean {
  if (v === null) return false;
  if (typeof v !== 'number' || !Number.isFinite(v)) return true;
  return !allowNegative && v < 0;
}

function panelProblems(where: string, panel: Panel | null | undefined, allowNegative = false): string[] {
  if (panel === null || panel === undefined) return [];
  const out: string[] = [];
  const rule = allowNegative ? 'a finite number or null' : 'a finite number >= 0 or null';
  for (const f of PANEL_FIELDS) {
    if (!(f in panel)) out.push(`${where}: panel lacks ${f}`);
    else if (badNumber(panel[f], allowNegative)) out.push(`${where}: ${f} is not ${rule}`);
  }
  return out;
}

function variantProblem(where: string, variant: string | null): string | null {
  if (variant === null) return null;
  if (!VARIANT.test(variant)) return `${where}: variant "${variant}" is not key=value;key=value`;
  const keys = variant.split(';').map((pair) => pair.split('=')[0]);
  const sorted = [...keys].sort();
  if (keys.join(';') !== sorted.join(';') || new Set(keys).size !== keys.length) {
    return `${where}: variant "${variant}" keys are not unique and alphabetical`;
  }
  return null;
}

export function checkStructure(snap: ChainSnapshot, fileSlug: string): string[] {
  const out: string[] = [];
  if (snap.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) out.push(`schemaVersion ${snap.schemaVersion} is not ${SNAPSHOT_SCHEMA_VERSION}`);
  if (!SLUG.test(snap.chain)) out.push(`chain "${snap.chain}" is not a lowercase slug`);
  if (snap.chain !== fileSlug) out.push(`chain "${snap.chain}" does not match the file name "${fileSlug}"`);
  if (!ROUTES.includes(snap.route)) out.push(`route "${snap.route}" is unknown`);
  const sourceIds = new Set<string>();
  for (const s of snap.sources) {
    if (sourceIds.has(s.id)) out.push(`source ${s.id}: duplicate id`);
    sourceIds.add(s.id);
    if (!ROUTES.includes(s.kind)) out.push(`source ${s.id}: kind "${s.kind}" is unknown`);
    if (!DATE.test(s.fetchedAt)) out.push(`source ${s.id}: fetchedAt "${s.fetchedAt}" is not YYYY-MM-DD`);
    for (const d of [s.sourceDate, s.generatedAt]) {
      if (d !== null && !DATE.test(d)) out.push(`source ${s.id}: date "${d}" is not YYYY-MM-DD`);
    }
  }
  if (sourceIds.size === 0) out.push('no sources');
  const portionLabels = new Map<string, Set<string>>();
  for (const c of snap.components) {
    if (portionLabels.has(c.key)) out.push(`component ${c.key}: duplicate key`);
    const labels = new Set<string>();
    portionLabels.set(c.key, labels);
    for (const k of c.removalKeys) {
      if (k !== k.toLowerCase() || k.trim() === '') out.push(`component ${c.key}: removal key "${k}" is not lowercase text`);
    }
    for (const p of c.portions) {
      if (labels.has(p.label)) out.push(`component ${c.key}: duplicate portion "${p.label}"`);
      labels.add(p.label);
      if (!sourceIds.has(p.sourceId)) out.push(`component ${c.key} portion "${p.label}": unknown source ${p.sourceId}`);
      if (badNumber(p.grams)) out.push(`component ${c.key} portion "${p.label}": grams is not a finite number >= 0 or null`);
      out.push(...panelProblems(`component ${c.key} portion "${p.label}"`, p.panel));
    }
  }
  const resolves = (componentKey: string, portionLabel: string | null): string | null => {
    const labels = portionLabels.get(componentKey);
    if (!labels) return 'unknown component';
    if (portionLabel !== null && !labels.has(portionLabel)) return `unknown portion "${portionLabel}"`;
    return null;
  };
  const itemKeys = new Set<string>();
  for (const it of snap.items) {
    if (itemKeys.has(it.key)) out.push(`item ${it.key}: duplicate key`);
    itemKeys.add(it.key);
    if (!sourceIds.has(it.sourceId)) out.push(`item ${it.key}: unknown source ${it.sourceId}`);
    if (badNumber(it.servingG)) out.push(`item ${it.key}: servingG is not a finite number >= 0 or null`);
    const v = variantProblem(`item ${it.key}`, it.variant);
    if (v) out.push(v);
    out.push(...panelProblems(`item ${it.key}`, it.panel));
    for (const part of it.parts) {
      const where = `item ${it.key} part ${part.componentKey}`;
      const r = resolves(part.componentKey, part.portionLabel);
      if (r) out.push(`${where}: ${r}`);
      if (badNumber(part.quantity) || part.quantity === 0) out.push(`${where}: quantity is not a number > 0 or null`);
      if (badNumber(part.grams)) out.push(`${where}: grams is not a finite number >= 0 or null`);
      if (badNumber(part.kcalPublished)) out.push(`${where}: kcalPublished is not a finite number >= 0 or null`);
      out.push(...panelProblems(`${where} contribution`, part.contribution, true));
      out.push(...panelProblems(`${where} without`, part.without));
    }
  }
  for (const sc of snap.spotChecks) {
    if (sc.itemKey !== null && !itemKeys.has(sc.itemKey)) out.push(`spot check ${sc.id}: unknown item ${sc.itemKey}`);
    if (sc.itemKey === null && (sc.removeComponentKeys.length > 0 || sc.addParts.length === 0)) {
      out.push(`spot check ${sc.id}: a build with no item must add parts and remove none`);
    }
    for (const a of sc.addParts) {
      const r = resolves(a.componentKey, a.portionLabel);
      if (r) out.push(`spot check ${sc.id} add ${a.componentKey}: ${r}`);
      if (badNumber(a.quantity) || a.quantity === 0) out.push(`spot check ${sc.id} add ${a.componentKey}: quantity is not a number > 0`);
    }
    if (!DATE.test(sc.observedAt)) out.push(`spot check ${sc.id}: observedAt "${sc.observedAt}" is not YYYY-MM-DD`);
    out.push(...panelProblems(`spot check ${sc.id} observed`, sc.observed));
  }
  return out;
}

function atwaterProblem(where: string, panel: Panel, exempt: string | undefined): string | null {
  if (exempt) return null;
  const { kcal, proteinG, carbsG, fatG } = panel;
  if (kcal === null || proteinG === null || carbsG === null || fatG === null) return null;
  if (kcal < ATWATER_MIN_KCAL) return null;
  const estimate = 4 * proteinG + 4 * carbsG + 9 * fatG;
  const tolerance = Math.max(ATWATER_ABS_TOLERANCE, ATWATER_REL_TOLERANCE * kcal);
  if (Math.abs(kcal - estimate) <= tolerance) return null;
  return `${where}: kcal ${kcal} vs 4P+4C+9F ${estimate} (tolerance ${tolerance})`;
}

export function checkAtwater(snap: ChainSnapshot): string[] {
  const out: string[] = [];
  for (const it of snap.items) {
    const p = atwaterProblem(`item ${it.key}`, it.panel, it.atwaterExempt);
    if (p) out.push(p);
  }
  for (const c of snap.components) {
    for (const portion of c.portions) {
      const p = atwaterProblem(`component ${c.key} portion "${portion.label}"`, portion.panel, portion.atwaterExempt);
      if (p) out.push(p);
    }
  }
  return out;
}

export function checkClosure(snap: ChainSnapshot): string[] {
  const out: string[] = [];
  for (const it of snap.items) {
    const defaults = it.parts.filter((p) => p.isDefault);
    if (defaults.length === 0 || it.panel.kcal === null) continue;
    if (defaults.some((p) => p.contribution === null || p.contribution.kcal === null)) continue;
    const sum = defaults.reduce((acc, p) => acc + (p.contribution?.kcal ?? 0), 0);
    const tolerance = Math.max(CLOSURE_ABS_TOLERANCE, CLOSURE_REL_TOLERANCE * it.panel.kcal);
    if (Math.abs(sum - it.panel.kcal) > tolerance) {
      out.push(`item ${it.key}: default parts sum to ${Math.round(sum * 10) / 10} kcal vs item ${it.panel.kcal} (tolerance ${tolerance})`);
    }
  }
  return out;
}

export function checkFreshness(snap: ChainSnapshot, now: Date): string[] {
  const out: string[] = [];
  for (const s of snap.sources) {
    const date = s.sourceDate ?? s.generatedAt ?? s.fetchedAt;
    const ageDays = (now.getTime() - Date.parse(`${date}T00:00:00Z`)) / DAY_MS;
    if (!Number.isFinite(ageDays)) out.push(`source ${s.id}: date "${date}" does not parse`);
    else if (ageDays > FRESHNESS_MAX_DAYS) out.push(`source ${s.id}: dated ${date}, ${Math.ceil(ageDays)} days old (max ${FRESHNESS_MAX_DAYS})`);
  }
  return out;
}

/** The latest `fetchedAt` across a snapshot's sources: the `now` CI checks freshness against. */
export function newestFetchedAt(snap: ChainSnapshot): Date {
  const latest = snap.sources.map((s) => s.fetchedAt).sort().pop() ?? '1970-01-01';
  return new Date(`${latest}T00:00:00Z`);
}

/** The build's kcal recomputed from the snapshot, or null when the snapshot cannot compute it. */
export function spotCheckKcal(snap: ChainSnapshot, sc: SpotCheck): number | null {
  let kcal = 0;
  if (sc.itemKey !== null) {
    const item = snap.items.find((i) => i.key === sc.itemKey);
    if (!item || item.panel.kcal === null) return null;
    const removed = sc.removeComponentKeys.map((k) => item.parts.find((p) => p.componentKey === k));
    if (removed.some((p) => p === undefined)) return null;
    const withoutKcal = removed.length === 1 ? removed[0]?.without?.kcal : undefined;
    if (typeof withoutKcal === 'number') {
      kcal = withoutKcal;
    } else {
      kcal = item.panel.kcal;
      for (const p of removed) {
        const c = p?.contribution?.kcal;
        if (c === null || c === undefined) return null;
        kcal -= c;
      }
    }
  }
  for (const a of sc.addParts) {
    const portion = snap.components.find((c) => c.key === a.componentKey)?.portions.find((p) => p.label === a.portionLabel);
    const add = portion?.panel.kcal;
    if (add === null || add === undefined) return null;
    kcal += add * a.quantity;
  }
  return kcal;
}

export function checkSpotChecks(snap: ChainSnapshot): string[] {
  const out: string[] = [];
  if (snap.spotChecks.length < SPOT_CHECK_MIN) out.push(`${snap.spotChecks.length} spot checks (min ${SPOT_CHECK_MIN})`);
  for (const sc of snap.spotChecks) {
    const computed = spotCheckKcal(snap, sc);
    if (computed === null) out.push(`spot check ${sc.id}: the snapshot cannot compute this build`);
    else if (sc.observed.kcal === null) out.push(`spot check ${sc.id}: observed kcal is null`);
    else if (Math.abs(computed - sc.observed.kcal) > SPOT_CHECK_TOLERANCE_KCAL) {
      out.push(`spot check ${sc.id}: computed ${computed} kcal vs observed ${sc.observed.kcal}`);
    }
  }
  return out;
}

export type SnapshotReport = {
  chain: string;
  structure: string[];
  atwater: string[];
  closure: string[];
  freshness: string[];
  spotChecks: string[];
};

export function checkSnapshot(snap: ChainSnapshot, fileSlug: string, now: Date): SnapshotReport {
  const structure = checkStructure(snap, fileSlug);
  if (structure.length > 0) {
    return { chain: snap.chain, structure, atwater: [], closure: [], freshness: [], spotChecks: [] };
  }
  return {
    chain: snap.chain,
    structure,
    atwater: checkAtwater(snap),
    closure: checkClosure(snap),
    freshness: checkFreshness(snap, now),
    spotChecks: checkSpotChecks(snap),
  };
}

export function reportPasses(r: SnapshotReport): boolean {
  return [r.structure, r.atwater, r.closure, r.freshness, r.spotChecks].every((p) => p.length === 0);
}

/** JSON with object keys sorted at every depth, so two collectors that order keys differently compare equal. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Gate 6: share of item and component keys added, removed or changed between two snapshots of one chain. */
export function churnFraction(prev: ChainSnapshot, next: ChainSnapshot): number {
  const before = new Map<string, string>();
  const after = new Map<string, string>();
  for (const it of prev.items) before.set(`item:${it.key}`, canonicalJson(it));
  for (const c of prev.components) before.set(`component:${c.key}`, canonicalJson(c));
  for (const it of next.items) after.set(`item:${it.key}`, canonicalJson(it));
  for (const c of next.components) after.set(`component:${c.key}`, canonicalJson(c));
  let moved = 0;
  for (const [k, v] of before) if (after.get(k) !== v) moved += 1;
  for (const k of after.keys()) if (!before.has(k)) moved += 1;
  return moved / Math.max(before.size, 1);
}

export function checkChurn(prev: ChainSnapshot, next: ChainSnapshot): string[] {
  const f = churnFraction(prev, next);
  return f > CHURN_MAX_FRACTION
    ? [`${Math.round(f * 1000) / 10}% of rows moved (max ${CHURN_MAX_FRACTION * 100}%): treat the collector as broken`]
    : [];
}
