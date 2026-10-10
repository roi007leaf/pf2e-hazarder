import {
  isHazardTurn,
  shouldPromptForPlan,
  shouldSkipTurn,
} from '../../scripts/hooks/predicates.js';

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

describe('shouldSkipTurn', () => {
  const base = { isDisabledHazard: true, allDisabled: false };
  test('skips forward in same round and into later rounds', () => {
    expect(
      shouldSkipTurn({ ...base, prior: { round: 1, turn: 0 }, current: { round: 1, turn: 1 } }),
    ).toBe(true);
    expect(
      shouldSkipTurn({ ...base, prior: { round: 1, turn: 3 }, current: { round: 2, turn: 0 } }),
    ).toBe(true);
  });
  test('never skips backward', () => {
    expect(
      shouldSkipTurn({ ...base, prior: { round: 1, turn: 2 }, current: { round: 1, turn: 1 } }),
    ).toBe(false);
    expect(
      shouldSkipTurn({ ...base, prior: { round: 2, turn: 0 }, current: { round: 1, turn: 3 } }),
    ).toBe(false);
  });
  test('does not skip when not a disabled hazard or everyone is disabled', () => {
    const p = { prior: { round: 1, turn: 0 }, current: { round: 1, turn: 1 } };
    expect(shouldSkipTurn({ ...p, isDisabledHazard: false, allDisabled: false })).toBe(false);
    expect(shouldSkipTurn({ ...p, isDisabledHazard: true, allDisabled: true })).toBe(false);
  });
});
