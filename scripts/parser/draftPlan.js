import { PLAN_VERSION, RANKS } from '../constants.js';
import { parseCounteracts, parseInlineChecks, stripHtml } from './inline.js';

const WORD_NUM = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const NUM = '\\d+|one|two|three|four|five|six|seven|eight|nine|ten';
const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : (WORD_NUM[s.toLowerCase()] ?? null));

function emptyComponent(name) {
  return {
    id: 'c1',
    name,
    count: 1,
    actionsEach: 0,
    sharedSuccesses: null,
    disables: [],
    counteract: null,
  };
}

function basePlan(name) {
  return {
    version: PLAN_VERSION,
    confirmed: false,
    actionsPerTurn: null,
    components: [emptyComponent(name)],
    reactionItemId: null,
    routineItemIds: [],
    resetText: '',
    resetAfterSeconds: null,
  };
}

function successesAfter(rawDisable, check, nextIndex) {
  const tail = stripHtml(rawDisable.slice(check.end, nextIndex)).split(/[,;]|\bor\b/)[0];
  if (/\btwice\b/i.test(tail)) return 2;
  const m = /\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+times\b/i.exec(tail);
  return m ? toNum(m[1]) : 1;
}

const PROFICIENCY_RE = /\(\s*(?:untrained|trained|expert|master|legendary)\s*\)/gi;
const isConnectorOnly = (text) =>
  stripHtml(text)
    .replace(PROFICIENCY_RE, '')
    .replace(/[,;]|\b(?:or|and)\b/gi, '')
    .trim() === '';

// "@Check[...] (master)": the rank written right after a check. Alternatives joined only by
// connectors share the rank written after the last one ("@Check[a] or @Check[b] (expert)").
// Also inside the check's own label ("{Thievery (master)}") or after an action cost
// ("@Check[...] (2 actions) (trained)").
const RANK_WORD = '(untrained|trained|expert|master|legendary)';
const RANK_AFTER_RE = new RegExp(
  `^\\s*(?:\\([^)]*\\bactions?\\)\\s*)?\\(\\s*${RANK_WORD}\\s*\\)`,
  'i',
);
const RANK_IN_LABEL_RE = new RegExp(`\\{[^}]*\\(\\s*${RANK_WORD}\\s*\\)[^}]*\\}$`, 'i');
function ranksFor(rawDisable, checks) {
  const ranks = checks.map((c, i) => {
    const tail = stripHtml(rawDisable.slice(c.end, checks[i + 1]?.index ?? rawDisable.length));
    const m = RANK_IN_LABEL_RE.exec(rawDisable.slice(c.index, c.end)) ?? RANK_AFTER_RE.exec(tail);
    return m ? RANKS.indexOf(m[1].toLowerCase()) : null;
  });
  for (let i = checks.length - 2; i >= 0; i--) {
    if (ranks[i] == null && isConnectorOnly(rawDisable.slice(checks[i].end, checks[i + 1].index)))
      ranks[i] = ranks[i + 1];
  }
  return ranks.map((r) => r || null);
}

// Alternatives joined only by connectors share the multiplier written after the last one.
// A count written right after its own check is explicit; a shared one is inferred (a guess).
function successesFor(rawDisable, checks) {
  const counts = checks.map((c, i) =>
    successesAfter(rawDisable, c, checks[i + 1]?.index ?? rawDisable.length),
  );
  const inferred = checks.map(() => false);
  for (let i = checks.length - 2; i >= 0; i--) {
    if (isConnectorOnly(rawDisable.slice(checks[i].end, checks[i + 1].index))) {
      inferred[i] = counts[i] !== counts[i + 1];
      counts[i] = counts[i + 1];
    }
  }
  return { counts, inferred };
}

// "three total successes in any combination", "requires three successful checks, in any
// combination", "Succeed at two of the following checks in any combination", "any combination of
// three punctured pipes": every option adds to one shared total.
const SHARED_PATTERNS = [
  new RegExp(`\\b(${NUM})\\s+(?:total\\s+)?(?:successful\\s+checks|successes)\\b`, 'i'),
  new RegExp(`\\bsucceed\\s+at\\s+(${NUM})\\s+of\\b`, 'i'),
  new RegExp(`\\bany\\s+combination\\s+of\\s+(${NUM})\\b`, 'i'),
];
function parseSharedSuccesses(text) {
  for (const sentence of text.split(/(?<=[.;])\s+/)) {
    if (!/\bany\s+combination\b/i.test(sentence)) continue;
    for (const re of SHARED_PATTERNS) {
      const m = re.exec(sentence);
      if (m) return toNum(m[1]);
    }
  }
  return null;
}

// Routine text opens with "(N actions; traits)", "(six actions)", "(two-actions)", "Routine (N actions)",
// "N Action:" or just a bare icon digit ("3 For each of its actions...").
function parseActionsPerTurn(text) {
  const patterns = [
    new RegExp(`^\\s*(?:routine\\s*)?\\(\\s*(${NUM})[\\s-]+actions?\\s*[);,]`, 'i'),
    /^\s*(\d)\s+actions?\s*:/i,
    /^\s*([1-9])\s+(?=[A-Za-z])/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return toNum(m[1]);
  }
  return null;
}

function parseComponent(routineText) {
  const each = /uses\s+(\d+|one|two|three|four|five|six)\s+of\s+the\s+[\w'’ ]*?actions/i.exec(
    routineText,
  );
  const noun =
    /every\s+disabled(?:\s+or\s+destroyed)?\s+(\w+)/i.exec(routineText) ??
    /each\s+(?:of\s+the\s+)?(\w+?)s?\s+uses/i.exec(routineText);
  if (!each || !noun) return null;
  return { name: noun[1].toLowerCase(), actionsEach: toNum(each[1]) ?? 0 };
}

export function draftPlan(source) {
  const name = source?.name ?? 'Hazard';
  const warnings = [];
  try {
    const details = source.system.details;
    const plan = basePlan(name);
    const routineText = stripHtml(details.routine);
    const rawDisable = String(details.disable ?? '');

    const apt = parseActionsPerTurn(routineText);
    if (details.isComplex) {
      if (apt) plan.actionsPerTurn = apt;
      // No routine text at all (the hazard only reacts): nothing to find, nothing to warn about.
      else if (routineText) warnings.push('actions-per-turn-missing');
    }

    const component = plan.components[0];
    const named = details.isComplex ? parseComponent(routineText) : null;
    if (named) {
      component.name = named.name;
      component.actionsEach = named.actionsEach;
      warnings.push('component-count-unknown');
    }

    const checks = parseInlineChecks(rawDisable);
    const successes = successesFor(rawDisable, checks);
    const ranks = ranksFor(rawDisable, checks);
    checks.forEach((c, i) => {
      const successesNeeded = successes.counts[i];
      if (successes.inferred[i] && !warnings.includes('successes-heuristic')) {
        warnings.push('successes-heuristic');
      }
      component.disables.push({
        id: `d${i + 1}`,
        skill: c.skill,
        dc: c.dc,
        label: c.label.replace(PROFICIENCY_RE, '').trim() || c.skill,
        traits: c.traits,
        successesNeeded,
        minRank: ranks[i],
      });
    });
    if (!checks.length) warnings.push('no-disables');
    else if (checks.length > 1) {
      component.sharedSuccesses = parseSharedSuccesses(stripHtml(rawDisable));
      if (component.sharedSuccesses != null) warnings.push('shared-successes');
    }

    component.counteract = parseCounteracts(rawDisable)[0] ?? null;

    const items = Array.isArray(source.items) ? source.items : [];
    const isReaction = (i) => i.type === 'action' && i.system?.actionType?.value === 'reaction';
    plan.reactionItemId = items.find(isReaction)?._id ?? null;
    const isPassive = (i) => i.type === 'action' && i.system?.actionType?.value === 'passive';
    plan.routineItemIds = items
      .filter((i) => (i.type === 'melee' || i.type === 'action') && !isReaction(i) && !isPassive(i))
      .map((i) => i._id);
    plan.resetText = stripHtml(details.reset);
    return { plan, warnings };
  } catch {
    return { plan: basePlan(name), warnings: [...warnings, 'parse-error'] };
  }
}
