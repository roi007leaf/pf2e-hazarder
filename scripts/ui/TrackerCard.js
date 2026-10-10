import { MODULE_ID } from '../constants.js';
import { buildTag } from '../services/RollMatcher.js';
import {
  getOrCreateState,
  getOrDraftPlan,
  getTrackerMessageId,
  setTrackerMessageId,
} from '../stores/hazardStore.js';
import { buildTrackerView } from './trackerView.js';

const TEMPLATE = `modules/${MODULE_ID}/templates/tracker-card.hbs`;

export async function renderTrackerContent(tokenDoc) {
  const { plan } = getOrDraftPlan(tokenDoc.actor);
  const state = getOrCreateState(tokenDoc, plan);
  const view = buildTrackerView({ name: tokenDoc.name, plan, state, isGM: game.user.isGM });
  return foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    ...view,
    tokenUuid: tokenDoc.uuid,
  });
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
  const disable = plan.components
    .find((c) => c.id === componentId)
    ?.disables.find((d) => d.id === disableId);
  if (!disable) return;
  const controlled = canvas.tokens?.controlled?.[0]?.actor;
  const roller =
    typeof controlled?.getStatistic === 'function'
      ? controlled
      : (game.user.character ?? controlled);
  if (!roller) {
    ui.notifications.warn(game.i18n.localize('PF2E_HAZARDER.Tracker.NoActor'));
    return;
  }
  const statistic =
    typeof roller.getStatistic === 'function' ? roller.getStatistic(disable.skill) : null;
  if (!statistic) {
    ui.notifications.warn(
      game.i18n.format('PF2E_HAZARDER.Tracker.NoStatistic', {
        actor: roller.name,
        skill: disable.skill,
      }),
    );
    return;
  }
  const tag = buildTag(tokenDoc.id, componentId, Number(index), disableId);
  await statistic.roll(buildDisableRollParams(disable, tag));
}

/**
 * Mirrors pf2e's inline-check handler: every trait (including `action:<slug>`) becomes a roll
 * option, and only plain traits are passed as check traits.
 */
export function buildDisableRollParams(disable, tag) {
  const traits = disable.traits ?? [];
  return {
    dc: disable.dc != null ? { value: disable.dc, label: disable.label } : undefined,
    extraRollOptions: [...traits, tag],
    traits: traits.filter((t) => !t.includes(':')),
  };
}
