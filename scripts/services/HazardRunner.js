import { MODULE_ID, OUTCOME_TO_DEGREE, STATUS } from '../constants.js';
import { getSystemFlags } from '../systemCompat.js';
import * as Engine from './RulesEngine.js';
import { extractCheck, matchCheck } from './RollMatcher.js';

const CHECK_TYPES = new Set(['skill-check', 'perception-check']);

export function defaultCandidates(store) {
  const seen = new Map();
  const add = (tokenDoc) => {
    if (!tokenDoc?.actor || tokenDoc.actor.type !== 'hazard' || seen.has(tokenDoc.id)) return;
    const { plan } = store.getOrDraftPlan(tokenDoc.actor);
    seen.set(tokenDoc.id, { tokenId: tokenDoc.id, tokenDoc, plan, state: store.getOrCreateState(tokenDoc, plan) });
  };
  for (const c of game.combat?.combatants ?? []) add(c.token);
  for (const t of canvas.scene?.tokens ?? []) {
    const s = t.getFlag(MODULE_ID, 'state');
    if (s && (s.status === STATUS.ACTIVE || s.status === STATUS.TRIGGERED)) add(t);
  }
  return [...seen.values()];
}

export class HazardRunner {
  constructor({ getCandidates, resolveToken, store, ui, isWriter, now }) {
    this.getCandidates = getCandidates;
    this.resolveToken = resolveToken;
    this.store = store;
    this.ui = ui;
    this.isWriter = isWriter;
    this.now = now;
  }

  async handleCheckMessage(message) {
    const skipped = { kind: 'skipped', applied: false };
    if (!this.isWriter()) return skipped;
    if (message.flags?.[MODULE_ID]?.applied) return skipped;
    const context = getSystemFlags(message)?.context ?? message.flags?.pf2e?.context;
    if (!context || !CHECK_TYPES.has(context.type)) return skipped;
    const degree = OUTCOME_TO_DEGREE[context.outcome];
    if (degree === undefined) return skipped;

    const result = matchCheck(extractCheck(context), this.getCandidates());
    if (result.kind === 'ambiguous') {
      await message.setFlag(MODULE_ID, 'candidates', result.matches);
      return { kind: 'ambiguous', applied: false };
    }
    if (result.kind === 'none') return { kind: 'none', applied: false };
    const [m] = result.matches;
    const tokenDoc = this.resolveToken(m.tokenId);
    if (!tokenDoc) return { kind: result.kind, applied: false };
    await this.apply(tokenDoc, {
      instanceKey: m.instanceKey,
      disableId: m.disableId,
      degree,
      actorUuid: message.speaker?.actor ?? null,
      messageId: message.id,
      userId: message.author?.id ?? null,
      isReroll: !!context.isReroll,
    });
    await message.setFlag(MODULE_ID, 'applied', true);
    return { kind: result.kind, applied: true };
  }

  async apply(tokenDoc, r) {
    const { plan } = this.store.getOrDraftPlan(tokenDoc.actor);
    const state = this.store.getOrCreateState(tokenDoc, plan);
    const { state: next, events } = Engine.applyResult(state, plan, { ...r, at: this.now() });
    await this.store.setState(tokenDoc, next);
    await this.#afterEvents(tokenDoc, plan, events);
    await this.ui.upsertTracker(tokenDoc);
    return events;
  }

  async #afterEvents(tokenDoc, plan, events) {
    for (const e of events) {
      if (e.type === 'hazardTriggered') await this.ui.showTriggered(tokenDoc, plan);
      if (e.type === 'hazardDisabled') {
        this.ui.notify(game.i18n.format('PF2E_HAZARDER.Disabled', { name: tokenDoc.name }));
        if (game.settings?.get(MODULE_ID, 'removeDisabledFromCombat')) {
          const combatant = game.combat?.combatants?.find((c) => c.tokenId === tokenDoc.id);
          if (combatant) await combatant.delete();
        }
      }
    }
  }

  async startHazard(tokenDoc) {
    const { plan } = this.store.getOrDraftPlan(tokenDoc.actor);
    const state = Engine.activate(this.store.getOrCreateState(tokenDoc, plan));
    await this.store.setState(tokenDoc, state);
    await this.ui.upsertTracker(tokenDoc);
    return state;
  }

  async undo(tokenDoc) {
    const { plan } = this.store.getOrDraftPlan(tokenDoc.actor);
    await this.store.setState(tokenDoc, Engine.undo(this.store.getOrCreateState(tokenDoc, plan), plan));
    await this.ui.upsertTracker(tokenDoc);
  }

  async reset(tokenDoc) {
    const { plan } = this.store.getOrDraftPlan(tokenDoc.actor);
    await this.store.setState(tokenDoc, Engine.reset(this.store.getOrCreateState(tokenDoc, plan), plan));
    await this.ui.upsertTracker(tokenDoc);
  }

  async overridePip(tokenDoc, instanceKey, disableId) {
    const { plan } = this.store.getOrDraftPlan(tokenDoc.actor);
    const state = this.store.getOrCreateState(tokenDoc, plan);
    const inst = state.instances.find((i) => Engine.instanceKey(i.componentId, i.index) === instanceKey);
    const disable = plan.components.find((c) => c.id === inst?.componentId)?.disables.find((d) => d.id === disableId);
    if (!inst || !disable) return;
    const need = disable.successesNeeded ?? 1;
    const have = inst.progress[disableId] ?? 0;
    const progress = have >= need ? 0 : have + 1;
    const { state: next, events } = Engine.override(state, plan, {
      instanceKey,
      disableId,
      progress,
      disabled: progress >= need,
    });
    await this.store.setState(tokenDoc, next);
    await this.#afterEvents(tokenDoc, plan, events);
    await this.ui.upsertTracker(tokenDoc);
  }
}
