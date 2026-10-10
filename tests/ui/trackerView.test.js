import { buildTrackerView } from '../../scripts/ui/trackerView.js';
import { createInitialState } from '../../scripts/services/RulesEngine.js';

const plan = {
  components: [
    {
      id: 'c1',
      name: 'Rune',
      count: 2,
      actionsEach: 0,
      disables: [{ id: 'd1', skill: 'thievery', dc: 22, label: 'Erase', successesNeeded: 2 }],
      counteract: { spellUuid: 'u', name: 'Dispel Magic', rank: 4, dc: 22 },
    },
  ],
};

test('builds instances with pips', () => {
  const state = createInitialState(plan);
  state.status = 'active';
  state.instances[1].progress.d1 = 1;
  const v = buildTrackerView({ name: 'Wheel', plan, state, isGM: false });
  expect(v.empty).toBe(false);
  expect(v.statusLabel).toBe('PF2E_HAZARDER.Status.active');
  expect(v.components[0].counteract).toBe('PF2E_HAZARDER.Tracker.Counteract');
  expect(v.components[0].instances.map((i) => i.label)).toEqual(['Rune 1', 'Rune 2']);
  expect(v.components[0].instances[1].options[0]).toMatchObject({
    disableId: 'd1',
    have: 1,
    need: 2,
    skill: 'thievery',
    dc: 22,
  });
  expect(v.components[0].instances[1].options[0].pips).toEqual([
    { filled: true },
    { filled: false },
  ]);
});

test('single-instance components are labelled by name only', () => {
  const p = { components: [{ ...plan.components[0], count: 1 }] };
  const v = buildTrackerView({ name: 'W', plan: p, state: createInitialState(p), isGM: true });
  expect(v.components[0].instances[0].label).toBe('Rune');
});

test('no disables anywhere is empty and does not throw', () => {
  const p = {
    components: [{ id: 'c1', name: 'X', count: 1, actionsEach: 0, disables: [], counteract: null }],
  };
  const v = buildTrackerView({ name: 'X', plan: p, state: createInitialState(p), isGM: true });
  expect(v.empty).toBe(true);
  expect(v.components[0].instances[0].options).toEqual([]);
});

describe('display labels', () => {
  const single = (disables, extra = {}) => ({
    components: [
      { id: 'c1', name: 'Power of Faith', count: 1, actionsEach: 0, disables, counteract: null },
    ],
    ...extra,
  });
  const optionsOf = (p) =>
    buildTrackerView({ name: 'X', plan: p, state: createInitialState(p), isGM: true }).components[0]
      .instances[0].options;

  test('skill label is capitalised and lore slugs are humanised', () => {
    const [a, b] = optionsOf(
      single([
        { id: 'd1', skill: 'thievery', dc: 20, label: 'thievery', successesNeeded: 1 },
        { id: 'd2', skill: 'warfare-lore', dc: 20, label: 'warfare-lore', successesNeeded: 1 },
      ]),
    );
    expect(a.skillLabel).toBe('Thievery');
    expect(b.skillLabel).toBe('Warfare Lore');
  });

  test('skill label prefers the system skill config when present', () => {
    global.CONFIG = { PF2E: { skills: { thievery: { label: 'PF2E.Skill.Thievery' } } } };
    const [a] = optionsOf(
      single([{ id: 'd1', skill: 'thievery', dc: 20, label: 'x', successesNeeded: 1 }]),
    );
    expect(a.skillLabel).toBe('PF2E.Skill.Thievery');
    delete global.CONFIG;
  });

  test('extra label only when it differs from the skill', () => {
    const [same, cased, differs] = optionsOf(
      single([
        { id: 'd1', skill: 'diplomacy', dc: 27, label: 'diplomacy', successesNeeded: 1 },
        { id: 'd2', skill: 'religion', dc: 23, label: 'Religion', successesNeeded: 1 },
        { id: 'd3', skill: 'thievery', dc: 30, label: 'Erase Rune', successesNeeded: 1 },
      ]),
    );
    expect(same.extraLabel).toBeNull();
    expect(cased.extraLabel).toBeNull();
    expect(differs.extraLabel).toBe('Erase Rune');
  });

  test('component heading only with several components; instance label only with several instances', () => {
    const one = buildTrackerView({
      name: 'X',
      plan: single([]),
      state: createInitialState(single([])),
      isGM: true,
    });
    expect(one.components[0].showHeading).toBe(false);
    expect(one.components[0].instances[0].showLabel).toBe(false);
    const multi = {
      components: [plan.components[0], { ...plan.components[0], id: 'c2', count: 1 }],
    };
    const v = buildTrackerView({
      name: 'X',
      plan: multi,
      state: createInitialState(multi),
      isGM: true,
    });
    expect(v.components[0].showHeading).toBe(true);
    expect(v.components[0].instances[0].showLabel).toBe(true);
    expect(v.components[1].instances[0].showLabel).toBe(false);
  });

  test('action pool in the header for complex hazards, null for simple', () => {
    const p = {
      ...plan,
      actionsPerTurn: 4,
      components: [{ ...plan.components[0], actionsEach: 2 }],
    };
    const state = createInitialState(p);
    state.instances[0].disabled = true;
    const v = buildTrackerView({ name: 'X', plan: p, state, isGM: true });
    expect(v.actions).toEqual({
      remaining: 2,
      total: 4,
      pips: [{ spent: false }, { spent: false }, { spent: true }, { spent: true }],
    });
    expect(
      buildTrackerView({ name: 'X', plan, state: createInitialState(plan), isGM: true }).actions,
    ).toBeNull();
  });
});

test('dcText is omitted when the DC is unknown', () => {
  const formatSpy = jest.spyOn(game.i18n, 'format');
  const p = {
    components: [
      {
        ...plan.components[0],
        disables: [
          { id: 'd1', skill: 'thievery', dc: 22, label: 'A', successesNeeded: 1 },
          { id: 'd2', skill: 'arcana', dc: null, label: 'B', successesNeeded: 1 },
        ],
      },
    ],
  };
  const v = buildTrackerView({ name: 'W', plan: p, state: createInitialState(p), isGM: true });
  const [known, unknown] = v.components[0].instances[0].options;
  expect(known.dcText).toBe('PF2E_HAZARDER.Tracker.DC');
  expect(formatSpy).toHaveBeenCalledWith('PF2E_HAZARDER.Tracker.DC', { dc: 22 });
  expect(unknown.dcText).toBeNull();
  formatSpy.mockRestore();
});
