import { decorateCombatTracker } from '../../scripts/ui/combatTrackerPool.js';

test('adds remaining-action diamonds to the acting hazard row only', () => {
  document.body.innerHTML = `
    <ol>
      <li class="combatant" data-combatant-id="a"><div class="token-name"><strong class="name">Ezren</strong></div></li>
      <li class="combatant" data-combatant-id="h"><div class="token-name"><strong class="name">Endless Struggle</strong></div></li>
    </ol>`;
  decorateCombatTracker(document.body, { combatantId: 'h', remaining: 3, spent: 2 });
  const pool = document.querySelector('[data-combatant-id="h"] .hz-ct-pool');
  expect(pool.querySelectorAll('.hz-ct-pip')).toHaveLength(3);
  expect(pool.querySelectorAll('.hz-ct-pip.used')).toHaveLength(2);
  expect(pool.dataset.tooltip).toBe('PF2E_HAZARDER.Turn.ActionsUsed');
  expect(document.querySelector('[data-combatant-id="a"] .hz-ct-pool')).toBeNull();
});

test('re-decorating replaces the previous diamonds; nothing to show is a no-op', () => {
  document.body.innerHTML = `<li class="combatant" data-combatant-id="h"><div class="token-name"></div></li>`;
  decorateCombatTracker(document.body, { combatantId: 'h', remaining: 2, spent: 0 });
  decorateCombatTracker(document.body, { combatantId: 'h', remaining: 2, spent: 1 });
  expect(document.querySelectorAll('.hz-ct-pool')).toHaveLength(1);
  expect(() => decorateCombatTracker(document.body, null)).not.toThrow();
  expect(() =>
    decorateCombatTracker(document.body, { combatantId: 'x', remaining: 2, spent: 0 }),
  ).not.toThrow();
});

test('decorates every tracker on the page, including PF2e HUD rows (.name)', () => {
  document.body.innerHTML = `
    <section id="combat"><li class="combatant" data-combatant-id="h"><div class="token-name"><strong class="name">H</strong></div></li></section>
    <section id="pf2e-hud-tracker"><li class="combatant" data-combatant-id="h"><div class="name">H</div></li></section>`;
  decorateCombatTracker(document.body, { combatantId: 'h', remaining: 2, spent: 1 });
  expect(document.querySelectorAll('#combat .token-name > .hz-ct-pool')).toHaveLength(1);
  expect(document.querySelectorAll('#pf2e-hud-tracker .name > .hz-ct-pool')).toHaveLength(1);
});
