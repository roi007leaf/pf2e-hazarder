import { DEGREE, STATE_VERSION, STATUS } from '../constants.js';

export const instanceKey = (componentId, index) => `${componentId}:${index}`;
const keyOf = (inst) => instanceKey(inst.componentId, inst.index);
const clone = (v) => structuredClone(v);

function freshProgress(component) {
  return Object.fromEntries((component.disables ?? []).map((d) => [d.id, 0]));
}

function buildInstances(plan) {
  const out = [];
  for (const c of plan.components ?? []) {
    for (let index = 0; index < (c.count ?? 1); index++) {
      out.push({ componentId: c.id, index, progress: freshProgress(c), disabled: false });
    }
  }
  return out;
}

export function createInitialState(plan) {
  return { version: STATE_VERSION, status: STATUS.ARMED, instances: buildInstances(plan), history: [] };
}

export function syncStateToPlan(state, plan) {
  const next = clone(state);
  const old = new Map(state.instances.map((i) => [keyOf(i), i]));
  next.instances = buildInstances(plan).map((fresh) => {
    const prev = old.get(keyOf(fresh));
    if (!prev) return fresh;
    const progress = { ...fresh.progress };
    for (const id of Object.keys(progress)) progress[id] = prev.progress?.[id] ?? 0;
    return { ...fresh, progress, disabled: prev.disabled };
  });
  return next;
}

export function activate(state) {
  if (state.status === STATUS.DISABLED) return state;
  return { ...clone(state), status: STATUS.ACTIVE };
}

const findComponent = (plan, componentId) => plan.components.find((c) => c.id === componentId);

function allDisabled(state) {
  return state.instances.length > 0 && state.instances.every((i) => i.disabled);
}

function revertEntry(state, entry) {
  const inst = state.instances.find((i) => keyOf(i) === entry.instanceKey);
  if (inst) {
    if (entry.disableId && entry.prevProgress !== undefined) inst.progress[entry.disableId] = entry.prevProgress;
    inst.disabled = entry.prevDisabled;
  }
  state.status = entry.prevStatus;
}

export function applyResult(state, plan, r) {
  let next = clone(state);
  if (r.isReroll) {
    const idx = next.history.findLastIndex(
      (h) => h.kind === 'result' && h.instanceKey === r.instanceKey && h.actorUuid === r.actorUuid,
    );
    if (idx !== -1) {
      revertEntry(next, next.history[idx]);
      next.history.splice(idx, 1);
    }
  }
  const inst = next.instances.find((i) => keyOf(i) === r.instanceKey);
  if (!inst) return { state, events: [{ type: 'ignored', reason: 'unknown-instance', instanceKey: r.instanceKey }] };
  if (inst.disabled) {
    return { state: r.isReroll ? next : state, events: [{ type: 'ignored', reason: 'instance-disabled', instanceKey: r.instanceKey }] };
  }
  const disable = findComponent(plan, inst.componentId)?.disables.find((d) => d.id === r.disableId);
  if (!disable) return { state, events: [{ type: 'ignored', reason: 'unknown-disable', instanceKey: r.instanceKey }] };

  const entry = {
    kind: 'result',
    instanceKey: r.instanceKey,
    disableId: r.disableId,
    prevProgress: inst.progress[r.disableId] ?? 0,
    prevDisabled: inst.disabled,
    prevStatus: next.status,
    actorUuid: r.actorUuid,
    messageId: r.messageId,
    userId: r.userId,
    at: r.at,
  };
  const events = [];
  if (r.degree === DEGREE.CRIT_FAIL) {
    if (next.status === STATUS.ARMED || next.status === STATUS.RESET) next.status = STATUS.TRIGGERED;
    events.push({ type: 'hazardTriggered', instanceKey: r.instanceKey });
  } else {
    const delta = r.degree === DEGREE.CRIT_SUCCESS ? 2 : r.degree === DEGREE.SUCCESS ? 1 : 0;
    const need = disable.successesNeeded ?? 1;
    inst.progress[r.disableId] = Math.min(need, (inst.progress[r.disableId] ?? 0) + delta);
    events.push({ type: 'progress', instanceKey: r.instanceKey, disableId: r.disableId, value: inst.progress[r.disableId] });
    if (inst.progress[r.disableId] >= need) {
      inst.disabled = true;
      events.push({ type: 'instanceDisabled', instanceKey: r.instanceKey });
      if (allDisabled(next)) {
        next.status = STATUS.DISABLED;
        events.push({ type: 'hazardDisabled' });
      }
    }
  }
  next.history.push(entry);
  return { state: next, events };
}

export function override(state, plan, { instanceKey: key, disableId, progress, disabled }) {
  const next = clone(state);
  const inst = next.instances.find((i) => keyOf(i) === key);
  if (!inst) return { state, events: [{ type: 'ignored', reason: 'unknown-instance', instanceKey: key }] };
  const entry = {
    kind: 'override',
    instanceKey: key,
    disableId: disableId ?? null,
    prevProgress: disableId ? (inst.progress[disableId] ?? 0) : undefined,
    prevDisabled: inst.disabled,
    prevStatus: next.status,
  };
  if (disableId && progress !== undefined) inst.progress[disableId] = Math.max(0, progress);
  if (disabled !== undefined) inst.disabled = disabled;
  const events = [];
  if (allDisabled(next)) {
    if (next.status !== STATUS.DISABLED) events.push({ type: 'hazardDisabled' });
    next.status = STATUS.DISABLED;
  } else if (next.status === STATUS.DISABLED) {
    next.status = STATUS.ACTIVE;
  }
  next.history.push(entry);
  return { state: next, events };
}

export function undo(state) {
  if (!state.history.length) return state;
  const next = clone(state);
  revertEntry(next, next.history.pop());
  return next;
}

export function reset(state, plan) {
  return { ...createInitialState(plan), history: clone(state.history) };
}

export function disabledCount(state) {
  return state.instances.filter((i) => i.disabled).length;
}

export function actionsRemaining(state, plan) {
  if (plan.actionsPerTurn == null) return null;
  let lost = 0;
  for (const inst of state.instances) {
    if (inst.disabled) lost += findComponent(plan, inst.componentId)?.actionsEach ?? 0;
  }
  return Math.max(0, plan.actionsPerTurn - lost);
}
