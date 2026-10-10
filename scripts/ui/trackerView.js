import { instanceKey } from '../services/RulesEngine.js';

export function buildTrackerView({ name, plan, state, isGM }) {
  const components = plan.components.map((c) => {
    const instances = state.instances
      .filter((i) => i.componentId === c.id)
      .map((inst) => ({
        key: instanceKey(c.id, inst.index),
        label: c.count > 1 ? `${c.name} ${inst.index + 1}` : c.name,
        disabled: inst.disabled,
        options: c.disables.map((d) => {
          const have = inst.progress?.[d.id] ?? 0;
          const need = d.successesNeeded ?? 1;
          return {
            disableId: d.id,
            label: d.label,
            skill: d.skill,
            dc: d.dc,
            dcText:
              d.dc != null ? game.i18n.format('PF2E_HAZARDER.Tracker.DC', { dc: d.dc }) : null,
            have,
            need,
            pips: Array.from({ length: need }, (_, i) => ({ filled: i < have })),
          };
        }),
      }));
    const counteract = c.counteract
      ? game.i18n.format('PF2E_HAZARDER.Tracker.Counteract', {
          spell: c.counteract.name,
          rank: c.counteract.rank ?? '?',
          dc: c.counteract.dc ?? '?',
        })
      : null;
    return { name: c.name, counteract, counteractUuid: c.counteract?.spellUuid ?? null, instances };
  });
  return {
    title: game.i18n.format('PF2E_HAZARDER.Tracker.Title', { name }),
    status: state.status,
    statusLabel: game.i18n.localize(`PF2E_HAZARDER.Status.${state.status}`),
    empty: plan.components.every((c) => c.disables.length === 0),
    components,
    isGM,
  };
}
