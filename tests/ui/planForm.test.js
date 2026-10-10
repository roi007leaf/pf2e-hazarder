import { formToPlan, planToContext, nextId } from '../../scripts/ui/planForm.js';

const base = {
  version: 1,
  confirmed: false,
  actionsPerTurn: 9,
  components: [
    {
      id: 'c1',
      name: 'x',
      count: 1,
      actionsEach: 0,
      disables: [
        { id: 'd1', skill: 'thievery', dc: 20, label: 'A', traits: ['t'], successesNeeded: 1 },
      ],
      counteract: null,
    },
  ],
  reactionItemId: null,
  routineItemIds: [],
  resetText: '',
  resetAfterSeconds: null,
};

test('formToPlan parses numbers and confirms', () => {
  const data = {
    actionsPerTurn: '6',
    reactionItemId: 'r1',
    components: {
      0: {
        id: 'c1',
        name: 'Rune',
        count: '4',
        actionsEach: '0',
        disables: {
          0: { id: 'd1', skill: 'thievery', dc: '22', label: 'Erase', successesNeeded: '1' },
          1: { skill: '', dc: '', label: '', successesNeeded: '' },
        },
      },
    },
  };
  const plan = formToPlan(data, base);
  expect(plan.confirmed).toBe(true);
  expect(plan.actionsPerTurn).toBe(6);
  expect(plan.reactionItemId).toBe('r1');
  expect(plan.components[0]).toMatchObject({ id: 'c1', name: 'Rune', count: 4, actionsEach: 0 });
  expect(plan.components[0].disables).toEqual([
    { id: 'd1', skill: 'thievery', dc: 22, label: 'Erase', traits: ['t'], successesNeeded: 1 },
  ]);
});

test('formToPlan assigns ids, clamps count and blank actions → null', () => {
  const data = {
    actionsPerTurn: '',
    components: {
      0: {
        name: 'A',
        count: '0',
        actionsEach: '',
        disables: { 0: { skill: 'religion', dc: '30', label: '', successesNeeded: '2' } },
      },
    },
  };
  const plan = formToPlan(data, base);
  expect(plan.actionsPerTurn).toBeNull();
  expect(plan.components[0]).toMatchObject({ id: 'c1', count: 1, actionsEach: 0 });
  expect(plan.components[0].disables[0]).toMatchObject({
    id: 'd1',
    skill: 'religion',
    dc: 30,
    label: 'religion',
    successesNeeded: 2,
    traits: [],
  });
  expect(plan.components[0].counteract).toBeNull();
});

test('formToPlan keepBlank retains blank-skill disables', () => {
  const data = {
    components: {
      0: {
        id: 'c1',
        name: 'Rune',
        disables: {
          0: { id: 'd1', skill: 'thievery', dc: '20' },
          1: { id: 'd2', skill: '', dc: '', label: '', successesNeeded: '' },
        },
      },
    },
  };
  const plan = formToPlan(data, base, { keepBlank: true });
  expect(plan.components[0].disables).toHaveLength(2);
  expect(plan.components[0].disables[1]).toMatchObject({
    id: 'd2',
    skill: '',
    dc: null,
    successesNeeded: 1,
  });
  expect(formToPlan(data, base).components[0].disables).toHaveLength(1);
});

test('planToContext lists warnings and items', () => {
  const actor = {
    items: [
      { id: 'r1', name: 'Awaken', type: 'action' },
      { id: 'f', name: 'Feat', type: 'feat' },
    ],
  };
  const ctx = planToContext(base, ['no-disables'], actor);
  expect(ctx.warnings).toEqual(['PF2E_HAZARDER.Warnings.no-disables']);
  expect(ctx.items).toEqual([{ id: 'r1', name: 'Awaken' }]);
  expect(ctx.plan).toBe(base);
});

test('nextId uses max numeric suffix + 1', () => {
  expect(nextId('d', [])).toBe('d1');
  expect(nextId('d', [{ id: 'd1' }, { id: 'd3' }])).toBe('d4');
  expect(nextId('c', [{ id: 'c2' }, { id: 'x' }, {}])).toBe('c3');
});

test('formToPlan blank component name: previous name, id on submit, empty when keepBlank', () => {
  const data = { components: { 0: { id: 'c1', name: '' }, 1: { id: 'c2', name: '' } } };
  const submit = formToPlan(data, base);
  expect(submit.components[0].name).toBe('x');
  expect(submit.components[1].name).toBe('c2');
  const fold = formToPlan(data, base, { keepBlank: true });
  expect(fold.components[0].name).toBe('x');
  expect(fold.components[1].name).toBe('');
});

test('formToPlan assigns non-colliding ids for rows lacking ids', () => {
  const data = {
    components: {
      0: { id: 'c3', name: 'A', disables: { 0: { id: 'd3', skill: 'a' }, 1: { skill: 'b' } } },
      1: { name: 'B' },
    },
  };
  const plan = formToPlan(data, base);
  expect(plan.components.map((c) => c.id)).toEqual(['c3', 'c4']);
  expect(plan.components[0].disables.map((d) => d.id)).toEqual(['d3', 'd4']);
});
