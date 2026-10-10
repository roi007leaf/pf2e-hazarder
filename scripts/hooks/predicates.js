import { getPlan } from '../stores/hazardStore.js';

export function shouldPromptForPlan(actor) {
  if (actor?.type !== 'hazard' || !actor.isComplex) return false;
  const plan = getPlan(actor);
  return !plan || !plan.confirmed;
}

export function isHazardTurn(combat) {
  return combat?.combatant?.actor?.type === 'hazard';
}

export function shouldSkipTurn({ prior, current, isDisabledHazard, allDisabled }) {
  if (!isDisabledHazard || allDisabled) return false;
  if (current?.round == null || prior?.round == null) return false;
  if (current.round !== prior.round) return current.round > prior.round;
  return (current.turn ?? 0) > (prior.turn ?? 0);
}
