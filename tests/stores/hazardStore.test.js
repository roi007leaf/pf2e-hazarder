import {
  baseActor,
  getOrCreateState,
  getOrDraftPlan,
  getPlan,
  getState,
  getTrackerMessageId,
  setPlan,
  setState,
  setTrackerMessageId,
} from '../../scripts/stores/hazardStore.js';

function doc(flags = {}, source = {}) {
  return {
    flags: { 'pf2e-hazarder': { ...flags } },
    getFlag(scope, key) {
      return this.flags[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.flags[scope][key] = value;
    },
    toObject: () => source,
  };
}

const plan = {
  version: 1,
  confirmed: true,
  actionsPerTurn: 1,
  components: [{ id: 'c1', count: 2, actionsEach: 0, disables: [{ id: 'd1' }] }],
};

test('plan round-trip copies data', async () => {
  const a = doc();
  await setPlan(a, plan);
  expect(getPlan(a)).toEqual(plan);
  expect(getPlan(a)).not.toBe(plan);
});

test('unknown plan version is ignored', () => {
  expect(getPlan(doc({ plan: { ...plan, version: 99 } }))).toBeNull();
});

test('getOrDraftPlan drafts when missing', () => {
  const a = doc(
    {},
    {
      name: 'Pit',
      system: {
        details: { isComplex: false, routine: '', disable: '@Check[thievery|dc:18]', reset: '' },
      },
      items: [],
    },
  );
  const res = getOrDraftPlan(a);
  expect(res.isDraft).toBe(true);
  expect(res.plan.components[0].disables[0].dc).toBe(18);
});

test('getOrDraftPlan returns stored confirmed plan', () => {
  const res = getOrDraftPlan(doc({ plan }));
  expect(res).toEqual({ plan, warnings: [], isDraft: false });
});

test('state is created and synced to plan', async () => {
  const t = doc();
  const s = getOrCreateState(t, plan);
  expect(s.instances).toHaveLength(2);
  await setState(t, s);
  expect(getState(t)).toEqual(s);
  const grown = getOrCreateState(t, { ...plan, components: [{ ...plan.components[0], count: 3 }] });
  expect(grown.instances).toHaveLength(3);
});

test('tracker message id', async () => {
  const t = doc();
  expect(getTrackerMessageId(t)).toBeNull();
  await setTrackerMessageId(t, 'msg1');
  expect(getTrackerMessageId(t)).toBe('msg1');
});

describe('base actor resolution for unlinked tokens', () => {
  afterEach(() => {
    delete game.actors;
  });

  function synthetic(base, flags = {}) {
    return { ...doc(flags, { name: 'token copy' }), id: base.id, isToken: true };
  }

  test('baseActor returns the world actor for a synthetic token actor', () => {
    const base = { ...doc(), id: 'A1' };
    game.actors = new Map([['A1', base]]);
    expect(baseActor(synthetic(base))).toBe(base);
    expect(baseActor(base)).toBe(base);
    expect(baseActor(null)).toBeNull();
  });

  test('baseActor falls back to the token actor when no base actor exists', () => {
    game.actors = new Map();
    const tokenActor = { ...doc(), id: 'gone', isToken: true };
    expect(baseActor(tokenActor)).toBe(tokenActor);
  });

  test('setPlan/getPlan via a synthetic actor go through the base actor', async () => {
    const base = { ...doc(), id: 'A1' };
    game.actors = new Map([['A1', base]]);
    const tokenA = synthetic(base);
    const tokenB = synthetic(base);
    await setPlan(tokenA, plan);
    expect(base.flags['pf2e-hazarder'].plan).toEqual(plan);
    expect(tokenA.flags['pf2e-hazarder'].plan).toBeUndefined();
    expect(getPlan(tokenB)).toEqual(plan);
    expect(getOrDraftPlan(tokenB)).toEqual({ plan, warnings: [], isDraft: false });
  });

  test('getOrDraftPlan drafts from the base actor data', () => {
    const base = {
      ...doc(
        {},
        {
          name: 'Pit',
          system: {
            details: {
              isComplex: false,
              routine: '',
              disable: '@Check[thievery|dc:18]',
              reset: '',
            },
          },
          items: [],
        },
      ),
      id: 'A1',
    };
    game.actors = new Map([['A1', base]]);
    const res = getOrDraftPlan(synthetic(base));
    expect(res.plan.components[0].disables[0].dc).toBe(18);
  });
});
