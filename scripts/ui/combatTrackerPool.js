/**
 * Show the acting hazard's remaining actions next to its name in combat trackers (core sidebar,
 * its pop-out, and PF2e HUD's tracker), so the GM doesn't have to scroll back to the turn card.
 */
export function decorateCombatTracker(root, pool) {
  root.querySelectorAll('.hz-ct-pool').forEach((el) => el.remove());
  if (!pool) return;
  for (const row of root.querySelectorAll(
    `li.combatant[data-combatant-id="${pool.combatantId}"]`,
  )) {
    // PF2e HUD rows: .details (name + controls); core rows: .token-name. Own line under both.
    const target =
      row.querySelector('.details') ??
      row.querySelector('.token-name') ??
      row.querySelector('.name');
    if (target) target.append(buildPool(pool));
  }
}

function buildPool({ remaining, spent }) {
  const el = document.createElement('div');
  el.className = 'hz-ct-pool';
  el.dataset.tooltip = game.i18n.format('PF2E_HAZARDER.Turn.ActionsUsed', {
    used: Math.min(spent, remaining),
    total: remaining,
  });
  for (let i = 0; i < remaining; i++) {
    const pip = document.createElement('span');
    pip.className = i < spent ? 'hz-ct-pip used' : 'hz-ct-pip';
    el.append(pip);
  }
  return el;
}
