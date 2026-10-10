import { buildTurnView } from '../../scripts/ui/turnView.js';
import { createInitialState } from '../../scripts/services/RulesEngine.js';

const plan = {
  actionsPerTurn: 9,
  components: [
    { id: 'c1', count: 3, actionsEach: 3, disables: [{ id: 'd1', successesNeeded: 1 }] },
  ],
  routineItemIds: ['m1', 'zz'],
};

test('pips reflect disabled instances', () => {
  const state = createInitialState(plan);
  state.instances[0].disabled = true;
  const v = buildTurnView({
    name: 'Mannequins',
    plan,
    state,
    routineHtml: '<p>r</p>',
    items: [{ id: 'm1', name: 'Fist' }],
  });
  expect(v.total).toBe(9);
  expect(v.remaining).toBe(6);
  expect(v.pips.filter((p) => p.spent)).toHaveLength(3);
  expect(v.disabledNote).toBe('PF2E_HAZARDER.Turn.DisabledNote');
  expect(v.items).toEqual([{ id: 'm1', name: 'Fist' }]);
});

test('null actions per turn gives no pips', () => {
  const v = buildTurnView({
    name: 'X',
    plan: { ...plan, actionsPerTurn: null },
    state: createInitialState(plan),
    routineHtml: '',
    items: [],
  });
  expect(v.pips).toEqual([]);
  expect(v.disabledNote).toBeNull();
});

test('strikes are split from actions and passives are dropped', () => {
  const p = { ...plan, routineItemIds: ['m1', 'p1', 'a1'] };
  const v = buildTurnView({
    name: 'Endless Struggle',
    plan: p,
    state: createInitialState(p),
    routineHtml: '',
    items: [
      {
        id: 'm1',
        name: 'Ghostly Attack',
        strike: { variants: ['+20', '+15', '+10'], hasDamage: true },
      },
      { id: 'p1', name: 'Void Healing', passive: true },
      { id: 'a1', name: 'Spectral Uprising' },
    ],
  });
  expect(v.strikes).toEqual([
    {
      id: 'm1',
      name: 'Ghostly Attack',
      variants: [
        { index: 0, label: '+20' },
        { index: 1, label: '+15' },
        { index: 2, label: '+10' },
      ],
      hasDamage: true,
    },
  ]);
  expect(v.items).toEqual([{ id: 'a1', name: 'Spectral Uprising' }]);
});
