import { MODULE_ID } from '../constants.js';
import { getOrCreateState, getOrDraftPlan } from '../stores/hazardStore.js';
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
  const routineHtml = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    actor.system.details.routine ?? '',
    { rollData: actor.getRollData(), relativeTo: actor },
  );
  const view = buildTurnView({
    name: tokenDoc.name,
    plan,
    state,
    routineHtml,
    items: actor.items.map((i) => describeItem(actor, i)),
  });
  const content = await render(`modules/${MODULE_ID}/templates/turn-card.hbs`, {
    ...view,
    tokenUuid: tokenDoc.uuid,
  });
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  const msg = await ChatMessage.create({
    content,
    whisper: gmIds,
    speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    flags: { [MODULE_ID]: { kind: 'turn' } },
  });
  if (game.settings.get(MODULE_ID, 'publicFlavorCard')) {
    await ChatMessage.create({
      content: `<p>${game.i18n.format('PF2E_HAZARDER.Turn.Flavor', { name: foundry.utils.escapeHTML(tokenDoc.name) })}</p>`,
      speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    });
  }
  return msg;
}
