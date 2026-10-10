import {
  isHazardTurn,
  shouldPromptForPlan,
  shouldSkipTurn,
  trackerNeedsBump,
} from '../../scripts/hooks/predicates.js';

const actor = (flags, isComplex = true, details = {}) => ({
  type: 'hazard',
  isComplex,
  isToken: false,
  getFlag: (s, k) => flags[k],
  toObject: () => ({
    name: 'H',
    system: {
      details: {
        isComplex,
        routine: '(1 action) It acts.',
        disable: '@Check[thievery|dc:20]',
        reset: '',
        ...details,
      },
    },
    items: [],
  }),
});

test('a clean draft is used without asking', () => {
  expect(shouldPromptForPlan(actor({}))).toBe(false);
});

test('a draft with parser warnings asks the GM', () => {
  expect(shouldPromptForPlan(actor({}, true, { routine: 'It acts somehow.' }))).toBe(true);
  expect(shouldPromptForPlan(actor({}, true, { disable: 'Smash it.' }))).toBe(true);
});

test('never asks for confirmed plans, simple hazards or non-hazards', () => {
  expect(shouldPromptForPlan(actor({ plan: { version: 1, confirmed: true } }))).toBe(false);
  expect(shouldPromptForPlan(actor({}, false, { disable: 'Smash it.' }))).toBe(false);
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

describe('trackerNeedsBump', () => {
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
  test('no bump while the tracker is among the last few messages', () => {
    expect(trackerNeedsBump({ messageIds: ids, trackerId: 'm6', status: 'active' })).toBe(false);
    expect(trackerNeedsBump({ messageIds: ids, trackerId: 'm3', status: 'active' })).toBe(false);
  });
  test('bump once it has scrolled further back, or is missing', () => {
    expect(trackerNeedsBump({ messageIds: ids, trackerId: 'm2', status: 'active' })).toBe(true);
    expect(trackerNeedsBump({ messageIds: ids, trackerId: null, status: 'active' })).toBe(true);
    expect(trackerNeedsBump({ messageIds: ids, trackerId: 'gone', status: 'triggered' })).toBe(
      true,
    );
  });
  test('never bump a disabled, armed or unstarted hazard', () => {
    expect(trackerNeedsBump({ messageIds: ids, trackerId: 'm1', status: 'disabled' })).toBe(false);
    expect(trackerNeedsBump({ messageIds: ids, trackerId: 'm1', status: 'armed' })).toBe(false);
    expect(trackerNeedsBump({ messageIds: ids, trackerId: 'm1', status: undefined })).toBe(false);
  });
});
