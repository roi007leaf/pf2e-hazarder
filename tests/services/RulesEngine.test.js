import {
  actionsRemaining,
  activate,
  applyResult,
  createInitialState,
  disabledCount,
  instanceKey,
  override,
  reset,
  syncStateToPlan,
  undo,
} from '../../scripts/services/RulesEngine.js';
import { DEGREE } from '../../scripts/constants.js';

const plan = {
  actionsPerTurn: 9,
  components: [
    {
      id: 'c1',
      name: 'mannequin',
      count: 3,
      actionsEach: 3,
      disables: [
        { id: 'd1', skill: 'thievery', dc: 37, successesNeeded: 1 },
        { id: 'd2', skill: 'religion', dc: 35, successesNeeded: 2 },
      ],
    },
  ],
};
const r = (over = {}) => ({
  instanceKey: 'c1:0',
  disableId: 'd2',
  degree: DEGREE.SUCCESS,
  actorUuid: 'Actor.a',
  messageId: 'm1',
  userId: 'u1',
  isReroll: false,
  at: 1,
  ...over,
});

test('initial state', () => {
  const s = createInitialState(plan);
  expect(s.status).toBe('armed');
  expect(s.instances).toHaveLength(3);
  expect(s.instances[0]).toEqual({
    componentId: 'c1',
    index: 0,
    progress: { d1: 0, d2: 0 },
    disabled: false,
  });
  expect(instanceKey('c1', 2)).toBe('c1:2');
});

test('success adds one, crit success adds two and disables', () => {
  let s = activate(createInitialState(plan));
  ({ state: s } = applyResult(s, plan, r()));
  expect(s.instances[0].progress.d2).toBe(1);
  expect(s.instances[0].disabled).toBe(false);
  const res = applyResult(s, plan, r({ degree: DEGREE.CRIT_SUCCESS, messageId: 'm2' }));
  expect(res.state.instances[0].progress.d2).toBe(2);
  expect(res.state.instances[0].disabled).toBe(true);
  expect(res.events.map((e) => e.type)).toContain('instanceDisabled');
});

test('clamps progress at successesNeeded', () => {
  const { state } = applyResult(
    createInitialState(plan),
    plan,
    r({ disableId: 'd1', degree: DEGREE.CRIT_SUCCESS }),
  );
  expect(state.instances[0].progress.d1).toBe(1);
});

test('failure adds no progress', () => {
  const { state, events } = applyResult(createInitialState(plan), plan, r({ degree: DEGREE.FAIL }));
  expect(state.instances[0].progress.d2).toBe(0);
  expect(events.map((e) => e.type)).toEqual(['progress']);
});

test('crit failure triggers an armed hazard', () => {
  const { state, events } = applyResult(
    createInitialState(plan),
    plan,
    r({ degree: DEGREE.CRIT_FAIL }),
  );
  expect(state.status).toBe('triggered');
  expect(events.map((e) => e.type)).toContain('hazardTriggered');
});

test('crit failure on an active hazard keeps it active but emits trigger', () => {
  const { state, events } = applyResult(
    activate(createInitialState(plan)),
    plan,
    r({ degree: DEGREE.CRIT_FAIL }),
  );
  expect(state.status).toBe('active');
  expect(events.map((e) => e.type)).toContain('hazardTriggered');
});

test('ignores disabled instance', () => {
  let { state } = applyResult(createInitialState(plan), plan, r({ disableId: 'd1' }));
  const res = applyResult(state, plan, r({ disableId: 'd2', messageId: 'm9' }));
  expect(res.events).toEqual([
    { type: 'ignored', reason: 'instance-disabled', instanceKey: 'c1:0' },
  ]);
  expect(res.state).toEqual(state);
});

test('all instances disabled disables hazard', () => {
  let s = activate(createInitialState(plan));
  let events = [];
  for (const i of [0, 1, 2])
    ({ state: s, events } = applyResult(
      s,
      plan,
      r({ instanceKey: `c1:${i}`, disableId: 'd1', messageId: `m${i}` }),
    ));
  expect(s.status).toBe('disabled');
  expect(events.map((e) => e.type)).toContain('hazardDisabled');
  expect(disabledCount(s)).toBe(3);
});

test('reroll replaces previous result from same actor on same instance', () => {
  let { state } = applyResult(createInitialState(plan), plan, r({ degree: DEGREE.SUCCESS }));
  ({ state } = applyResult(
    state,
    plan,
    r({ degree: DEGREE.FAIL, isReroll: true, messageId: 'm2' }),
  ));
  expect(state.instances[0].progress.d2).toBe(0);
  expect(state.history.filter((h) => h.kind === 'result')).toHaveLength(1);
});

test('undo reverts the last result including disabled flag and status', () => {
  let s = activate(
    createInitialState({ ...plan, components: [{ ...plan.components[0], count: 1 }] }),
  );
  const p1 = { ...plan, components: [{ ...plan.components[0], count: 1 }] };
  ({ state: s } = applyResult(s, p1, r({ disableId: 'd1' })));
  expect(s.status).toBe('disabled');
  s = undo(s, p1);
  expect(s.status).toBe('active');
  expect(s.instances[0]).toMatchObject({ disabled: false, progress: { d1: 0 } });
});

test('override sets progress and disabled with undo support', () => {
  let { state } = override(createInitialState(plan), plan, {
    instanceKey: 'c1:1',
    disableId: 'd2',
    progress: 1,
  });
  expect(state.instances[1].progress.d2).toBe(1);
  ({ state } = override(state, plan, { instanceKey: 'c1:1', disabled: true }));
  expect(state.instances[1].disabled).toBe(true);
  state = undo(state, plan);
  expect(state.instances[1].disabled).toBe(false);
});

test('actionsRemaining subtracts disabled instances and floors at zero', () => {
  let s = createInitialState(plan);
  expect(actionsRemaining(s, plan)).toBe(9);
  ({ state: s } = applyResult(s, plan, r({ disableId: 'd1' })));
  expect(actionsRemaining(s, plan)).toBe(6);
  const greedy = { ...plan, actionsPerTurn: 2 };
  expect(actionsRemaining(s, greedy)).toBe(0);
  expect(actionsRemaining(s, { ...plan, actionsPerTurn: null })).toBeNull();
});

test('syncStateToPlan keeps progress on surviving instances', () => {
  let { state } = applyResult(createInitialState(plan), plan, r({ instanceKey: 'c1:0' }));
  const smaller = { ...plan, components: [{ ...plan.components[0], count: 2 }] };
  const synced = syncStateToPlan(state, smaller);
  expect(synced.instances).toHaveLength(2);
  expect(synced.instances[0].progress.d2).toBe(1);
  const bigger = {
    ...plan,
    components: [
      {
        ...plan.components[0],
        count: 4,
        disables: [...plan.components[0].disables, { id: 'd3', successesNeeded: 1 }],
      },
    ],
  };
  const grown = syncStateToPlan(state, bigger);
  expect(grown.instances).toHaveLength(4);
  expect(grown.instances[0].progress).toEqual({ d1: 0, d2: 1, d3: 0 });
});

test('reset rearms with fresh instances', () => {
  let { state } = applyResult(activate(createInitialState(plan)), plan, r());
  state = reset(state, plan);
  expect(state.status).toBe('armed');
  expect(state.instances[0].progress.d2).toBe(0);
});

test('inputs are not mutated', () => {
  const s = createInitialState(plan);
  const copy = structuredClone(s);
  applyResult(s, plan, r());
  expect(s).toEqual(copy);
});

test('A: multi-actor reroll keeps another actor success', () => {
  let s = activate(createInitialState(plan));
  ({ state: s } = applyResult(s, plan, r({ actorUuid: 'Actor.a' })));
  ({ state: s } = applyResult(s, plan, r({ actorUuid: 'Actor.b', messageId: 'm2' })));
  expect(s.instances[0]).toMatchObject({ disabled: true, progress: { d2: 2 } });
  ({ state: s } = applyResult(
    s,
    plan,
    r({ actorUuid: 'Actor.a', degree: DEGREE.FAIL, isReroll: true, messageId: 'm3' }),
  ));
  expect(s.instances[0].progress.d2).toBe(1);
  expect(s.instances[0].disabled).toBe(true);
});

test('B: reroll does not regress status set by activate', () => {
  let { state: s } = applyResult(createInitialState(plan), plan, r());
  s = activate(s);
  ({ state: s } = applyResult(
    s,
    plan,
    r({ degree: DEGREE.FAIL, isReroll: true, messageId: 'm2' }),
  ));
  expect(s.status).toBe('active');
});

test('C: undo of reset restores pre-reset status and instances', () => {
  let s = activate(createInitialState(plan));
  ({ state: s } = applyResult(s, plan, r({ instanceKey: 'c1:0', disableId: 'd1' })));
  ({ state: s } = applyResult(
    s,
    plan,
    r({ instanceKey: 'c1:1', disableId: 'd1', messageId: 'm2' }),
  ));
  const before = structuredClone(s);
  s = undo(reset(s, plan), plan);
  expect(s).toEqual(before);
});

test('D: undo of a trigger keeps status changed later by activate', () => {
  let { state: s } = applyResult(createInitialState(plan), plan, r({ degree: DEGREE.CRIT_FAIL }));
  s = activate(s);
  s = undo(s, plan);
  expect(s.status).toBe('active');
});

test('E: undo after later override transitions restores consistent status', () => {
  let s = activate(createInitialState(plan));
  for (const i of [0, 1, 2])
    s = override(s, plan, { instanceKey: `c1:${i}`, disabled: true }).state;
  expect(s.status).toBe('disabled');
  s = override(s, plan, { instanceKey: 'c1:2', disabled: false }).state;
  expect(s.status).toBe('active');
  s = undo(s, plan);
  expect(s.status).toBe('disabled');
  expect(s.instances[2].disabled).toBe(true);
  s = undo(s, plan);
  expect(s.status).toBe('active');
  expect(s.instances[2].disabled).toBe(false);
});

test('override, undo, reset and sync do not mutate inputs', () => {
  let { state: s } = applyResult(activate(createInitialState(plan)), plan, r());
  const copy = structuredClone(s);
  override(s, plan, { instanceKey: 'c1:1', disableId: 'd2', progress: 1 });
  undo(s, plan);
  reset(s, plan);
  syncStateToPlan(s, plan);
  expect(s).toEqual(copy);
});

test('sync leaving only disabled instances sets status disabled', () => {
  let s = activate(createInitialState(plan));
  for (const i of [0, 1])
    ({ state: s } = applyResult(
      s,
      plan,
      r({ instanceKey: `c1:${i}`, disableId: 'd1', messageId: `m${i}` }),
    ));
  expect(s.status).toBe('active');
  s = syncStateToPlan(s, { ...plan, components: [{ ...plan.components[0], count: 2 }] });
  expect(s.status).toBe('disabled');
});

test('sync re-clamps progress to a lowered successesNeeded', () => {
  let { state: s } = applyResult(
    createInitialState(plan),
    plan,
    r({ degree: DEGREE.CRIT_SUCCESS }),
  );
  expect(s.instances[0].progress.d2).toBe(2);
  const lowered = {
    ...plan,
    components: [
      {
        ...plan.components[0],
        disables: [
          plan.components[0].disables[0],
          { id: 'd2', skill: 'religion', dc: 35, successesNeeded: 1 },
        ],
      },
    ],
  };
  s = syncStateToPlan(s, lowered);
  expect(s.instances[0].progress.d2).toBe(1);
});

describe('components without disable options', () => {
  const mixed = {
    actionsPerTurn: 3,
    components: [
      {
        id: 'c1',
        name: 'lock',
        count: 1,
        actionsEach: 1,
        disables: [{ id: 'd1', skill: 'thievery', dc: 20, successesNeeded: 1 }],
      },
      { id: 'c2', name: 'aura', count: 2, actionsEach: 0, disables: [] },
    ],
  };

  test('do not block the hazard from reaching disabled', () => {
    const s0 = activate(createInitialState(mixed));
    const { state, events } = applyResult(s0, mixed, {
      instanceKey: instanceKey('c1', 0),
      disableId: 'd1',
      degree: DEGREE.SUCCESS,
    });
    expect(state.status).toBe('disabled');
    expect(events.map((e) => e.type)).toContain('hazardDisabled');
    expect(undo(state, mixed).status).toBe('active');
  });

  test('when every component lacks disables, results alone cannot disable', () => {
    const none = { actionsPerTurn: 1, components: [{ id: 'c1', count: 1, disables: [] }] };
    const s0 = activate(createInitialState(none));
    expect(syncStateToPlan(s0, none).status).toBe('active');
    const { state } = override(s0, none, { instanceKey: 'c1:0', disabled: true });
    expect(state.status).toBe('disabled');
  });
});

describe('any-combination (shared) successes', () => {
  const shared = {
    actionsPerTurn: null,
    components: [
      {
        id: 'c1',
        name: 'ashes',
        count: 1,
        actionsEach: 0,
        sharedSuccesses: 3,
        disables: [
          { id: 'd1', skill: 'occultism', dc: 44, successesNeeded: 3 },
          { id: 'd2', skill: 'religion', dc: 42, successesNeeded: 3 },
        ],
      },
    ],
  };
  const roll = (s, disableId, degree = DEGREE.SUCCESS) =>
    applyResult(s, shared, r({ disableId, degree })).state;

  test('mixed options add up to the shared total', () => {
    let s = activate(createInitialState(shared));
    s = roll(s, 'd1');
    s = roll(s, 'd1');
    expect(s.instances[0].disabled).toBe(false);
    s = roll(s, 'd2');
    expect(s.instances[0].progress).toEqual({ d1: 2, d2: 1 });
    expect(s.instances[0].disabled).toBe(true);
    expect(s.status).toBe('disabled');
  });

  test('a critical success is capped by what the pool still needs', () => {
    let s = activate(createInitialState(shared));
    s = roll(s, 'd1');
    s = roll(s, 'd1');
    s = roll(s, 'd2', DEGREE.CRIT_SUCCESS);
    expect(s.instances[0].progress).toEqual({ d1: 2, d2: 1 });
  });

  test('undo re-arms the instance', () => {
    let s = activate(createInitialState(shared));
    s = roll(s, 'd1');
    s = roll(s, 'd2', DEGREE.CRIT_SUCCESS);
    expect(s.instances[0].disabled).toBe(true);
    s = undo(s, shared);
    expect(s.instances[0].disabled).toBe(false);
    expect(s.instances[0].progress).toEqual({ d1: 1, d2: 0 });
  });

  test('override caps an option at the open slots and disables when full', () => {
    let s = activate(createInitialState(shared));
    s = override(s, shared, { instanceKey: 'c1:0', disableId: 'd1', progress: 2 }).state;
    s = override(s, shared, { instanceKey: 'c1:0', disableId: 'd2', progress: 5 }).state;
    expect(s.instances[0].progress).toEqual({ d1: 2, d2: 1 });
    expect(s.instances[0].disabled).toBe(true);
  });

  test('syncStateToPlan trims progress to the shared total', () => {
    const s = activate(createInitialState(shared));
    s.instances[0].progress = { d1: 2, d2: 1 };
    const smaller = {
      ...shared,
      components: [{ ...shared.components[0], sharedSuccesses: 2 }],
    };
    expect(syncStateToPlan(s, smaller).instances[0].progress).toEqual({ d1: 2, d2: 0 });
  });
});
