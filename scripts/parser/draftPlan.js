import { PLAN_VERSION } from '../constants.js';
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
  return { id: 'c1', name, count: 1, actionsEach: 0, disables: [], counteract: null };
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

// Alternatives joined only by connectors share the multiplier written after the last one.
function successesFor(rawDisable, checks) {
  const counts = checks.map((c, i) =>
    successesAfter(rawDisable, c, checks[i + 1]?.index ?? rawDisable.length),
  );
  for (let i = checks.length - 2; i >= 0; i--) {
    if (isConnectorOnly(rawDisable.slice(checks[i].end, checks[i + 1].index)))
      counts[i] = counts[i + 1];
  }
  return counts;
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
      else warnings.push('actions-per-turn-missing');
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
    checks.forEach((c, i) => {
      const successesNeeded = successes[i];
      if (successesNeeded > 1 && !warnings.includes('successes-heuristic')) {
        warnings.push('successes-heuristic');
      }
      component.disables.push({
        id: `d${i + 1}`,
        skill: c.skill,
        dc: c.dc,
        label: c.label,
        traits: c.traits,
        successesNeeded,
      });
    });
    if (!checks.length) warnings.push('no-disables');

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
