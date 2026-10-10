import { MODULE_ID, PLAN_VERSION, STATE_VERSION } from '../constants.js';
import { draftPlan } from '../parser/draftPlan.js';
import { createInitialState, syncStateToPlan } from '../services/RulesEngine.js';

const copy = (v) => structuredClone(v);

/**
 * Plans live on the world (base) actor. Unlinked hazard tokens have synthetic actors whose flags
 * are written into the token's ActorDelta, which would give every token its own plan.
 */
export function baseActor(actor) {
  if (!actor) return null;
  return actor.isToken ? (game.actors?.get(actor.id) ?? actor) : actor;
}

export function getPlan(actor) {
  const p = baseActor(actor)?.getFlag(MODULE_ID, 'plan');
  return p?.version === PLAN_VERSION ? copy(p) : null;
}

export async function setPlan(actor, plan) {
  await baseActor(actor).setFlag(MODULE_ID, 'plan', copy(plan));
}

export function getOrDraftPlan(actor) {
  const stored = getPlan(actor);
  if (stored) return { plan: stored, warnings: [], isDraft: !stored.confirmed };
  const { plan, warnings } = draftPlan(baseActor(actor).toObject());
  return { plan, warnings, isDraft: true };
}

export function getState(tokenDoc) {
  const s = tokenDoc?.getFlag(MODULE_ID, 'state');
  return s?.version === STATE_VERSION ? copy(s) : null;
}

export async function setState(tokenDoc, state) {
  await tokenDoc.setFlag(MODULE_ID, 'state', copy(state));
}

export function getOrCreateState(tokenDoc, plan) {
  const s = getState(tokenDoc);
  return s ? syncStateToPlan(s, plan) : createInitialState(plan);
}

export function getTrackerMessageId(tokenDoc) {
  return tokenDoc?.getFlag(MODULE_ID, 'trackerMessageId') ?? null;
}

export async function setTrackerMessageId(tokenDoc, id) {
  await tokenDoc.setFlag(MODULE_ID, 'trackerMessageId', id);
}
