import { buildTurnView } from '../../scripts/ui/turnView.js';
import { createInitialState } from '../../scripts/services/RulesEngine.js';

const plan = {
  actionsPerTurn: 9,
  components: [{ id: 'c1', count: 3, actionsEach: 3, disables: [{ id: 'd1', successesNeeded: 1 }] }],
  routineItemIds: ['m1', 'zz'],
};

test('pips reflect disabled instances', () => {
  const state = createInitialState(plan);
  state.instances[0].disabled = true;
  const v = buildTurnView({ name: 'Mannequins', plan, state, routineHtml: '<p>r</p>', items: [{ id: 'm1', name: 'Fist' }] });
  expect(v.total).toBe(9);
  expect(v.remaining).toBe(6);
  expect(v.pips.filter((p) => p.spent)).toHaveLength(3);
  expect(v.disabledNote).toBe('PF2E_HAZARDER.Turn.DisabledNote');
  expect(v.items).toEqual([{ id: 'm1', name: 'Fist' }]);
});

test('null actions per turn gives no pips', () => {
  const v = buildTurnView({ name: 'X', plan: { ...plan, actionsPerTurn: null }, state: createInitialState(plan), routineHtml: '', items: [] });
  expect(v.pips).toEqual([]);
  expect(v.disabledNote).toBeNull();
});
