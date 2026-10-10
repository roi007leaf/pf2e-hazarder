/**
 * Show the acting hazard's remaining actions next to its name in combat trackers (core sidebar,
 * its pop-out, and PF2e HUD's tracker), so the GM doesn't have to scroll back to the turn card.
 */
export function decorateCombatTracker(root, pool, onSpend = null) {
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
    if (target) target.append(buildPool(pool, onSpend));
  }
}

function buildPool({ remaining, spent }, onSpend) {
  const el = document.createElement('div');
  el.className = 'hz-ct-pool';
  el.dataset.tooltip = game.i18n.format('PF2E_HAZARDER.Turn.ActionsLeft', {
    left: Math.max(0, remaining - spent),
    total: remaining,
  });
  for (let i = 0; i < remaining; i++) {
    const pip = document.createElement('span');
    // PF2e's action font renders "1" as the one-action glyph.
    pip.className = i < spent ? 'action-glyph hz-ct-pip used' : 'action-glyph hz-ct-pip';
    pip.textContent = '1';
    pip.dataset.index = String(i);
    if (onSpend) {
      pip.classList.add('clickable');
      pip.addEventListener('click', (event) => {
        // Don't let the tracker treat this as selecting/panning to the combatant.
        event.preventDefault();
        event.stopPropagation();
        onSpend(i);
      });
    }
    el.append(pip);
  }
  return el;
}
