import { decorateTurnCard, nextSpent } from '../../scripts/ui/turnCardDom.js';

describe('nextSpent', () => {
  test('clicking a diamond spends up to and including it', () => {
    expect(nextSpent(0, 0)).toBe(1);
    expect(nextSpent(1, 2)).toBe(3);
  });
  test('clicking the last spent diamond refunds it', () => {
    expect(nextSpent(3, 2)).toBe(2);
    expect(nextSpent(1, 0)).toBe(0);
  });
  test('clicking an earlier diamond rewinds to it', () => {
    expect(nextSpent(3, 0)).toBe(1);
  });
});

function card() {
  document.body.innerHTML = `
    <div class="hazarder-card hz-turn">
      <div class="hz-pool" data-remaining="3">
        <span class="hz-action-pip" data-hz-action="spend" data-index="0"></span>
        <span class="hz-action-pip" data-hz-action="spend" data-index="1"></span>
        <span class="hz-action-pip" data-hz-action="spend" data-index="2"></span>
        <span class="hz-action-pip lost"></span>
        <span class="hz-pool-note hz-used"></span>
      </div>
    </div>`;
  return document.body;
}

test('marks spent diamonds and writes the counter', () => {
  const root = card();
  decorateTurnCard(root, { spent: 2, collapsed: false });
  const used = [...root.querySelectorAll('.hz-action-pip.used')].map((p) => p.dataset.index);
  expect(used).toEqual(['0', '1']);
  expect(root.querySelector('.hz-used').textContent).toBe('PF2E_HAZARDER.Turn.ActionsUsed');
  expect(root.querySelector('.hazarder-card').classList.contains('hz-collapsed')).toBe(false);
});

test('collapsed flag folds the card; missing flags are harmless', () => {
  const root = card();
  decorateTurnCard(root, { spent: undefined, collapsed: true });
  expect(root.querySelector('.hazarder-card').classList.contains('hz-collapsed')).toBe(true);
  expect(root.querySelectorAll('.hz-action-pip.used')).toHaveLength(0);
});

test('no turn card is a no-op', () => {
  document.body.innerHTML = '<p>other</p>';
  expect(() => decorateTurnCard(document.body, { spent: 1, collapsed: true })).not.toThrow();
});

function cardWithButtons(spentPips) {
  document.body.innerHTML = `
    <div class="hazarder-card hz-turn">
      <div class="hz-pool">
        ${[0, 1, 2].map((i) => `<span class="hz-action-pip" data-hz-action="spend" data-index="${i}"></span>`).join('')}
        <span class="hz-used"></span>
      </div>
      <button class="atk" data-hz-action="strike" data-cost="1"></button>
      <button class="dmg" data-hz-action="strike-damage"></button>
      <button class="free" data-hz-action="item" data-cost="0"></button>
      <button class="two" data-hz-action="item" data-cost="2"></button>
    </div>`;
  decorateTurnCard(document.body, { spent: spentPips });
  return (sel) => document.querySelector(sel).disabled;
}

test('buttons that cost actions lock when none are left', () => {
  const disabled = cardWithButtons(3);
  expect(disabled('.atk')).toBe(true);
  expect(disabled('.two')).toBe(true);
  expect(disabled('.dmg')).toBe(false);
  expect(disabled('.free')).toBe(false);
});

test('a cost larger than what is left locks; affordable ones stay open', () => {
  const disabled = cardWithButtons(2);
  expect(disabled('.atk')).toBe(false);
  expect(disabled('.two')).toBe(true);
});
