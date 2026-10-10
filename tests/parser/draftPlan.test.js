import { draftPlan } from '../../scripts/parser/draftPlan.js';

const hazard = (details, items = [], name = 'Test Hazard') => ({
  name,
  system: { details: { isComplex: true, routine: '', disable: '', reset: '', ...details } },
  items,
});

test('actions per turn from routine', () => {
  const { plan, warnings } = draftPlan(
    hazard({ routine: '<p>(2 actions) On its initiative…</p>' }),
  );
  expect(plan.actionsPerTurn).toBe(2);
  expect(warnings).not.toContain('actions-per-turn-missing');
});

test('missing actions count on complex hazard warns', () => {
  const { plan, warnings } = draftPlan(hazard({ routine: 'It attacks.' }));
  expect(plan.actionsPerTurn).toBeNull();
  expect(warnings).toContain('actions-per-turn-missing');
});

test('simple hazard has null actions and no actions warning', () => {
  const { plan, warnings } = draftPlan(
    hazard({ isComplex: false, disable: '@Check[thievery|dc:18]' }),
  );
  expect(plan.actionsPerTurn).toBeNull();
  expect(warnings).not.toContain('actions-per-turn-missing');
});

test('disables come from inline checks on one implicit component', () => {
  const { plan } = draftPlan(
    hazard({
      routine: '(1 action)',
      disable:
        '@Check[thievery|dc:26|name:Stop Wheel] (expert) or @Check[thievery|dc:22|name:Erase Rune] (master)',
    }),
  );
  expect(plan.components).toHaveLength(1);
  expect(plan.components[0]).toMatchObject({
    id: 'c1',
    name: 'Test Hazard',
    count: 1,
    actionsEach: 0,
  });
  expect(
    plan.components[0].disables.map((d) => [d.id, d.skill, d.dc, d.label, d.successesNeeded]),
  ).toEqual([
    ['d1', 'thievery', 26, 'Stop Wheel', 1],
    ['d2', 'thievery', 22, 'Erase Rune', 1],
  ]);
});

test('"twice" written right after a check is trusted: no warning', () => {
  const { plan, warnings } = draftPlan(
    hazard({
      routine: '(9 actions)',
      disable: '@Check[religion|dc:35]{Religion (expert)} twice to exorcise',
    }),
  );
  expect(plan.components[0].disables[0].successesNeeded).toBe(2);
  expect(warnings).not.toContain('successes-heuristic');
});

test('a count shared across alternatives is a guess and warns', () => {
  const { plan, warnings } = draftPlan(
    hazard({
      routine: '(1 action)',
      disable: '@Check[nature|dc:20] or @Check[occultism|dc:20] twice to disperse',
    }),
  );
  expect(plan.components[0].disables.map((d) => d.successesNeeded)).toEqual([2, 2]);
  expect(warnings).toContain('successes-heuristic');
});

test('no routine text at all: no actions warning', () => {
  const { plan, warnings } = draftPlan(hazard({ routine: '', disable: '@Check[survival|dc:18]' }));
  expect(plan.actionsPerTurn).toBeNull();
  expect(warnings).toEqual([]);
});

test('"twice" belonging to a later check does not leak backwards', () => {
  const { plan } = draftPlan(
    hazard({
      routine: '(1 action)',
      disable: '@Check[thievery|dc:37] to jam, or @Check[religion|dc:35] twice',
    }),
  );
  expect(plan.components[0].disables.map((d) => d.successesNeeded)).toEqual([1, 2]);
});

test('named component with per-instance actions', () => {
  const { plan, warnings } = draftPlan(
    hazard({
      routine:
        "(9 actions) Each of the mannequins uses three of the haunt's actions on each turn, and the haunt loses three actions each turn for every disabled or destroyed mannequin.",
      disable: '@Check[thievery|dc:37]',
    }),
  );
  expect(plan.components[0]).toMatchObject({ name: 'mannequin', actionsEach: 3, count: 1 });
  expect(warnings).toContain('component-count-unknown');
});

test('no inline checks warns no-disables', () => {
  const { plan, warnings } = draftPlan(hazard({ routine: '(1 action)', disable: 'Smash it.' }));
  expect(plan.components[0].disables).toEqual([]);
  expect(warnings).toContain('no-disables');
});

test('counteract attaches to the component', () => {
  const { plan } = draftPlan(
    hazard({
      routine: '(1 action)',
      disable:
        '@UUID[Compendium.pf2e.spells-srd.Item.abc]{Dispel Magic} (4th rank; counteract DC 22) to counteract each rune',
    }),
  );
  expect(plan.components[0].counteract).toEqual({
    spellUuid: 'Compendium.pf2e.spells-srd.Item.abc',
    name: 'Dispel Magic',
    rank: 4,
    dc: 22,
  });
});

test('reaction and routine items', () => {
  const { plan } = draftPlan(
    hazard({ routine: '(1 action)' }, [
      { _id: 'r1', type: 'action', name: 'Awaken', system: { actionType: { value: 'reaction' } } },
      { _id: 'm1', type: 'melee', name: 'Fist', system: { actionType: { value: null } } },
      { _id: 'a1', type: 'action', name: 'Submerge', system: { actionType: { value: 'free' } } },
    ]),
  );
  expect(plan.reactionItemId).toBe('r1');
  expect(plan.routineItemIds).toEqual(['m1', 'a1']);
});

test('passive abilities are not routine items', () => {
  const { plan } = draftPlan(
    hazard({ routine: '(3 actions)' }, [
      {
        _id: 'p1',
        type: 'action',
        name: 'Void Healing',
        system: { actionType: { value: 'passive' } },
      },
      { _id: 'm1', type: 'melee', name: 'Ghostly Attack', system: { actionType: { value: null } } },
    ]),
  );
  expect(plan.routineItemIds).toEqual(['m1']);
});

test('defaults and reset text', () => {
  const { plan } = draftPlan(
    hazard({ routine: '(1 action)', reset: '<p>Resets after 1 minute.</p>' }),
  );
  expect(plan).toMatchObject({
    version: 1,
    confirmed: false,
    resetText: 'Resets after 1 minute.',
    resetAfterSeconds: null,
  });
});

test('never throws on garbage', () => {
  const { plan, warnings } = draftPlan({ name: 'X', system: null, items: 'nope' });
  expect(plan.components).toHaveLength(1);
  expect(warnings).toContain('parse-error');
});

describe('actions-per-turn formats', () => {
  test.each([
    ['(1 action; mental, occult) The haunt…', 1],
    ['(2 actions; cold, mental) The haunt…', 2],
    ['(six actions) This trap loses 2 actions', 6],
    ['(two-actions) The fang leaps', 2],
    ['Routine (4 actions) The trap loses 1 action', 4],
    ['<p><strong>Routine</strong> (3 actions) The trap</p>', 3],
    ['1 Action: If there are no targets', 1],
    ['3 For each of its actions, the trap attempts', 3],
  ])('%s', (routine, expected) => {
    expect(draftPlan(hazard({ routine })).plan.actionsPerTurn).toBe(expected);
  });

  test('prose without a count stays null', () => {
    expect(
      draftPlan(hazard({ routine: 'On its turn, the fire spreads.' })).plan.actionsPerTurn,
    ).toBeNull();
  });
});

test('"actions per <thing>" is not a per-turn total', () => {
  const { plan, warnings } = draftPlan(
    hazard({ routine: '(2 actions per shadow tendril) Each tendril lashes out.' }),
  );
  expect(plan.actionsPerTurn).toBeNull();
  expect(warnings).toContain('actions-per-turn-missing');
});

test('"(1 action, illusion)" still parses', () => {
  expect(
    draftPlan(hazard({ routine: '(1 action, illusion, mental) It acts.' })).plan.actionsPerTurn,
  ).toBe(1);
});

describe('multiplier shared across alternatives', () => {
  const successes = (disable) =>
    draftPlan(hazard({ routine: '(1 action)', disable })).plan.components[0].disables.map(
      (d) => d.successesNeeded,
    );

  test('two alternatives, trailing twice', () => {
    expect(successes('@Check[nature|dc:20] or @Check[occultism|dc:20] twice to disperse')).toEqual([
      2, 2,
    ]);
  });

  test('four alternatives with proficiency parenthetical, four times', () => {
    expect(
      successes(
        '@Check[arcana|dc:25], @Check[nature|dc:25], @Check[occultism|dc:25], or @Check[religion|dc:25] (master) four times',
      ),
    ).toEqual([4, 4, 4, 4]);
  });

  test('separated by prose, no sharing', () => {
    expect(successes('@Check[thievery|dc:37] to jam, or @Check[religion|dc:35] twice')).toEqual([
      1, 2,
    ]);
  });
});
