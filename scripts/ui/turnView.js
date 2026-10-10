import { actionsRemaining, disabledCount } from '../services/RulesEngine.js';

const humanise = (slug) =>
  String(slug)
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function traitLabel(slug) {
  const key = globalThis.CONFIG?.PF2E?.actionTraits?.[slug];
  return key ? game.i18n.localize(key) : humanise(slug);
}

function saveLabel(statistic) {
  const key = globalThis.CONFIG?.PF2E?.saves?.[statistic];
  return key ? game.i18n.localize(key) : humanise(statistic);
}

export function buildTurnView({
  name,
  plan,
  state,
  routineHtml,
  outcomesHtml = null,
  traits = [],
  saves = [],
  round = null,
  items,
}) {
  const total = plan.actionsPerTurn ?? 0;
  const remaining = actionsRemaining(state, plan) ?? 0;
  const disabled = disabledCount(state);
  const byId = new Map(items.map((i) => [i.id, i]));
  const routine = (plan.routineItemIds ?? [])
    .map((id) => byId.get(id))
    .filter((i) => i && !i.passive);
  return {
    title: game.i18n.format('PF2E_HAZARDER.Turn.Title', { name }),
    roundLabel: round != null ? game.i18n.format('PF2E_HAZARDER.Turn.Round', { round }) : null,
    total,
    remaining,
    // Actions lost to disabled components come last and can't be spent.
    pips: Array.from({ length: total }, (_, index) => ({ index, lost: index >= remaining })),
    disabledNote: disabled
      ? game.i18n.format('PF2E_HAZARDER.Turn.DisabledNote', { count: disabled })
      : null,
    traits: traits.map((slug) => ({ slug, label: traitLabel(slug) })),
    routineHtml,
    outcomesHtml,
    saves: saves.map((s) => ({
      raw: s.raw,
      label: saveLabel(s.statistic),
      dc: s.dc,
      basic: s.basic,
    })),
    strikes: routine
      .filter((i) => i.strike)
      .map((i) => ({
        id: i.id,
        name: i.name,
        variants: i.strike.variants.map((label, index) => ({ index, label })),
        hasDamage: i.strike.hasDamage,
      })),
    items: routine
      .filter((i) => !i.strike)
      .map(({ id, name: itemName }) => ({ id, name: itemName })),
  };
}
