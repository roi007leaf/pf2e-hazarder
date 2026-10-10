import { MODULE_ID } from '../constants.js';
import { buildTag } from '../services/RollMatcher.js';
import { getOrCreateState, getOrDraftPlan, getTrackerMessageId, setTrackerMessageId } from '../stores/hazardStore.js';
import { buildTrackerView } from './trackerView.js';

const TEMPLATE = `modules/${MODULE_ID}/templates/tracker-card.hbs`;

export async function renderTrackerContent(tokenDoc) {
  const { plan } = getOrDraftPlan(tokenDoc.actor);
  const state = getOrCreateState(tokenDoc, plan);
  const view = buildTrackerView({ name: tokenDoc.name, plan, state, isGM: game.user.isGM });
  return foundry.applications.handlebars.renderTemplate(TEMPLATE, { ...view, tokenUuid: tokenDoc.uuid });
}

export async function upsertTracker(tokenDoc) {
  const content = await renderTrackerContent(tokenDoc);
  const existing = game.messages.get(getTrackerMessageId(tokenDoc) ?? '');
  if (existing) {
    await existing.update({ content });
    return existing;
  }
  const msg = await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    flags: { [MODULE_ID]: { kind: 'tracker', tokenUuid: tokenDoc.uuid } },
  });
  await setTrackerMessageId(tokenDoc, msg.id);
  return msg;
}

export async function rollDisable({ tokenUuid, instanceKey, disableId }) {
  const tokenDoc = await fromUuid(tokenUuid);
  if (!tokenDoc?.actor) return;
  const { plan } = getOrDraftPlan(tokenDoc.actor);
  const [componentId, index] = instanceKey.split(':');
  const disable = plan.components.find((c) => c.id === componentId)?.disables.find((d) => d.id === disableId);
  if (!disable) return;
  const roller = canvas.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!roller) {
    ui.notifications.warn(game.i18n.localize('PF2E_HAZARDER.Tracker.NoActor'));
    return;
  }
  const statistic = roller.getStatistic(disable.skill);
  if (!statistic) return;
  await statistic.roll({
    dc: disable.dc != null ? { value: disable.dc } : undefined,
    extraRollOptions: [buildTag(tokenDoc.id, componentId, Number(index), disableId)],
    traits: disable.traits?.filter((t) => !t.includes(':')) ?? [],
  });
}
