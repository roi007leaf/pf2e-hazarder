import { RANKS } from '../constants.js';

const int = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const list = (obj) =>
  Array.isArray(obj)
    ? obj
    : Object.keys(obj ?? {})
        .sort((a, b) => a - b)
        .map((k) => obj[k]);

export function nextId(prefix, items) {
  let max = 0;
  for (const it of items ?? []) {
    const id = String(it?.id ?? '');
    const n =
      id.startsWith(prefix) && /^[0-9]+$/.test(id.slice(prefix.length))
        ? Number(id.slice(prefix.length))
        : 0;
    max = Math.max(max, n);
  }
  return `${prefix}${max + 1}`;
}

const CORE_SKILLS = [
  'acrobatics',
  'arcana',
  'athletics',
  'crafting',
  'deception',
  'diplomacy',
  'intimidation',
  'medicine',
  'nature',
  'occultism',
  'performance',
  'religion',
  'society',
  'stealth',
  'survival',
  'thievery',
];

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Skill choices for the disable-option skill field (free text stays allowed for Lores). */
export function skillOptions() {
  const configured = globalThis.CONFIG?.PF2E?.skills;
  const options = configured
    ? Object.entries(configured).map(([slug, v]) => ({
        slug,
        label: game.i18n.localize(v?.label ?? v ?? capitalise(slug)),
      }))
    : CORE_SKILLS.map((slug) => ({ slug, label: capitalise(slug) }));
  options.push({
    slug: 'perception',
    label: configured ? game.i18n.localize('PF2E.PerceptionLabel') : 'Perception',
  });
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

export function planToContext(plan, warnings, actor) {
  const items = [...(actor.items ?? [])]
    .filter((i) => i.type === 'action' || i.type === 'melee')
    .map((i) => ({ id: i.id, name: i.name }));
  const routine = new Set(plan.routineItemIds ?? []);
  return {
    plan,
    skills: skillOptions(),
    ranks: RANKS.map((r, value) => ({ value, label: `PF2E_HAZARDER.Rank.${r}` })),
    warnings: warnings.map((w) => `PF2E_HAZARDER.Warnings.${w}`),
    items,
    routineItems: items
      .filter((i) => i.id !== plan.reactionItemId)
      .map((i) => ({ ...i, checked: routine.has(i.id) })),
  };
}

function parseIdList(value, fallback) {
  if (value === undefined) return [...(fallback ?? [])];
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v);
  if (typeof value === 'string') return value ? [value] : [];
  return Object.entries(value ?? {})
    .filter(([, on]) => on === true || on === 'true' || on === 'on')
    .map(([id]) => id);
}

function parseCounteract(row, prev, keepBlank) {
  if (row === undefined) return prev ?? null;
  const name = String(row?.name ?? '').trim();
  const rank = int(row?.rank);
  const dc = int(row?.dc);
  if (!name && !(keepBlank && (rank != null || dc != null))) return null;
  return { spellUuid: prev?.spellUuid ?? null, name, rank, dc };
}

// 0 / blank = any rank may attempt; a missing field keeps the saved value.
function parseRank(value, prev) {
  if (value === undefined) return prev ?? null;
  const n = int(value);
  return n != null && n >= 1 ? Math.min(RANKS.length - 1, n) : null;
}

// Blank or < 1 turns "any combination" mode off; a missing field keeps the saved value.
function parseShared(value, prev) {
  if (value === undefined) return prev ?? null;
  const n = int(value);
  return n != null && n >= 1 ? n : null;
}

export function formToPlan(data, basePlan, { keepBlank = false } = {}) {
  const baseComps = new Map(basePlan.components.map((c) => [c.id, c]));
  const compRows = list(data.components);
  const compIds = compRows.filter((c) => c.id).map((c) => ({ id: c.id }));
  const components = compRows.map((c) => {
    const id = c.id || nextId('c', compIds);
    if (!c.id) compIds.push({ id });
    const prev = baseComps.get(id);
    const prevDisables = new Map((prev?.disables ?? []).map((d) => [d.id, d]));
    const rows = list(c.disables);
    const dIds = rows.filter((d) => d.id).map((d) => ({ id: d.id }));
    const disables = rows
      .filter((d) => keepBlank || (d.skill && String(d.skill).trim()))
      .map((d) => {
        const did = d.id || nextId('d', dIds);
        if (!d.id) dIds.push({ id: did });
        const skill = String(d.skill ?? '').trim();
        return {
          id: did,
          skill,
          dc: int(d.dc),
          label: (d.label && String(d.label).trim()) || skill,
          traits: d.id ? (prevDisables.get(did)?.traits ?? []) : [],
          successesNeeded: Math.max(1, int(d.successesNeeded) ?? 1),
          minRank: parseRank(d.minRank, prevDisables.get(did)?.minRank),
        };
      });
    return {
      id,
      name: (c.name && String(c.name).trim()) || prev?.name || (keepBlank ? '' : id),
      count: Math.max(1, int(c.count) ?? 1),
      actionsEach: Math.max(0, int(c.actionsEach) ?? 0),
      sharedSuccesses: parseShared(c.sharedSuccesses, prev?.sharedSuccesses),
      disables,
      counteract: parseCounteract(c.counteract, prev?.counteract, keepBlank),
    };
  });
  return {
    ...structuredClone(basePlan),
    confirmed: true,
    actionsPerTurn: int(data.actionsPerTurn),
    reactionItemId: data.reactionItemId || null,
    routineItemIds: parseIdList(data.routineItemIds, basePlan.routineItemIds),
    components,
  };
}
