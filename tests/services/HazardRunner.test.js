import { HazardRunner } from '../../scripts/services/HazardRunner.js';
import { createInitialState, activate } from '../../scripts/services/RulesEngine.js';

const plan = {
  version: 1,
  confirmed: true,
  actionsPerTurn: 2,
  components: [{ id: 'c1', name: 'Rune', count: 1, actionsEach: 0, disables: [{ id: 'd1', skill: 'thievery', dc: 22, successesNeeded: 1 }] }],
  reactionItemId: 'r1',
};

function setup({ writer = true } = {}) {
  const tokenDoc = { id: 't1', name: 'Wheel', state: activate(createInitialState(plan)) };
  const store = {
    getOrDraftPlan: () => ({ plan, warnings: [], isDraft: false }),
    getOrCreateState: (t) => structuredClone(t.state),
    setState: jest.fn(async (t, s) => {
      t.state = s;
    }),
  };
  const ui = { upsertTracker: jest.fn(), showTriggered: jest.fn(), notify: jest.fn() };
  const runner = new HazardRunner({
    getCandidates: () => [{ tokenId: 't1', tokenDoc, plan, state: tokenDoc.state }],
    resolveToken: (id) => (id === 't1' ? tokenDoc : null),
    store,
    ui,
    isWriter: () => writer,
    now: () => 5,
  });
  return { runner, tokenDoc, store, ui };
}

const msg = (context, flags = {}) => ({
  id: 'm1',
  author: { id: 'u1' },
  flags: { pf2e: { context }, 'pf2e-hazarder': flags },
  speaker: { actor: 'a1' },
  setFlag: jest.fn(),
});
const ctx = (over = {}) => ({ type: 'skill-check', outcome: 'success', dc: { value: 22 }, options: ['check:statistic:thievery'], ...over });

test('unique match applies, marks message, refreshes tracker', async () => {
  const { runner, tokenDoc, ui } = setup();
  const m = msg(ctx());
  const res = await runner.handleCheckMessage(m);
  expect(res).toEqual({ kind: 'unique', applied: true });
  expect(tokenDoc.state.instances[0].disabled).toBe(true);
  expect(tokenDoc.state.status).toBe('disabled');
  expect(m.setFlag).toHaveBeenCalledWith('pf2e-hazarder', 'applied', true);
  expect(ui.upsertTracker).toHaveBeenCalledWith(tokenDoc);
  expect(ui.notify).toHaveBeenCalled();
});

test('crit failure shows triggered prompt', async () => {
  const { runner, ui } = setup();
  await runner.handleCheckMessage(msg(ctx({ outcome: 'criticalFailure' })));
  expect(ui.showTriggered).toHaveBeenCalled();
});

test('non-writer does nothing', async () => {
  const { runner, store } = setup({ writer: false });
  expect(await runner.handleCheckMessage(msg(ctx()))).toEqual({ kind: 'skipped', applied: false });
  expect(store.setState).not.toHaveBeenCalled();
});

test('already applied, wrong type, or no outcome is skipped', async () => {
  const { runner } = setup();
  expect((await runner.handleCheckMessage(msg(ctx(), { applied: true }))).kind).toBe('skipped');
  expect((await runner.handleCheckMessage(msg(ctx({ type: 'attack-roll' })))).kind).toBe('skipped');
  expect((await runner.handleCheckMessage(msg(ctx({ outcome: null })))).kind).toBe('skipped');
});

test('ambiguous stores candidates on the message', async () => {
  const { runner, tokenDoc } = setup();
  runner.getCandidates = () => [
    { tokenId: 't1', tokenDoc, plan, state: tokenDoc.state },
    { tokenId: 't2', tokenDoc, plan, state: tokenDoc.state },
  ];
  const m = msg(ctx());
  expect(await runner.handleCheckMessage(m)).toEqual({ kind: 'ambiguous', applied: false });
  expect(m.setFlag).toHaveBeenCalledWith('pf2e-hazarder', 'candidates', expect.any(Array));
});

test('reroll flag is passed through', async () => {
  const { runner, tokenDoc } = setup();
  await runner.handleCheckMessage(msg(ctx({ outcome: 'failure' })));
  await runner.handleCheckMessage({ ...msg(ctx({ outcome: 'success', isReroll: true })), id: 'm2' });
  expect(tokenDoc.state.history.filter((h) => h.kind === 'result')).toHaveLength(1);
});

test('overridePip cycles progress', async () => {
  const p2 = { ...plan, components: [{ ...plan.components[0], disables: [{ id: 'd1', skill: 'x', dc: 1, successesNeeded: 2 }] }] };
  const { runner, tokenDoc, store } = setup();
  store.getOrDraftPlan = () => ({ plan: p2, warnings: [], isDraft: false });
  tokenDoc.state = activate(createInitialState(p2));
  await runner.overridePip(tokenDoc, 'c1:0', 'd1');
  expect(tokenDoc.state.instances[0].progress.d1).toBe(1);
  await runner.overridePip(tokenDoc, 'c1:0', 'd1');
  expect(tokenDoc.state.instances[0].progress.d1).toBe(2);
  await runner.overridePip(tokenDoc, 'c1:0', 'd1');
  expect(tokenDoc.state.instances[0].progress.d1).toBe(0);
});

describe('removeDisabledFromCombat', () => {
  const origSettings = game.settings;
  const origCombat = game.combat;
  afterEach(() => {
    game.settings = origSettings;
    game.combat = origCombat;
  });

  async function disable(setting) {
    const del = jest.fn();
    game.settings = { get: jest.fn(() => setting) };
    game.combat = {
      combatants: [
        { id: 'cb1', tokenId: 't1', delete: del },
        { id: 'cb2', tokenId: 'other', delete: jest.fn() },
      ],
    };
    const { runner } = setup();
    await runner.handleCheckMessage(msg(ctx()));
    return { del, other: game.combat.combatants[1].delete };
  }

  test('removes the combatant when the setting is on', async () => {
    const { del, other } = await disable(true);
    expect(del).toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });

  test('keeps the combatant when the setting is off', async () => {
    const { del } = await disable(false);
    expect(del).not.toHaveBeenCalled();
  });
});
