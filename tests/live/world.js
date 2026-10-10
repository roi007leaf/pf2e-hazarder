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
  game.messages.find(
    (m) => m.getFlag(MODULE, 'kind') === 'tracker' && m.speaker?.token === tokenId,
  );
const stateOf = (tokenDoc) => foundry.utils.deepClone(tokenDoc.getFlag(MODULE, 'state'));
const sceneToken = (fixture) => game.scenes.get(fixture.scene)?.tokens.get(fixture.hazardToken);
const totalProgress = (state) =>
  state.instances.reduce(
    (sum, i) => sum + Object.values(i.progress ?? {}).reduce((a, b) => a + b, 0),
    0,
  );

const basePlan = (fixture) => game.actors.get(fixture.hazardActor)?.getFlag(MODULE, 'plan');
const keyOf = (instance) => `${instance.componentId}:${instance.index}`;
const triggeredTitle = (tokenDoc) =>
  game.i18n.format('PF2E_HAZARDER.Triggered.Title', { name: tokenDoc?.name ?? '' });

function openTriggeredPrompt(tokenDoc) {
  const title = triggeredTitle(tokenDoc);
  for (const app of foundry.applications.instances.values()) {
    if (app instanceof foundry.applications.api.DialogV2 && app.title === title && app.rendered)
      return app;
  }
  return null;
}

function showChatTab() {
  if (ui.sidebar?.changeTab) ui.sidebar.changeTab('chat', 'primary');
  else ui.sidebar?.activateTab?.('chat');
}

function trackerButton(fixture, action) {
  return document.querySelector(
    `.hazarder-card[data-token-uuid$="${fixture.hazardToken}"] [data-hz-action="${action}"]`,
  );
}

function findDialog(action) {
  for (const app of foundry.applications.instances.values()) {
    if (
      app instanceof foundry.applications.api.DialogV2 &&
      app.element?.querySelector(`button[data-action="${action}"]`)
    )
      return app;
  }
  return null;
}

async function closeTriggeredPrompts(fixture) {
  const title = triggeredTitle(sceneToken(fixture));
  for (const app of [...foundry.applications.instances.values()]) {
    if (app instanceof foundry.applications.api.DialogV2 && app.title === title) await app.close();
  }
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
  for (const [key, value] of Object.entries(values ?? {}))
    await game.settings.set(MODULE, key, value);
}

// pf2e stores "show check dialogs" as a per-user flag (game.user.settings.showCheckDialogs);
// older versions registered a client setting. Snapshot whichever exists so cleanup can restore it.
const CHECK_DIALOG_FLAG = 'flags.pf2e.settings.showCheckDialogs';
const hasCheckDialogSetting = () => game.settings.settings.has('pf2e.showCheckDialogs');

export function checkDialogsSnapshot() {
  if (hasCheckDialogSetting())
    return { source: 'setting', value: game.settings.get('pf2e', 'showCheckDialogs') };
  const value = foundry.utils.getProperty(game.user, CHECK_DIALOG_FLAG);
  return { source: 'flag', present: value !== undefined, value: value ?? null };
}

async function setCheckDialogs(value) {
  if (hasCheckDialogSetting()) await game.settings.set('pf2e', 'showCheckDialogs', value);
  else await game.user.update({ [CHECK_DIALOG_FLAG]: value });
}

export async function restoreCheckDialogs(snapshot) {
  if (!snapshot) return;
  if (snapshot.source === 'setting') {
    if (hasCheckDialogSetting())
      await game.settings.set('pf2e', 'showCheckDialogs', snapshot.value);
  } else if (snapshot.present) {
    await game.user.update({ [CHECK_DIALOG_FLAG]: snapshot.value });
  } else if (foundry.utils.getProperty(game.user, CHECK_DIALOG_FLAG) !== undefined) {
    await game.user.update({ 'flags.pf2e.settings.-=showCheckDialogs': null });
  }
}

/** GM: create the flagged scene and player-owned PC. The hazard itself is imported by scenario 1. */
export async function prepare({ runId, playerUserId, expectedWorld }) {
  if (!expectedWorld || game.world.id !== expectedWorld) {
    throw Error(
      `Refusing to prepare outside disposable world "${expectedWorld}" (current: ${game.world.id})`,
    );
  }
  if (!game.user.isGM || !runId) throw Error('GM run ID required');
  const flags = { [MODULE]: { [MARKER]: runId } };
  const ownership = {
    default: globalThis.CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
    [playerUserId]: globalThis.CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
  };
  const pc = await globalThis.Actor.create({
    name: 'Hazarder QA PC',
    type: 'character',
    ownership,
    flags,
    prototypeToken: { name: 'Hazarder QA PC', actorLink: true, disposition: 1 },
  });
  const scene = await globalThis.Scene.create({
    name: 'Hazarder QA',
    width: 2000,
    height: 1400,
    grid: { size: 100 },
    flags,
  });
  const [pcToken] = await scene.createEmbeddedDocuments('Token', [
    { name: pc.name, actorId: pc.id, actorLink: true, x: 400, y: 500, disposition: 1, flags },
  ]);
  await scene.view();
  await waitFor(() => canvas.ready && canvas.scene?.id === scene.id, 'QA scene canvas');
  live().runId = runId;
  live().hooks ??= Hooks.on('createChatMessage', (message) => {
    if (live().runId && game.user.isGM && !message.getFlag(MODULE, MARKER))
      void message.setFlag(MODULE, MARKER, live().runId);
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
    // pf2e hazards default to unlinked tokens; keep that so the plan-on-base-actor path is exercised.
    source.prototypeToken = foundry.utils.mergeObject(source.prototypeToken ?? {}, {
      actorLink: false,
    });
    const actor = await globalThis.Actor.create(source);
    const scene = game.scenes.get(fixture.scene);
    const tokenData = (await actor.getTokenDocument({ x: 800, y: 500 })).toObject();
    tokenData.flags = foundry.utils.mergeObject(tokenData.flags ?? {}, flags);
    tokenData.actorLink = false;
    const [token] = await scene.createEmbeddedDocuments('Token', [tokenData]);
    fixture.hazardActor = actor.id;
    fixture.hazardToken = token.id;
    live().fixture = fixture;
    out.push(
      assertion(
        'hazard actor is a complex hazard',
        actor.type === 'hazard' && actor.isComplex,
        actor.type,
      ),
    );
    out.push(assertion('token placed on the active scene', canvas.scene.tokens.has(token.id)));
    out.push(
      assertion('hazard token is unlinked', token.actorLink === false && token.actor?.isToken),
    );
    // Hazard first so the review prompt (createCombatant hook) fires for it; initiatives are set so the PC acts first.
    const combat = await globalThis.Combat.create({ scene: scene.id, active: true, flags });
    await combat.createEmbeddedDocuments('Combatant', [
      { tokenId: token.id, sceneId: scene.id, actorId: actor.id, initiative: 10 },
      { tokenId: fixture.pcToken, sceneId: scene.id, actorId: fixture.pcActor, initiative: 20 },
    ]);
    fixture.combat = combat.id;
    out.push(
      assertion(
        'combat has the hazard and the PC',
        combat.combatants.size === 2,
        combat.combatants.size,
      ),
    );
    return { assertions: out, fixture };
  },

  // 2. Review dialog opened; save the plan panel.
  async 'review-dialog-save'() {
    const out = [];
    const dialog = await waitFor(() => findDialog('yes'), 'plan review dialog');
    out.push(assertion('review dialog opened', dialog));
    dialog.element.querySelector('button[data-action="yes"]').click();
    const submit = await waitFor(
      () => document.querySelector('.hazarder-plan button[type=submit]'),
      'plan panel',
    );
    out.push(assertion('plan panel opened', submit));
    submit.click();
    await waitFor(
      () => !document.querySelector('.hazarder-plan button[type=submit]'),
      'plan panel to close',
    );
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
      assertion(
        'plan not written into the token delta',
        !sceneToken(fixture).delta?.toObject()?.flags?.[MODULE]?.plan,
      ),
    ];
  },

  // 4. Advance to the hazard's turn; whispered turn card posted.
  async 'hazard-turn-card'(fixture) {
    const combat = game.combats.get(fixture.combat);
    const out = [];
    await combat.startCombat();
    for (let i = 0; i < 4 && combat.combatant?.tokenId !== fixture.hazardToken; i++)
      await combat.nextTurn();
    out.push(
      assertion(
        'hazard turn reached',
        combat.combatant?.tokenId === fixture.hazardToken,
        combat.combatant?.name,
      ),
    );
    const turn = await waitFor(
      () =>
        game.messages.find(
          (m) => m.getFlag(MODULE, 'kind') === 'turn' && m.speaker?.token === fixture.hazardToken,
        ),
      'turn card',
    );
    out.push(
      assertion(
        'turn card is whispered to GMs',
        turn.whisper.length > 0 && turn.whisper.every((id) => game.users.get(id)?.isGM),
        turn.whisper,
      ),
    );
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
      await setCheckDialogs(false); // restored by run.mjs cleanup from the journal snapshot
    } catch {
      /* the dialog is handled below instead */
    }
    showChatTab();
    const button = await waitFor(
      () =>
        document.querySelector(
          `.hazarder-card[data-token-uuid$="${fixture.hazardToken}"] [data-hz-action="disable"]`,
        ),
      'disable button on tracker card',
      15000,
    );
    const before = game.messages.size;
    button.click();
    const dialogRoll = await waitFor(
      () => document.querySelector('.check-modifiers-dialog button.roll, dialog button.roll'),
      'roll dialog',
      2500,
    ).catch(() => null);
    dialogRoll?.click();
    await waitFor(() => game.messages.size > before, 'check chat message');
    return [
      assertion('disable button found and clicked', true),
      assertion('a check message was created', game.messages.size > before),
    ];
  },

  // 6. GM: the check message was applied and the token state changed accordingly.
  async 'check-applied'(fixture) {
    const message = await waitFor(
      () =>
        game.messages.find(
          (m) =>
            !live().messageIds.includes(m.id) && m.flags?.pf2e?.context?.type === 'skill-check',
        ),
      'check message',
    );
    await waitFor(() => message.getFlag(MODULE, 'applied') === true, 'check to be applied', 15000);
    const after = stateOf(sceneToken(fixture));
    const before = live().before;
    const outcome = message.flags.pf2e.context.outcome;
    const out = [
      assertion('check message flagged applied', message.getFlag(MODULE, 'applied') === true),
    ];
    if (outcome === 'criticalFailure')
      out.push(
        assertion(
          'critical failure triggers the hazard',
          after.status === 'triggered',
          after.status,
        ),
      );
    else if (outcome === 'failure')
      out.push(
        assertion(
          'failure leaves progress unchanged',
          totalProgress(after) === totalProgress(before),
        ),
      );
    else {
      const anyDisabled = after.instances.some(
        (i, n) => i.disabled && !before.instances[n].disabled,
      );
      out.push(
        assertion(
          `${outcome} advanced progress`,
          totalProgress(after) > totalProgress(before) || anyDisabled,
          { before, after },
        ),
      );
    }
    // Clear any triggered prompt so it does not block later steps.
    await closeTriggeredPrompts(fixture);
    return out;
  },

  // 7. GM: critically succeed on every remaining instance; hazard ends up disabled.
  async 'disable-remaining'(fixture) {
    const tokenDoc = sceneToken(fixture);
    const plan = basePlan(fixture);
    for (const instance of stateOf(tokenDoc).instances) {
      const component = plan.components.find((c) => c.id === instance.componentId);
      for (const disable of component.disables) {
        const current = stateOf(tokenDoc).instances.find(
          (i) => i.componentId === instance.componentId && i.index === instance.index,
        );
        if (current.disabled) break;
        await api().runner.apply(tokenDoc, {
          instanceKey: `${instance.componentId}:${instance.index}`,
          disableId: disable.id,
          degree: 3,
        });
      }
    }
    await closeTriggeredPrompts(fixture);
    const state = stateOf(tokenDoc);
    return [
      assertion(
        'every instance disabled',
        state.instances.every((i) => i.disabled),
        state.instances,
      ),
      assertion('hazard status is disabled', state.status === 'disabled', state.status),
    ];
  },

  // 8. GM: Reset on the tracker card, confirm; status armed.
  async reset(fixture) {
    const tokenDoc = sceneToken(fixture);
    const button = await waitFor(
      () =>
        document.querySelector(
          `.hazarder-card[data-token-uuid$="${fixture.hazardToken}"] [data-hz-action="reset"]`,
        ),
      'Reset button',
      15000,
    );
    await closeTriggeredPrompts(fixture);
    const existing = new Set(foundry.applications.instances.values());
    button.click();
    const dialog = await waitFor(() => {
      for (const app of foundry.applications.instances.values()) {
        if (
          !existing.has(app) &&
          app instanceof foundry.applications.api.DialogV2 &&
          app.element?.querySelector('button[data-action="yes"]')
        )
          return app;
      }
      return null;
    }, 'reset confirm dialog');
    dialog.element.querySelector('button[data-action="yes"]').click();
    await waitFor(() => stateOf(tokenDoc).status === 'armed', 'armed status');
    return [assertion('hazard reset to armed', stateOf(tokenDoc).status === 'armed')];
  },

  // 9. GM: forced critical failure (no random roll): triggers the hazard and opens the prompt.
  async 'forced-crit-fail'(fixture) {
    const tokenDoc = sceneToken(fixture);
    const plan = basePlan(fixture);
    const before = stateOf(tokenDoc);
    const instance = before.instances.find(
      (i) => plan.components.find((c) => c.id === i.componentId)?.disables.length,
    );
    const disable = plan.components.find((c) => c.id === instance.componentId).disables[0];
    const request = {
      instanceKey: keyOf(instance),
      disableId: disable.id,
      degree: 0,
      messageId: 'live-critfail',
    };
    const events = await api().runner.apply(tokenDoc, request);
    const after = stateOf(tokenDoc);
    const prompt = await waitFor(() => openTriggeredPrompt(tokenDoc), 'triggered prompt');
    const again = await api().runner.apply(tokenDoc, request);
    const last = after.history.at(-1);
    const out = [
      assertion('starts armed', before.status === 'armed', before.status),
      assertion(
        'hazardTriggered event emitted',
        events.some((e) => e.type === 'hazardTriggered'),
        events,
      ),
      assertion('status is triggered', after.status === 'triggered', after.status),
      assertion('progress unchanged', totalProgress(after) === totalProgress(before)),
      assertion(
        'no instance disabled by a critical failure',
        after.instances.every((i) => !i.disabled),
      ),
      assertion(
        'history records the result',
        last?.kind === 'result' && last?.messageId === 'live-critfail',
        last,
      ),
      assertion('triggered prompt opened', !!prompt),
      assertion(
        'same messageId is ignored as duplicate',
        again.every((e) => e.type === 'ignored'),
        again,
      ),
    ];
    await closeTriggeredPrompts(fixture);
    return out;
  },

  // 10. GM: apply a scripted success, then the tracker's Undo button reverts it.
  async 'undo-button'(fixture) {
    const tokenDoc = sceneToken(fixture);
    const plan = basePlan(fixture);
    showChatTab();
    const before = stateOf(tokenDoc);
    const instance = before.instances.find(
      (i) => !i.disabled && plan.components.find((c) => c.id === i.componentId)?.disables.length,
    );
    const disable = plan.components.find((c) => c.id === instance.componentId).disables[0];
    await api().runner.apply(tokenDoc, {
      instanceKey: keyOf(instance),
      disableId: disable.id,
      degree: 2,
      messageId: 'live-undo',
    });
    const applied = stateOf(tokenDoc);
    const button = await waitFor(() => trackerButton(fixture, 'undo'), 'Undo button', 15000);
    button.click();
    await waitFor(
      () => stateOf(tokenDoc).history.length === before.history.length,
      'undo to revert the last result',
    );
    const after = stateOf(tokenDoc);
    return [
      assertion('scripted success added progress', totalProgress(applied) > totalProgress(before)),
      assertion('Undo reverted progress', totalProgress(after) === totalProgress(before), {
        before,
        after,
      }),
      assertion(
        'Undo restored disabled flags and status',
        after.status === before.status &&
          after.instances.every((i, n) => i.disabled === before.instances[n].disabled),
        after,
      ),
    ];
  },

  // 11. GM: two tokens of the same unlinked hazard share a skill+DC; an untagged matching check
  //     shows the GM picker, and picking applies to the chosen token only.
  async 'ambiguous-picker'(fixture) {
    const flags = { [MODULE]: { [MARKER]: fixture.runId } };
    const scene = game.scenes.get(fixture.scene);
    const actor = game.actors.get(fixture.hazardActor);
    const plan = basePlan(fixture);
    const disable = plan.components.flatMap((c) => c.disables).find((d) => d.skill && d.dc != null);
    const out = [assertion('plan has a disable with skill and DC', disable, plan.components)];
    const tokenData = (await actor.getTokenDocument({ x: 1100, y: 500 })).toObject();
    tokenData.flags = foundry.utils.mergeObject(tokenData.flags ?? {}, flags);
    tokenData.actorLink = false;
    const [second] = await scene.createEmbeddedDocuments('Token', [tokenData]);
    fixture.secondHazardToken = second.id;
    live().fixture = fixture;
    await api().startHazard(second);
    const first = sceneToken(fixture);
    if (stateOf(first).status === 'armed') await api().startHazard(first);
    out.push(
      assertion(
        'second (unlinked) token shares the base-actor plan',
        second.actor?.isToken && !second.delta?.toObject()?.flags?.[MODULE]?.plan,
      ),
    );
    showChatTab();
    const message = await ChatMessage.create({
      content: '<p>Hazarder live: untagged check</p>',
      speaker: ChatMessage.getSpeaker({ actor: game.actors.get(fixture.pcActor) }),
      flags: {
        ...flags,
        pf2e: {
          context: {
            type: 'skill-check',
            outcome: 'success',
            dc: { value: disable.dc },
            options: [`check:statistic:${disable.skill}`],
          },
        },
      },
    });
    const candidates = await waitFor(
      () => message.getFlag(MODULE, 'candidates'),
      'ambiguous candidates flag',
    );
    out.push(
      assertion(
        'candidates span both tokens',
        new Set(candidates.map((c) => c.tokenId)).size >= 2 &&
          candidates.some((c) => c.tokenId === second.id),
        candidates,
      ),
    );
    const buttons = await waitFor(() => {
      const nodes = document.querySelectorAll(
        `[data-message-id="${message.id}"] .hz-picker button`,
      );
      return nodes.length >= 2 ? [...nodes] : null;
    }, 'GM picker buttons');
    out.push(
      assertion(
        'GM picker shows one button per candidate',
        buttons.length === candidates.length,
        buttons.length,
      ),
    );
    const pick = candidates.findIndex((c) => c.tokenId === second.id);
    const secondBefore = totalProgress(stateOf(second));
    const firstBefore = totalProgress(stateOf(first));
    buttons[pick].click();
    await waitFor(() => message.getFlag(MODULE, 'applied') === true, 'picked result applied');
    out.push(
      assertion('picked token progressed', totalProgress(stateOf(second)) > secondBefore),
      assertion('other token unchanged', totalProgress(stateOf(first)) === firstBefore),
    );
    return out;
  },

  // 12. Delete combat, token and actors; nothing flagged remains.
  async cleanup(fixture) {
    await cleanup(fixture.runId);
    const remaining = leftovers(fixture.runId);
    return [
      assertion(
        'no QA documents remain',
        Object.values(remaining).every((ids) => !ids.length),
        remaining,
      ),
    ];
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
    if (app.id?.startsWith('hazarder-plan') || app instanceof foundry.applications.api.DialogV2)
      await app.close();
  }
  const pick = (collection) =>
    collection.filter((document) => owned(document, runId)).map((document) => document.id);
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
  const pick = (collection) =>
    collection.filter((document) => owned(document, runId)).map((document) => document.id);
  return {
    combats: pick(game.combats),
    scenes: pick(game.scenes),
    actors: pick(game.actors),
    messages: pick(game.messages),
  };
}
