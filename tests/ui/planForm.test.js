import { formToPlan, planToContext, nextId, skillOptions } from '../../scripts/ui/planForm.js';

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
    {
      id: 'd1',
      skill: 'thievery',
      dc: 22,
      label: 'Erase',
      traits: ['t'],
      successesNeeded: 1,
      minRank: null,
    },
  ]);
});

test('formToPlan reads minRank; 0 means any rank, missing keeps the saved value', () => {
  const row = (d) => ({
    components: { 0: { id: 'c1', name: 'x', count: '1', actionsEach: '0', disables: { 0: d } } },
  });
  const d = { id: 'd1', skill: 'thievery', dc: '20', label: 'A', successesNeeded: '1' };
  expect(formToPlan(row({ ...d, minRank: '3' }), base).components[0].disables[0].minRank).toBe(3);
  expect(
    formToPlan(row({ ...d, minRank: '0' }), base).components[0].disables[0].minRank,
  ).toBeNull();
  const ranked = {
    ...base,
    components: [
      { ...base.components[0], disables: [{ ...base.components[0].disables[0], minRank: 2 }] },
    ],
  };
  expect(formToPlan(row(d), ranked).components[0].disables[0].minRank).toBe(2);
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

describe('routine items and counteract', () => {
  const withCounteract = {
    ...base,
    routineItemIds: ['old'],
    components: [
      {
        ...base.components[0],
        counteract: { spellUuid: 'Compendium.pf2e.spells.X', name: 'Dispel', rank: 3, dc: 20 },
      },
    ],
  };

  test('routineItemIds parsed from checkbox map, kept when absent', () => {
    const data = { routineItemIds: { a1: true, b2: false, c3: true }, components: {} };
    expect(formToPlan(data, base).routineItemIds).toEqual(['a1', 'c3']);
    expect(formToPlan({ components: {} }, withCounteract).routineItemIds).toEqual(['old']);
    expect(formToPlan({ routineItemIds: ['x', ''], components: {} }, base).routineItemIds).toEqual([
      'x',
    ]);
  });

  test('counteract fields parsed, spellUuid kept, blank name clears', () => {
    const row = (counteract) => ({ components: { 0: { id: 'c1', name: 'x', counteract } } });
    expect(
      formToPlan(row({ name: ' Dispel Magic ', rank: '4', dc: '' }), withCounteract).components[0]
        .counteract,
    ).toEqual({ spellUuid: 'Compendium.pf2e.spells.X', name: 'Dispel Magic', rank: 4, dc: null });
    expect(
      formToPlan(row({ name: '', rank: '4', dc: '22' }), withCounteract).components[0].counteract,
    ).toBeNull();
    expect(
      formToPlan(row({ name: 'Cleanse', rank: '2', dc: '18' }), base).components[0].counteract,
    ).toEqual({ spellUuid: null, name: 'Cleanse', rank: 2, dc: 18 });
    expect(formToPlan(row(undefined), withCounteract).components[0].counteract).toEqual(
      withCounteract.components[0].counteract,
    );
  });
});

test('planToContext marks routine items as checked', () => {
  const actor = {
    items: [
      { id: 'r1', name: 'Awaken', type: 'action' },
      { id: 'm1', name: 'Slam', type: 'melee' },
    ],
  };
  const ctx = planToContext({ ...base, reactionItemId: 'r1', routineItemIds: ['m1'] }, [], actor);
  expect(ctx.routineItems).toEqual([{ id: 'm1', name: 'Slam', checked: true }]);
});

describe('skillOptions', () => {
  afterEach(() => delete global.CONFIG);

  test('lists system skills plus perception, sorted by label', () => {
    global.CONFIG = {
      PF2E: {
        skills: {
          thievery: { label: 'PF2E.Skill.Thievery' },
          arcana: { label: 'PF2E.Skill.Arcana' },
        },
      },
    };
    // The test i18n mock returns keys, so labels sort by key here.
    expect(skillOptions()).toEqual([
      { slug: 'perception', label: 'PF2E.PerceptionLabel' },
      { slug: 'arcana', label: 'PF2E.Skill.Arcana' },
      { slug: 'thievery', label: 'PF2E.Skill.Thievery' },
    ]);
  });

  test('falls back to the core PF2e skills without CONFIG', () => {
    const slugs = skillOptions().map((s) => s.slug);
    expect(slugs).toContain('thievery');
    expect(slugs).toContain('religion');
    expect(slugs).toHaveLength(17);
  });
});

test('formToPlan reads sharedSuccesses; blank turns it off, missing keeps it', () => {
  const row = (extra) => ({
    components: { 0: { id: 'c1', name: 'x', count: '1', actionsEach: '0', ...extra } },
  });
  expect(formToPlan(row({ sharedSuccesses: '3' }), base).components[0].sharedSuccesses).toBe(3);
  expect(formToPlan(row({ sharedSuccesses: '' }), base).components[0].sharedSuccesses).toBeNull();
  const withShared = { ...base, components: [{ ...base.components[0], sharedSuccesses: 4 }] };
  expect(formToPlan(row({}), withShared).components[0].sharedSuccesses).toBe(4);
});
