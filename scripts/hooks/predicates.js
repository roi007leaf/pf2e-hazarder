import { getOrDraftPlan } from '../stores/hazardStore.js';

/** Ask the GM to review only when the parser flagged something; clean drafts are used as-is. */
export function shouldPromptForPlan(actor) {
  if (actor?.type !== 'hazard' || !actor.isComplex) return false;
  const { isDraft, warnings } = getOrDraftPlan(actor);
  return isDraft && warnings.length > 0;
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

const BUMP_WINDOW = 5;
const BUMPABLE = new Set(['active', 'triggered']);

/**
 * Should the disable tracker be re-posted at the bottom of the log? Only for hazards still in
 * play, and only when the tracker is missing or more than a few messages back.
 */
export function trackerNeedsBump({ messageIds, trackerId, status }) {
  if (!BUMPABLE.has(status)) return false;
  if (!trackerId) return true;
  return !messageIds.slice(-BUMP_WINDOW).includes(trackerId);
}
