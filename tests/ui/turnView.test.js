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
  expect(v.pips.filter((p) => p.lost)).toHaveLength(3);
  expect(v.pips[0]).toEqual({ index: 0, lost: false });
  expect(v.disabledNote).toBe('PF2E_HAZARDER.Turn.DisabledNote');
  expect(v.items.map((i) => i.name)).toEqual(['Fist']);
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
  expect(v.items.map((i) => i.id)).toEqual(['a1']);
});

test('traits, saves, outcomes and round', () => {
  const v = buildTurnView({
    name: 'Faith',
    plan,
    state: createInitialState(plan),
    routineHtml: '<p>intro</p>',
    outcomesHtml: '<p>outcomes</p>',
    traits: ['divine', 'void-energy'],
    saves: [{ statistic: 'will', dc: 25, basic: false, raw: '@Check[will|dc:25]' }],
    round: 3,
    items: [],
  });
  expect(v.traits).toEqual([
    { slug: 'divine', label: 'Divine' },
    { slug: 'void-energy', label: 'Void Energy' },
  ]);
  expect(v.saves).toEqual([{ raw: '@Check[will|dc:25]', label: 'Will', dc: 25, basic: false }]);
  expect(v.outcomesHtml).toBe('<p>outcomes</p>');
  expect(v.roundLabel).toBe('PF2E_HAZARDER.Turn.Round');
});

test('no round outside combat; defaults for missing extras', () => {
  const v = buildTurnView({
    name: 'X',
    plan,
    state: createInitialState(plan),
    routineHtml: '',
    items: [],
  });
  expect(v.roundLabel).toBeNull();
  expect(v.traits).toEqual([]);
  expect(v.saves).toEqual([]);
  expect(v.outcomesHtml).toBeNull();
});

test('actions carry description, cost and their own saves; empty routine opens them', () => {
  const p = { ...plan, routineItemIds: ['a1'] };
  const v = buildTurnView({
    name: 'Smoke-Filled Hallway',
    plan: p,
    state: createInitialState(p),
    routineHtml: '   ',
    items: [
      {
        id: 'a1',
        name: 'Choke',
        cost: 'free',
        descriptionHtml: '<p>Trigger …</p>',
        saves: [{ statistic: 'fortitude', dc: 18, basic: false, raw: '@Check[fortitude|dc:18]' }],
      },
    ],
  });
  expect(v.routineEmpty).toBe(true);
  expect(v.items).toEqual([
    {
      id: 'a1',
      name: 'Choke',
      cost: 'free',
      actionCost: 0,
      descriptionHtml: '<p>Trigger …</p>',
      open: true,
      saves: [{ index: 0, label: 'Fortitude', dc: 18, basic: false }],
    },
  ]);
});

test('actions stay folded when the routine has text', () => {
  const p = { ...plan, routineItemIds: ['a1'] };
  const v = buildTurnView({
    name: 'X',
    plan: p,
    state: createInitialState(p),
    routineHtml: '<p>It acts.</p>',
    items: [{ id: 'a1', name: 'Choke' }],
  });
  expect(v.routineEmpty).toBe(false);
  expect(v.items[0]).toEqual({
    id: 'a1',
    name: 'Choke',
    cost: null,
    actionCost: 0,
    descriptionHtml: null,
    open: false,
    saves: [],
  });
});
