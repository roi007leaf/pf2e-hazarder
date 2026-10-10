import { MODULE_ID, OUTCOME_TO_DEGREE, STATUS } from '../constants.js';
import { extractCheck, matchCheck } from '../services/RollMatcher.js';
import { getSystemFlags } from '../systemCompat.js';
import {
  baseActor,
  getOrDraftPlan,
  getPlan,
  getState,
  getTrackerMessageId,
} from '../stores/hazardStore.js';
import { PlanPanel } from '../ui/PlanPanel.js';
import { rollDisable } from '../ui/TrackerCard.js';
import {
  currentHazardPool,
  findStrike,
  postSaveRequest,
  postTurnCard,
  spendFromMessage,
} from '../ui/TurnCard.js';
import { decorateCombatTracker } from '../ui/combatTrackerPool.js';
import { decorateTurnCard, nextSpent } from '../ui/turnCardDom.js';
import { extractSaves } from '../ui/routineParts.js';
import { buildCheckRequest } from '../ui/checkRequest.js';
import {
  isHazardTurn,
  shouldPromptForPlan,
  shouldSkipTurn,
  trackerNeedsBump,
} from './predicates.js';

async function confirmReview(actor) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.format('PF2E_HAZARDER.Plan.Title', { name: actor.name }) },
    content: `<p>${game.i18n.format('PF2E_HAZARDER.Plan.Review', { name: foundry.utils.escapeHTML(actor.name) })}</p>`,
  });
}

function instanceLabel(tokenDoc, instanceKey) {
  const [componentId, index] = instanceKey.split(':');
  const comp = getOrDraftPlan(tokenDoc.actor).plan.components.find((c) => c.id === componentId);
  if (!comp) return instanceKey;
  return comp.count > 1 ? `${comp.name} ${Number(index) + 1}` : comp.name;
}

function bindApplyLater(runner, message, root) {
  // Covers checks rolled while no GM was online: the GM can apply them later.
  if (message.flags?.[MODULE_ID]?.applied || message.flags?.[MODULE_ID]?.candidates?.length) return;
  const context = getSystemFlags(message)?.context ?? message.flags?.pf2e?.context;
  if (!context || !['skill-check', 'perception-check'].includes(context.type)) return;
  if (matchCheck(extractCheck(context), runner.getCandidates()).kind === 'none') return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.classList.add('hazarder-card');
  btn.textContent = game.i18n.localize('PF2E_HAZARDER.Match.ApplyTo');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const res = await runner.handleCheckMessage(message);
    if (!res?.applied) btn.disabled = false;
  });
  root.append(btn);
}

function bindCandidatePicker(runner, message, root) {
  const candidates = message.flags?.[MODULE_ID]?.candidates;
  if (!candidates?.length || message.flags?.[MODULE_ID]?.applied) return;
  const context = getSystemFlags(message)?.context ?? message.flags?.pf2e?.context;
  const degree = OUTCOME_TO_DEGREE[context?.outcome];
  if (degree === undefined) return;
  const box = document.createElement('div');
  box.classList.add('hazarder-card', 'hz-picker');
  box.innerHTML = `<p>${game.i18n.localize('PF2E_HAZARDER.Match.ApplyTo')}</p>`;
  for (const c of candidates) {
    const tokenDoc = runner.resolveToken(c.tokenId);
    if (!tokenDoc) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${tokenDoc.name} · ${instanceLabel(tokenDoc, c.instanceKey)}`;
    btn.addEventListener('click', async () => {
      const buttons = box.querySelectorAll('button');
      buttons.forEach((b) => (b.disabled = true));
      let applied = false;
      try {
        const events = await runner.apply(tokenDoc, {
          instanceKey: c.instanceKey,
          disableId: c.disableId,
          degree,
          actorUuid: message.speaker?.actor ?? null,
          messageId: message.id,
          userId: message.author?.id ?? null,
          isReroll: !!context.isReroll,
        });
        if (events.some((e) => e.type !== 'ignored')) {
          applied = true;
          await message.setFlag(MODULE_ID, 'applied', true);
        }
      } finally {
        if (!applied) buttons.forEach((b) => (b.disabled = false));
      }
    });
    box.append(btn);
  }
  root.append(box);
}

async function onCardClick(runner, event) {
  const el = event.target.closest('[data-hz-action]');
  if (!el) return;
  // Buttons inside a <summary> must not also fold/unfold their block.
  if (el.tagName === 'BUTTON' && el.closest('summary')) event.preventDefault();
  const card = el.closest('[data-token-uuid]');
  const tokenUuid = el.dataset.tokenUuid ?? card?.dataset.tokenUuid;
  const action = el.dataset.hzAction;
  if (action === 'toggle-collapse') {
    el.closest('.hazarder-card')?.classList.toggle('hz-collapsed');
    return;
  }
  if (action === 'spend') {
    if (!game.user.isGM) return;
    const message = game.messages.get(el.closest('[data-message-id]')?.dataset.messageId ?? '');
    if (!message) return;
    const spent = message.getFlag(MODULE_ID, 'spent') ?? 0;
    return message.setFlag(MODULE_ID, 'spent', nextSpent(spent, Number(el.dataset.index)));
  }
  if (action === 'disable') {
    return rollDisable({
      tokenUuid,
      instanceKey: el.dataset.instanceKey,
      disableId: el.dataset.disableId,
    });
  }
  const tokenDoc = tokenUuid ? await fromUuid(tokenUuid) : null;
  if (!tokenDoc) return;
  if (action === 'save-targets') {
    if (!game.user.isGM) return;
    const source = el.dataset.itemId
      ? tokenDoc.actor?.items.get(el.dataset.itemId)?.system.description?.value
      : tokenDoc.actor?.system.details.routine;
    const save = extractSaves(source)[Number(el.dataset.saveIndex)];
    const fromItem = el.dataset.itemId ? tokenDoc.actor?.items.get(el.dataset.itemId) : null;
    return save ? postSaveRequest(tokenDoc, save.raw, fromItem) : undefined;
  }
  if (action === 'item-info')
    return tokenDoc.actor?.items.get(el.dataset.itemId)?.sheet.render(true);
  if (action === 'item') return tokenDoc.actor?.items.get(el.dataset.itemId)?.toMessage();
  if (action === 'strike' || action === 'strike-damage' || action === 'strike-critical') {
    const strike = findStrike(tokenDoc.actor, el.dataset.itemId);
    if (!strike) return;
    if (action === 'strike') return strike.variants?.[Number(el.dataset.variant)]?.roll({ event });
    return action === 'strike-damage' ? strike.damage?.({ event }) : strike.critical?.({ event });
  }
  if (!game.user.isGM) return;
  if (action === 'hazard-sheet') return tokenDoc.actor?.sheet.render(true);
  if (action === 'post-check') {
    const [componentId] = String(el.dataset.instanceKey).split(':');
    const disable = getOrDraftPlan(tokenDoc.actor)
      .plan.components.find((c) => c.id === componentId)
      ?.disables.find((d) => d.id === el.dataset.disableId);
    if (!disable) return;
    return ChatMessage.create({
      content: buildCheckRequest(disable),
      speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    });
  }
  if (!runner.isWriter()) {
    ui.notifications.warn(game.i18n.localize('PF2E_HAZARDER.Errors.NotActiveGM'));
    return;
  }
  if (action === 'tracker') return repostTracker(runner, tokenDoc);
  if (action === 'pip')
    return runner.overridePip(tokenDoc, el.dataset.instanceKey, el.dataset.disableId);
  if (action === 'undo') return runner.undo(tokenDoc);
  if (action === 'reset') {
    const resetText = getPlan(tokenDoc.actor)?.resetText ?? '';
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('PF2E_HAZARDER.Tracker.Reset') },
      content: `<p>${foundry.utils.escapeHTML(resetText)}</p>`,
    });
    if (ok) return runner.reset(tokenDoc);
    return;
  }
  if (action === 'plan') {
    const saved = await PlanPanel.open(tokenDoc.actor);
    if (saved) return runner.startHazard(tokenDoc);
  }
}

/** Move a hazard's disable tracker to the bottom of the chat log. */
async function repostTracker(runner, tokenDoc) {
  await game.messages.get(getTrackerMessageId(tokenDoc) ?? '')?.delete();
  return runner.startHazard(tokenDoc);
}

/**
 * PCs disable hazards on their own turns: keep each live hazard's tracker within reach.
 * Hazards that predate the module (no state yet) get their first tracker here too.
 */
async function bumpTrackers(runner, combat) {
  const messageIds = game.messages.contents.map((m) => m.id);
  for (const c of combat.combatants) {
    const token = c.token;
    if (c.actor?.type !== 'hazard' || !token) continue;
    const state = getState(token);
    const trackerId = game.messages.get(getTrackerMessageId(token) ?? '')?.id ?? null;
    if (!state || trackerNeedsBump({ messageIds, trackerId, status: state.status })) {
      if (state?.status === STATUS.DISABLED) continue;
      await repostTracker(runner, token);
    }
  }
}

export function registerHooks(runner) {
  Hooks.on('createCombatant', async (combatant) => {
    if (!runner.isWriter() || combatant.actor?.type !== 'hazard' || !combatant.token) return;
    if (shouldPromptForPlan(combatant.actor) && (await confirmReview(combatant.actor))) {
      await PlanPanel.open(combatant.actor);
    }
    // Before initiative the tracker would just be buried under initiative rolls; it is posted
    // when combat starts. A hazard added mid-fight (it just triggered) gets it right away.
    await runner.startHazard(combatant.token, { tracker: !!combatant.combat?.started });
  });

  Hooks.on('combatStart', async (combat) => {
    if (!runner.isWriter()) return;
    for (const c of combat.combatants) {
      if (c.actor?.type === 'hazard' && c.token) await runner.startHazard(c.token);
    }
  });

  Hooks.on('combatTurnChange', async (combat, prior, current) => {
    if (!runner.isWriter()) return;
    if (!isHazardTurn(combat)) {
      await bumpTrackers(runner, combat);
      return;
    }
    const state = getState(combat.combatant.token);
    if (state?.status === STATUS.DISABLED && game.settings.get(MODULE_ID, 'skipDisabledTurns')) {
      const isDisabledHazard = (c) =>
        c.actor?.type === 'hazard' && getState(c.token)?.status === STATUS.DISABLED;
      const allDisabled = combat.combatants.every(isDisabledHazard);
      if (shouldSkipTurn({ prior, current, isDisabledHazard: true, allDisabled })) {
        await combat.nextTurn();
        return;
      }
    }
    await postTurnCard(combat.combatant);
  });

  // Remaining hazard actions next to the hazard's name in the core tracker and PF2e HUD's tracker.
  // GMs can click the glyphs to spend/refund actions, same as on the turn card.
  const decorate = (root) => {
    const pool = currentHazardPool();
    const message = pool?.messageId ? game.messages.get(pool.messageId) : null;
    const onSpend =
      game.user.isGM && message
        ? (index) =>
            message.setFlag(
              MODULE_ID,
              'spent',
              nextSpent(message.getFlag(MODULE_ID, 'spent') ?? 0, index),
            )
        : null;
    decorateCombatTracker(root, pool, onSpend);
  };
  const refreshTrackers = foundry.utils.debounce(() => decorate(document.body), 50);
  Hooks.on('renderApplicationV2', (app, html) => {
    if (html?.querySelector?.('li.combatant[data-combatant-id]')) decorate(html);
  });
  Hooks.on('updateChatMessage', (message) => {
    if (message.flags?.[MODULE_ID]?.kind === 'turn') refreshTrackers();
  });
  Hooks.on('updateToken', (tokenDoc, changes) => {
    if (changes.flags?.[MODULE_ID]) refreshTrackers();
  });
  Hooks.on('updateCombat', () => refreshTrackers());

  Hooks.on('createChatMessage', (message) => {
    runner.handleCheckMessage(message);
    // Count spent actions on the GM client that created the message (no dependency on which GM
    // is "active"); messages authored by players fall back to the active GM.
    const byGM = message.author?.isGM;
    if (byGM ? message.isAuthor : runner.isWriter()) spendFromMessage(message);
  });

  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!game.user.isGM) {
      html.querySelectorAll('.hz-gm').forEach((el) => el.remove());
      // Respect pf2e's "show DCs to players" metagame setting (tracker content is rendered by the GM).
      if (game.pf2e?.settings?.metagame?.dcs === false) {
        html.querySelectorAll('.hz-dc').forEach((el) => el.remove());
      }
    }
    if (message.flags?.[MODULE_ID]?.kind === 'turn') {
      decorateTurnCard(html, {
        spent: message.getFlag(MODULE_ID, 'spent'),
        collapsed: message.getFlag(MODULE_ID, 'collapsed'),
      });
    }
    if (html.querySelector('.hazarder-card')) {
      html.addEventListener('click', (event) => onCardClick(runner, event));
    }
    if (runner.isWriter()) {
      bindCandidatePicker(runner, message, html);
      // Only offer "apply later" for messages older than this session's live handling.
      if (Date.now() - (message.timestamp ?? 0) > 5000) bindApplyLater(runner, message, html);
    }
  });

  // pf2e actor sheets are AppV1 (ActorSheetPF2e extends foundry.appv1.sheets.ActorSheet, baseApplication
  // "ActorSheet"), so v14 still fires getActorSheetHeaderButtons via ApplicationV1#_callHooks.
  Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
    if (!game.user.isGM || sheet.actor?.type !== 'hazard') return;
    buttons.unshift({
      label: game.i18n.localize('PF2E_HAZARDER.Plan.HeaderButton'),
      class: 'hazarder-plan',
      icon: 'fa-solid fa-list-check',
      onclick: () => PlanPanel.open(sheet.actor),
    });
  });

  Hooks.on('updateActor', async (actor, changes) => {
    if (!runner.isWriter() || actor.type !== 'hazard') return;
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.plan`)) return;
    // The plan lives on the base actor; re-sync every token of it (linked or unlinked) in view.
    const base = baseActor(actor);
    const tokens = canvas.scene?.tokens?.filter((t) => t.actorId === base.id) ?? [];
    for (const t of tokens) {
      if (getState(t)) await runner.startHazard(t);
    }
  });
}
