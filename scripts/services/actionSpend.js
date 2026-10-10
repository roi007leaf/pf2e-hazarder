/**
 * How many of a hazard's actions a chat message represents, so the turn card can count
 * spent actions automatically. Pure: callers extract the fields from the message.
 */
export function actionCost({ contextType, originType, actionType, actions, hazarderCost } = {}) {
  if (hazarderCost != null) return hazarderCost;
  if (contextType === 'attack-roll') return 1;
  if (originType === 'action' && actionType === 'action') return actions ?? 1;
  return 0;
}

/**
 * Cost of posting a save from the turn card. A routine save is one action per target
 * (e.g. "uses its 3 actions to target up to three creatures"); a save that belongs to an
 * action is free here because posting or using that action is counted on its own.
 */
export function saveRequestCost({ fromItem, targets }) {
  if (fromItem) return 0;
  return Math.max(1, targets);
}
