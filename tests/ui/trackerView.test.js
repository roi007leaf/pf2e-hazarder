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
  expect(v.components[0].instances[1].options[0]).toMatchObject({ disableId: 'd1', have: 1, need: 2, skill: 'thievery', dc: 22 });
  expect(v.components[0].instances[1].options[0].pips).toEqual([{ filled: true }, { filled: false }]);
});

test('single-instance components are labelled by name only', () => {
  const p = { components: [{ ...plan.components[0], count: 1 }] };
  const v = buildTrackerView({ name: 'W', plan: p, state: createInitialState(p), isGM: true });
  expect(v.components[0].instances[0].label).toBe('Rune');
});

test('no disables anywhere is empty and does not throw', () => {
  const p = { components: [{ id: 'c1', name: 'X', count: 1, actionsEach: 0, disables: [], counteract: null }] };
  const v = buildTrackerView({ name: 'X', plan: p, state: createInitialState(p), isGM: true });
  expect(v.empty).toBe(true);
  expect(v.components[0].instances[0].options).toEqual([]);
});
