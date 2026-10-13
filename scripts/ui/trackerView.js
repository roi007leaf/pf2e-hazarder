import { RANKS } from '../constants.js';
import { actionsRemaining, instanceKey, optionCap, sharedNeed } from '../services/RulesEngine.js';

const humanise = (slug) =>
  String(slug)
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function skillLabel(skill) {
  const configured = globalThis.CONFIG?.PF2E?.skills?.[skill]?.label;
  return configured ? game.i18n.localize(configured) : humanise(skill);
}

function extraLabel(label, skill, shownSkill) {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  return l === skill.toLowerCase() || l === shownSkill.toLowerCase() ? null : label;
}

function buildActions(state, plan) {
  if (plan.actionsPerTurn == null) return null;
  const total = plan.actionsPerTurn;
  const remaining = actionsRemaining(state, plan);
  return {
    remaining,
    total,
    pips: Array.from({ length: total }, (_, i) => ({ spent: i >= remaining })),
  };
}

function sharedView(progress, need) {
  const have = Math.min(
    need,
    Object.values(progress ?? {}).reduce((a, n) => a + (n ?? 0), 0),
  );
  return {
    have,
    need,
    text: game.i18n.format('PF2E_HAZARDER.Tracker.AnyCombination', { have, need }),
  };
}

export function buildTrackerView({ name, plan, state, isGM }) {
  const components = plan.components.map((c) => {
    const shared = sharedNeed(c);
    const instances = state.instances
      .filter((i) => i.componentId === c.id)
      .map((inst) => ({
        key: instanceKey(c.id, inst.index),
        label: c.count > 1 ? `${c.name} ${inst.index + 1}` : c.name,
        showLabel: c.count > 1,
        disabled: inst.disabled,
        shared: shared != null ? sharedView(inst.progress, shared) : null,
        options: c.disables.map((d) => {
          const have = inst.progress?.[d.id] ?? 0;
          // Shared pool: this option's own successes plus the slots still open to any option.
          const need =
            shared != null ? optionCap(c, inst.progress, d.id) : (d.successesNeeded ?? 1);
          const shownSkill = skillLabel(d.skill);
          return {
            disableId: d.id,
            label: d.label,
            skill: d.skill,
            skillLabel: shownSkill,
            extraLabel: extraLabel(d.label, d.skill, shownSkill),
            dc: d.dc,
            dcText:
              d.dc != null ? game.i18n.format('PF2E_HAZARDER.Tracker.DC', { dc: d.dc }) : null,
            rankText: d.minRank
              ? game.i18n.localize(`PF2E_HAZARDER.Rank.${RANKS[d.minRank]}`)
              : null,
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
    return {
      name: c.name,
      showHeading: plan.components.length > 1,
      counteract,
      counteractUuid: c.counteract?.spellUuid ?? null,
      instances,
    };
  });
  return {
    title: game.i18n.format('PF2E_HAZARDER.Tracker.Title', { name }),
    name,
    status: state.status,
    statusLabel: game.i18n.localize(`PF2E_HAZARDER.Status.${state.status}`),
    actions: buildActions(state, plan),
    empty: plan.components.every((c) => c.disables.length === 0),
    components,
    isGM,
  };
}
