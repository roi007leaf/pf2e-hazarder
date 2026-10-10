/** Spent count after clicking diamond `index`: spend up to it, or refund it if it was the last spent. */
export function nextSpent(current, index) {
  return current === index + 1 ? index : index + 1;
}

/**
 * Apply per-message turn-card state (spent actions, collapsed) to rendered HTML.
 * The state lives in message flags so the card content itself never has to be re-rendered.
 */
export function decorateTurnCard(root, { spent = 0, collapsed = false } = {}) {
  const card = root.querySelector('.hazarder-card.hz-turn');
  if (!card) return;
  card.classList.toggle('hz-collapsed', !!collapsed);
  const pool = card.querySelector('.hz-pool');
  if (!pool) return;
  const pips = pool.querySelectorAll('[data-hz-action="spend"]');
  pips.forEach((pip) => pip.classList.toggle('used', Number(pip.dataset.index) < (spent ?? 0)));
  const counter = pool.querySelector('.hz-used');
  if (counter) {
    counter.textContent = game.i18n.format('PF2E_HAZARDER.Turn.ActionsUsed', {
      used: Math.min(spent ?? 0, pips.length),
      total: pips.length,
    });
  }
}
