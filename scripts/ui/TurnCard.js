import { MODULE_ID } from '../constants.js';
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

function describeItem(actor, item) {
  const base = { id: item.id, name: item.name };
  if (item.type === 'action' && item.system?.actionType?.value === 'passive') {
    return { ...base, passive: true };
  }
  if (item.type !== 'melee') return base;
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
    items: actor.items.map((i) => describeItem(actor, i)),
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
export async function postSaveRequest(tokenDoc, raw) {
  const targetUuids = [...(game.user.targets ?? [])].map((t) => t.document.uuid);
  const data = buildSaveRequest({
    raw,
    speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    targetUuids,
    targetHelper: toolbeltTargetHelper(),
  });
  return ChatMessage.create(data);
}
