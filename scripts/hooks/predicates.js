import { getPlan } from '../stores/hazardStore.js';

export function shouldPromptForPlan(actor) {
  if (actor?.type !== 'hazard' || !actor.isComplex) return false;
  const plan = getPlan(actor);
  return !plan || !plan.confirmed;
}

export function isHazardTurn(combat) {
  return combat?.combatant?.actor?.type === 'hazard';
}
