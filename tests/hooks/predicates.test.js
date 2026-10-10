import { isHazardTurn, shouldPromptForPlan } from '../../scripts/hooks/predicates.js';

const actor = (flags, isComplex = true) => ({
  type: 'hazard',
  isComplex,
  getFlag: (s, k) => flags[k],
});

test('prompt only for complex hazards without confirmed plan', () => {
  expect(shouldPromptForPlan(actor({}))).toBe(true);
  expect(shouldPromptForPlan(actor({ plan: { version: 1, confirmed: false } }))).toBe(true);
  expect(shouldPromptForPlan(actor({ plan: { version: 1, confirmed: true } }))).toBe(false);
  expect(shouldPromptForPlan(actor({}, false))).toBe(false);
  expect(shouldPromptForPlan({ type: 'npc', getFlag: () => null })).toBe(false);
});

test('isHazardTurn', () => {
  expect(isHazardTurn({ combatant: { actor: { type: 'hazard' } } })).toBe(true);
  expect(isHazardTurn({ combatant: { actor: { type: 'npc' } } })).toBe(false);
  expect(isHazardTurn({ combatant: null })).toBe(false);
});
