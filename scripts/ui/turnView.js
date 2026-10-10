import { actionsRemaining, disabledCount } from '../services/RulesEngine.js';

export function buildTurnView({ name, plan, state, routineHtml, items }) {
  const total = plan.actionsPerTurn ?? 0;
  const remaining = actionsRemaining(state, plan) ?? 0;
  const disabled = disabledCount(state);
  const byId = new Map(items.map((i) => [i.id, i]));
  const routine = (plan.routineItemIds ?? [])
    .map((id) => byId.get(id))
    .filter((i) => i && !i.passive);
  return {
    title: game.i18n.format('PF2E_HAZARDER.Turn.Title', { name }),
    total,
    remaining,
    pips: Array.from({ length: total }, (_, i) => ({ spent: i >= remaining })),
    disabledNote: disabled
      ? game.i18n.format('PF2E_HAZARDER.Turn.DisabledNote', { count: disabled })
      : null,
    routineHtml,
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
