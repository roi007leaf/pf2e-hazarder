import { MODULE_ID } from '../constants.js';
import { getOrCreateState, getOrDraftPlan } from '../stores/hazardStore.js';
import { buildTurnView } from './turnView.js';

const render = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);

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
    items: actor.items.map((i) => ({ id: i.id, name: i.name })),
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
      content: `<p>${game.i18n.format('PF2E_HAZARDER.Turn.Flavor', { name: tokenDoc.name })}</p>`,
      speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    });
  }
  return msg;
}
