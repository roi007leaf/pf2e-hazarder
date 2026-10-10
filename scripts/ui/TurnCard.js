import { MODULE_ID } from '../constants.js';
import { actionCost, saveRequestCost } from '../services/actionSpend.js';
import { actionsRemaining } from '../services/RulesEngine.js';
import { getSystemFlags } from '../systemCompat.js';
import { getOrCreateState, getOrDraftPlan } from '../stores/hazardStore.js';
import { buildSaveRequest, toolbeltTargetHelper } from '../integrations/toolbelt.js';
import { extractSaves, splitRoutine } from './routineParts.js';
import { buildTurnView } from './turnView.js';

const render = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);

// Hazard Strikes can't go through item.toMessage(): pf2e routes melee items through its action
// macro, which only accepts characters and NPCs. Use the actor's prepared strike actions instead.
export function findStrike(actor, itemId) {
  return actor?.system?.actions?.find((a) => a.item?.id === itemId) ?? null;
}

// Characters of the Pathfinder action font used by pf2e's .action-glyph.
function actionGlyph(item) {
  const type = item.system?.actionType?.value;
  if (type === 'reaction') return 'R';
  if (type === 'free') return 'F';
  if (type === 'action') return String(item.system?.actions?.value ?? 1);
  return null;
}

function describeItem(actor, item) {
  const base = { id: item.id, name: item.name };
  if (item.type === 'action' && item.system?.actionType?.value === 'passive') {
    return { ...base, passive: true };
  }
  if (item.type !== 'melee') {
    const description = item.system?.description?.value ?? '';
    return { ...base, cost: actionGlyph(item), description, saves: extractSaves(description) };
  }
  const strike = findStrike(actor, item.id);
  if (!strike) return base;
  return {
    ...base,
    strike: {
      variants: (strike.variants ?? []).map((v) => v.label),
      hasDamage: typeof strike.damage === 'function',
    },
  };
}

export async function postTurnCard(combatant) {
  const tokenDoc = combatant.token;
  const actor = combatant.actor;
  if (!tokenDoc || !actor) return null;
  const { plan } = getOrDraftPlan(actor);
  const state = getOrCreateState(tokenDoc, plan);
  const rawRoutine = actor.system.details.routine ?? '';
  const { traits, intro, outcomes } = splitRoutine(rawRoutine);
  const enrich = (html) =>
    foundry.applications.ux.TextEditor.implementation.enrichHTML(html, {
      rollData: actor.getRollData(),
      relativeTo: actor,
    });
  const view = buildTurnView({
    name: tokenDoc.name,
    plan,
    state,
    routineHtml: await enrich(intro),
    outcomesHtml: outcomes ? await enrich(outcomes) : null,
    traits,
    saves: extractSaves(rawRoutine),
    round: game.combat?.started ? game.combat.round : null,
    items: await Promise.all(
      actor.items.map(async (i) => {
        const d = describeItem(actor, i);
        if (d.description == null) return d;
        const { description, ...rest } = d;
        return { ...rest, descriptionHtml: description ? await enrich(description) : null };
      }),
    ),
  });
  const content = await render(`modules/${MODULE_ID}/templates/turn-card.hbs`, {
    ...view,
    tokenUuid: tokenDoc.uuid,
  });
  await collapsePreviousTurnCard(tokenDoc);
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  const msg = await ChatMessage.create({
    content,
    whisper: gmIds,
    speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    flags: { [MODULE_ID]: { kind: 'turn' } },
  });
  await tokenDoc.setFlag(MODULE_ID, 'turnMessageId', msg.id);
  if (game.settings.get(MODULE_ID, 'publicFlavorCard')) {
    await ChatMessage.create({
      content: `<p>${game.i18n.format('PF2E_HAZARDER.Turn.Flavor', { name: foundry.utils.escapeHTML(tokenDoc.name) })}</p>`,
      speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    });
  }
  return msg;
}

/** Fold the hazard's previous turn card down to its header so the log stays short. */
async function collapsePreviousTurnCard(tokenDoc) {
  const previous = game.messages.get(tokenDoc.getFlag(MODULE_ID, 'turnMessageId') ?? '');
  if (previous && !previous.getFlag(MODULE_ID, 'collapsed')) {
    await previous.setFlag(MODULE_ID, 'collapsed', true);
  }
}

/** Post a routine's saving throw for the GM's current targets (upgraded by PF2e Toolbelt if active). */
export async function postSaveRequest(tokenDoc, raw, fromItem = null) {
  const targetUuids = [...(game.user.targets ?? [])].map((t) => t.document.uuid);
  const data = buildSaveRequest({
    raw,
    speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    targetUuids,
    targetHelper: toolbeltTargetHelper(),
  });
  foundry.utils.setProperty(data, `flags.${MODULE_ID}`, {
    kind: 'save-request',
    actionCost: saveRequestCost({ fromItem, targets: targetUuids.length }),
  });
  return ChatMessage.create(data);
}

let spendQueue = Promise.resolve();

/**
 * Count the actions a chat message represents against the acting hazard's current turn card.
 * Runs on the active GM only; serialized so quick successive messages don't overwrite each other.
 */
export function spendFromMessage(message) {
  spendQueue = spendQueue
    .then(() => applySpend(message))
    .catch((err) => console.error(`${MODULE_ID} |`, err));
  return spendQueue;
}

const debug = (...args) => {
  if (game.settings.get(MODULE_ID, 'debug')) console.log(`${MODULE_ID} | spend:`, ...args);
};

async function applySpend(message) {
  const combat = game.combat;
  const combatant = combat?.started ? combat.combatant : null;
  const tokenDoc = combatant?.token;
  if (!tokenDoc || tokenDoc.actor?.type !== 'hazard') {
    return debug('skip: not a hazard turn', message.id);
  }
  const speaker = message.speaker ?? {};
  const fromHazard = speaker.token
    ? speaker.token === tokenDoc.id
    : !!speaker.actor && speaker.actor === tokenDoc.actorId;
  if (!fromHazard) return debug('skip: message not from the acting hazard', speaker, tokenDoc.id);
  const flags = getSystemFlags(message) ?? {};
  if (flags.context?.isReroll) return debug('skip: reroll');
  const origin = flags.origin;
  const item = origin?.type === 'action' && origin.uuid ? fromUuidSync(origin.uuid) : null;
  const cost = actionCost({
    contextType: flags.context?.type,
    originType: origin?.type,
    actionType: item?.system?.actionType?.value,
    actions: item?.system?.actions?.value,
    hazarderCost: message.flags?.[MODULE_ID]?.actionCost,
  });
  if (!cost) {
    return debug('skip: costs no actions', {
      contextType: flags.context?.type,
      origin,
      actionType: item?.system?.actionType?.value,
    });
  }
  const turnMessage = game.messages.get(tokenDoc.getFlag(MODULE_ID, 'turnMessageId') ?? '');
  if (!turnMessage) return debug('skip: no turn card for this hazard');
  const { plan } = getOrDraftPlan(tokenDoc.actor);
  const max = actionsRemaining(getOrCreateState(tokenDoc, plan), plan) ?? 0;
  const spent = turnMessage.getFlag(MODULE_ID, 'spent') ?? 0;
  const next = Math.min(max, spent + cost);
  debug('apply', { cost, spent, next, max });
  if (next !== spent) await turnMessage.setFlag(MODULE_ID, 'spent', next);
}
