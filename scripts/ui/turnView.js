import { actionsRemaining, disabledCount } from '../services/RulesEngine.js';

export function buildTurnView({ name, plan, state, routineHtml, items }) {
  const total = plan.actionsPerTurn ?? 0;
  const remaining = actionsRemaining(state, plan) ?? 0;
  const disabled = disabledCount(state);
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    title: game.i18n.format('PF2E_HAZARDER.Turn.Title', { name }),
    total,
    remaining,
    pips: Array.from({ length: total }, (_, i) => ({ spent: i >= remaining })),
    disabledNote: disabled ? game.i18n.format('PF2E_HAZARDER.Turn.DisabledNote', { count: disabled }) : null,
    routineHtml,
    items: (plan.routineItemIds ?? []).map((id) => byId.get(id)).filter(Boolean),
  };
}
