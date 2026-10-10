// In-page RPC functions, loaded by tests/live/run.mjs via
// import('/modules/pf2e-hazarder/tests/live/world.js'). Never shipped in CI or the module ZIP.
const MODULE = 'pf2e-hazarder';
const MARKER = 'liveTestRun';
const SETTINGS = ['publicFlavorCard', 'skipDisabledTurns', 'removeDisabledFromCombat'];

function owned(document, runId) {
  return document?.getFlag?.(MODULE, MARKER) === runId;
}

function assertion(label, value, details) {
  if (!value) throw Error(`${label}${details === undefined ? '' : `: ${JSON.stringify(details)}`}`);
  return { label, status: 'passed' };
}

async function waitFor(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Timed out waiting for ${label}`);
}

const live = () => (globalThis.__hazarderLive ??= {});
const api = () => game.modules.get(MODULE).api;
const trackerMessage = (tokenId) =>
  game.messages.find((m) => m.getFlag(MODULE, 'kind') === 'tracker' && m.speaker?.token === tokenId);
const stateOf = (tokenDoc) => foundry.utils.deepClone(tokenDoc.getFlag(MODULE, 'state'));
const sceneToken = (fixture) => game.scenes.get(fixture.scene)?.tokens.get(fixture.hazardToken);
const totalProgress = (state) =>
  state.instances.reduce((sum, i) => sum + Object.values(i.progress ?? {}).reduce((a, b) => a + b, 0), 0);

function findDialog(action) {
  for (const app of foundry.applications.instances.values()) {
    if (app instanceof foundry.applications.api.DialogV2 && app.element?.querySelector(`button[data-action="${action}"]`)) return app;
  }
  return null;
}

export function preflight() {
  const module = game.modules.get(MODULE);
  return {
    world: game.world.id,
    user: game.user.id,
    isGM: game.user.isGM,
    scene: canvas.scene?.id ?? null,
    foundry: game.release?.generation,
    system: game.system.id,
    systemVersion: game.system.version,
    moduleActive: module?.active === true,
    moduleVersion: module?.version,
  };
}

export function settingsSnapshot() {
  const values = {};
  for (const key of SETTINGS) values[key] = foundry.utils.deepClone(game.settings.get(MODULE, key));
  return values;
}

export async function restoreSettings(values) {
  if (!game.user.isGM) throw Error('GM required to restore settings');
  for (const [key, value] of Object.entries(values ?? {})) await game.settings.set(MODULE, key, value);
}

/** GM: create the flagged scene and player-owned PC. The hazard itself is imported by scenario 1. */
export async function prepare({ runId, playerUserId }) {
  if (!game.user.isGM || !runId) throw Error('GM run ID required');
  const flags = { [MODULE]: { [MARKER]: runId } };
  const ownership = { default: globalThis.CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [playerUserId]: globalThis.CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  const pc = await globalThis.Actor.create({
    name: 'Hazarder QA PC', type: 'character', ownership, flags,
    prototypeToken: { name: 'Hazarder QA PC', actorLink: true, disposition: 1 },
  });
  const scene = await globalThis.Scene.create({ name: 'Hazarder QA', width: 2000, height: 1400, grid: { size: 100 }, flags });
  const [pcToken] = await scene.createEmbeddedDocuments('Token', [
    { name: pc.name, actorId: pc.id, actorLink: true, x: 400, y: 500, disposition: 1, flags },
  ]);
  await scene.view();
  await waitFor(() => canvas.ready && canvas.scene?.id === scene.id, 'QA scene canvas');
  live().runId = runId;
  live().hooks ??= Hooks.on('createChatMessage', (message) => {
    if (live().runId && game.user.isGM && !message.getFlag(MODULE, MARKER)) void message.setFlag(MODULE, MARKER, live().runId);
  });
  return { runId, scene: scene.id, pcActor: pc.id, pcToken: pcToken.id };
}

export async function view(fixture) {
  const scene = game.scenes.get(fixture.scene);
  if (!scene || !owned(scene, fixture.runId)) throw Error('Owned QA scene required');
  await scene.view();
  await waitFor(() => canvas.ready && canvas.scene?.id === scene.id, 'QA scene canvas');
}

const steps = {
  // 1. Import Wheel of Misery, place a token, create a combat with the token and the PC.
  async 'import-and-combat'(fixture) {
    const flags = { [MODULE]: { [MARKER]: fixture.runId } };
    const pack = game.packs.get('pf2e.hazards');
    const entry = pack?.index.find((e) => e.name === 'Wheel of Misery');
    const out = [assertion('Wheel of Misery exists in pf2e.hazards', entry)];
    const source = game.actors.fromCompendium(await pack.getDocument(entry._id));
    source.flags = foundry.utils.mergeObject(source.flags ?? {}, flags);
    source.prototypeToken = foundry.utils.mergeObject(source.prototypeToken ?? {}, { actorLink: true });
    const actor = await globalThis.Actor.create(source);
    const scene = game.scenes.get(fixture.scene);
    const tokenData = (await actor.getTokenDocument({ x: 800, y: 500 })).toObject();
    tokenData.flags = foundry.utils.mergeObject(tokenData.flags ?? {}, flags);
    tokenData.actorLink = true;
    const [token] = await scene.createEmbeddedDocuments('Token', [tokenData]);
    fixture.hazardActor = actor.id;
    fixture.hazardToken = token.id;
    live().fixture = fixture;
    out.push(assertion('hazard actor is a complex hazard', actor.type === 'hazard' && actor.isComplex, actor.type));
    out.push(assertion('token placed on the active scene', canvas.scene.tokens.has(token.id)));
    // Hazard first so the review prompt (createCombatant hook) fires for it; initiatives are set so the PC acts first.
    const combat = await globalThis.Combat.create({ scene: scene.id, active: true, flags });
    await combat.createEmbeddedDocuments('Combatant', [
      { tokenId: token.id, sceneId: scene.id, actorId: actor.id, initiative: 10 },
      { tokenId: fixture.pcToken, sceneId: scene.id, actorId: fixture.pcActor, initiative: 20 },
    ]);
    fixture.combat = combat.id;
    out.push(assertion('combat has the hazard and the PC', combat.combatants.size === 2, combat.combatants.size));
    return { assertions: out, fixture };
  },

  // 2. Review dialog opened; save the plan panel.
  async 'review-dialog-save'() {
    const out = [];
    const dialog = await waitFor(() => findDialog('yes'), 'plan review dialog');
    out.push(assertion('review dialog opened', dialog));
    dialog.element.querySelector('button[data-action="yes"]').click();
    const submit = await waitFor(() => document.querySelector('.hazarder-plan button[type=submit]'), 'plan panel');
    out.push(assertion('plan panel opened', submit));
    submit.click();
    await waitFor(() => !document.querySelector('.hazarder-plan button[type=submit]'), 'plan panel to close');
    out.push(assertion('plan panel closed after save', true));
    return out;
  },

  // 3. Plan confirmed on the actor; tracker card exists.
  async 'plan-confirmed-tracker'(fixture) {
    const actor = game.actors.get(fixture.hazardActor);
    await waitFor(() => actor.getFlag(MODULE, 'plan')?.confirmed === true, 'confirmed plan');
    const tracker = await waitFor(() => trackerMessage(fixture.hazardToken), 'tracker message');
    return [
      assertion('plan confirmed', actor.getFlag(MODULE, 'plan').confirmed === true),
      assertion('tracker message exists', tracker.getFlag(MODULE, 'kind') === 'tracker'),
      assertion('token has hazard state', !!sceneToken(fixture).getFlag(MODULE, 'state')),
    ];
  },

  // 4. Advance to the hazard's turn; whispered turn card posted.
  async 'hazard-turn-card'(fixture) {
    const combat = game.combats.get(fixture.combat);
    const out = [];
    await combat.startCombat();
    for (let i = 0; i < 4 && combat.combatant?.tokenId !== fixture.hazardToken; i++) await combat.nextTurn();
    out.push(assertion('hazard turn reached', combat.combatant?.tokenId === fixture.hazardToken, combat.combatant?.name));
    const turn = await waitFor(
      () => game.messages.find((m) => m.getFlag(MODULE, 'kind') === 'turn' && m.speaker?.token === fixture.hazardToken),
      'turn card',
    );
    out.push(assertion('turn card is whispered to GMs', turn.whisper.length > 0 && turn.whisper.every((id) => game.users.get(id)?.isGM), turn.whisper));
    live().before = stateOf(sceneToken(fixture));
    live().messageIds = game.messages.map((m) => m.id);
    return out;
  },

  // 5. Player: control the PC token and click the first disable button on the tracker card.
  async 'player-rolls-disable'(fixture) {
    await view(fixture);
    const token = canvas.tokens.get(fixture.pcToken);
    token.control({ releaseOthers: true });
    await waitFor(() => canvas.tokens.controlled[0]?.id === token.id, 'PC token control');
    try {
      await game.settings.set('pf2e', 'showCheckDialogs', false);
    } catch {
      /* setting may be absent or world-scoped; the dialog is handled below instead */
    }
    if (ui.sidebar?.changeTab) ui.sidebar.changeTab('chat', 'primary');
    else ui.sidebar?.activateTab?.('chat');
    const button = await waitFor(
      () => document.querySelector(`.hazarder-card[data-token-uuid$="${fixture.hazardToken}"] [data-hz-action="disable"]`),
      'disable button on tracker card',
      15000,
    );
    const before = game.messages.size;
    button.click();
    const dialogRoll = await waitFor(() => document.querySelector('.check-modifiers-dialog button.roll, dialog button.roll'), 'roll dialog', 2500).catch(() => null);
    dialogRoll?.click();
    await waitFor(() => game.messages.size > before, 'check chat message');
    return [assertion('disable button found and clicked', true), assertion('a check message was created', game.messages.size > before)];
  },

  // 6. GM: the check message was applied and the token state changed accordingly.
  async 'check-applied'(fixture) {
    const message = await waitFor(
      () => game.messages.find((m) => !live().messageIds.includes(m.id) && m.flags?.pf2e?.context?.type === 'skill-check'),
      'check message',
    );
    await waitFor(() => message.getFlag(MODULE, 'applied') === true, 'check to be applied', 15000);
    const after = stateOf(sceneToken(fixture));
    const before = live().before;
    const outcome = message.flags.pf2e.context.outcome;
    const out = [assertion('check message flagged applied', message.getFlag(MODULE, 'applied') === true)];
    if (outcome === 'criticalFailure') out.push(assertion('critical failure triggers the hazard', after.status === 'triggered', after.status));
    else if (outcome === 'failure') out.push(assertion('failure leaves progress unchanged', totalProgress(after) === totalProgress(before)));
    else {
      const anyDisabled = after.instances.some((i, n) => i.disabled && !before.instances[n].disabled);
      out.push(assertion(`${outcome} advanced progress`, totalProgress(after) > totalProgress(before) || anyDisabled, { before, after }));
    }
    // Clear any triggered prompt so it does not block later steps.
    findDialog('ok')?.close();
    return out;
  },

  // 7. GM: critically succeed on every remaining instance; hazard ends up disabled.
  async 'disable-remaining'(fixture) {
    const tokenDoc = sceneToken(fixture);
    const plan = tokenDoc.actor.getFlag(MODULE, 'plan');
    for (const instance of stateOf(tokenDoc).instances) {
      const component = plan.components.find((c) => c.id === instance.componentId);
      for (const disable of component.disables) {
        const current = stateOf(tokenDoc).instances.find((i) => i.componentId === instance.componentId && i.index === instance.index);
        if (current.disabled) break;
        await api().runner.apply(tokenDoc, {
          instanceKey: `${instance.componentId}:${instance.index}`,
          disableId: disable.id,
          degree: 3,
        });
      }
    }
    const state = stateOf(tokenDoc);
    return [
      assertion('every instance disabled', state.instances.every((i) => i.disabled), state.instances),
      assertion('hazard status is disabled', state.status === 'disabled', state.status),
    ];
  },

  // 8. GM: Reset on the tracker card, confirm; status armed.
  async reset(fixture) {
    const tokenDoc = sceneToken(fixture);
    const button = await waitFor(
      () => document.querySelector(`.hazarder-card[data-token-uuid$="${fixture.hazardToken}"] [data-hz-action="reset"]`),
      'Reset button',
      15000,
    );
    button.click();
    const dialog = await waitFor(() => findDialog('yes'), 'reset confirm dialog');
    dialog.element.querySelector('button[data-action="yes"]').click();
    await waitFor(() => stateOf(tokenDoc).status === 'armed', 'armed status');
    return [assertion('hazard reset to armed', stateOf(tokenDoc).status === 'armed')];
  },

  // 9. Delete combat, token and actors; nothing flagged remains.
  async cleanup(fixture) {
    await cleanup(fixture.runId);
    const remaining = leftovers(fixture.runId);
    return [assertion('no QA documents remain', Object.values(remaining).every((ids) => !ids.length), remaining)];
  },
};

/** Run one scenario step; returns { assertions, fixture } so ids discovered by a step reach later steps (including the player page). */
export async function step({ name, fixture }) {
  if (!steps[name]) throw Error(`Unknown live step: ${name}`);
  const shared = { ...fixture, ...(live().fixture ?? {}) };
  const result = await steps[name](shared);
  const assertions = Array.isArray(result) ? result : result.assertions;
  return { assertions, fixture: shared };
}

export async function cleanup(runId) {
  if (!game.user.isGM) throw Error('GM cleanup required');
  live().runId = null;
  for (const app of [...foundry.applications.instances.values()]) {
    if (app.id?.startsWith('hazarder-plan') || app instanceof foundry.applications.api.DialogV2) await app.close();
  }
  const pick = (collection) => collection.filter((document) => owned(document, runId)).map((document) => document.id);
  const combats = pick(game.combats);
  const messages = pick(game.messages);
  const scenes = pick(game.scenes);
  const actors = pick(game.actors);
  if (combats.length) await globalThis.Combat.deleteDocuments(combats);
  if (messages.length) await ChatMessage.deleteDocuments(messages);
  if (scenes.length) await globalThis.Scene.deleteDocuments(scenes);
  if (actors.length) await globalThis.Actor.deleteDocuments(actors);
}

export function leftovers(runId) {
  const pick = (collection) => collection.filter((document) => owned(document, runId)).map((document) => document.id);
  return { combats: pick(game.combats), scenes: pick(game.scenes), actors: pick(game.actors), messages: pick(game.messages) };
}
