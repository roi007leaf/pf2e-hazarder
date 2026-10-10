import { DEGREE, STATE_VERSION, STATUS } from '../constants.js';

export const instanceKey = (componentId, index) => `${componentId}:${index}`;
const keyOf = (inst) => instanceKey(inst.componentId, inst.index);
const clone = (v) => structuredClone(v);
const needOf = (disable) => disable.successesNeeded ?? 1;
const findComponent = (plan, componentId) => plan.components.find((c) => c.id === componentId);
const findDisable = (plan, componentId, disableId) =>
  findComponent(plan, componentId)?.disables.find((d) => d.id === disableId);

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

function allDisabled(state) {
  return state.instances.length > 0 && state.instances.every((i) => i.disabled);
}

// Mutates and returns `state`: status is derived from the instance flags.
function normalize(state) {
  if (allDisabled(state)) state.status = STATUS.DISABLED;
  else if (state.status === STATUS.DISABLED) state.status = STATUS.ACTIVE;
  return state;
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
    for (const d of findComponent(plan, fresh.componentId)?.disables ?? []) {
      progress[d.id] = Math.min(needOf(d), prev.progress?.[d.id] ?? 0);
    }
    return { ...fresh, progress, disabled: prev.disabled };
  });
  return normalize(next);
}

export function activate(state) {
  if (state.status === STATUS.DISABLED) return state;
  return { ...clone(state), status: STATUS.ACTIVE };
}

// Reverts one history entry in place. `plan` is needed to recompute disabled flags.
function revertEntry(state, plan, entry) {
  if (entry.kind === 'reset') {
    state.instances = clone(entry.snapshot.instances);
    state.status = entry.snapshot.status;
    return;
  }
  const inst = state.instances.find((i) => keyOf(i) === entry.instanceKey);
  if (inst) {
    if (entry.kind === 'result') {
      if (entry.delta) inst.progress[entry.disableId] = Math.max(0, (inst.progress[entry.disableId] ?? 0) - entry.delta);
      if (entry.disabledSet) {
        const comp = findComponent(plan, inst.componentId);
        const meets = (comp?.disables ?? []).some((d) => (inst.progress[d.id] ?? 0) >= needOf(d));
        if (!meets) inst.disabled = false;
      }
    } else {
      if (entry.disableId && entry.progressDelta) {
        inst.progress[entry.disableId] = Math.max(0, (inst.progress[entry.disableId] ?? 0) - entry.progressDelta);
      }
      if (entry.disabledChange) inst.disabled = entry.disabledChange.from;
    }
  }
  if (entry.statusChange && state.status === entry.statusChange.to) state.status = entry.statusChange.from;
}

export function applyResult(state, plan, r) {
  const next = clone(state);
  let reverted = false;
  if (r.isReroll) {
    const idx = next.history.findLastIndex(
      (h) =>
        h.kind === 'result' &&
        h.instanceKey === r.instanceKey &&
        h.actorUuid === r.actorUuid &&
        h.disableId === r.disableId,
    );
    if (idx !== -1) {
      const [entry] = next.history.splice(idx, 1);
      revertEntry(next, plan, entry);
      normalize(next);
      reverted = true;
    }
  }
  const base = reverted ? next : state;
  const inst = next.instances.find((i) => keyOf(i) === r.instanceKey);
  if (!inst) return { state: base, events: [{ type: 'ignored', reason: 'unknown-instance', instanceKey: r.instanceKey }] };
  if (inst.disabled) {
    return { state: base, events: [{ type: 'ignored', reason: 'instance-disabled', instanceKey: r.instanceKey }] };
  }
  const disable = findDisable(plan, inst.componentId, r.disableId);
  if (!disable) return { state: base, events: [{ type: 'ignored', reason: 'unknown-disable', instanceKey: r.instanceKey }] };

  const prevStatus = next.status;
  const events = [];
  let delta = 0;
  let disabledSet = false;
  if (r.degree === DEGREE.CRIT_FAIL) {
    if (next.status === STATUS.ARMED || next.status === STATUS.RESET) next.status = STATUS.TRIGGERED;
    events.push({ type: 'hazardTriggered', instanceKey: r.instanceKey });
  } else {
    const add = r.degree === DEGREE.CRIT_SUCCESS ? 2 : r.degree === DEGREE.SUCCESS ? 1 : 0;
    const need = needOf(disable);
    const before = inst.progress[r.disableId] ?? 0;
    const after = Math.min(need, before + add);
    inst.progress[r.disableId] = after;
    delta = after - before;
    events.push({ type: 'progress', instanceKey: r.instanceKey, disableId: r.disableId, value: after });
    if (after >= need) {
      inst.disabled = true;
      disabledSet = true;
      events.push({ type: 'instanceDisabled', instanceKey: r.instanceKey });
    }
  }
  normalize(next);
  if (next.status === STATUS.DISABLED && prevStatus !== STATUS.DISABLED) events.push({ type: 'hazardDisabled' });
  next.history.push({
    kind: 'result',
    instanceKey: r.instanceKey,
    disableId: r.disableId,
    delta,
    disabledSet,
    statusChange: next.status !== prevStatus ? { from: prevStatus, to: next.status } : null,
    actorUuid: r.actorUuid,
    messageId: r.messageId,
    userId: r.userId,
    at: r.at,
  });
  return { state: next, events };
}

export function override(state, plan, { instanceKey: key, disableId, progress, disabled }) {
  const inst0 = state.instances.find((i) => keyOf(i) === key);
  if (!inst0) return { state, events: [{ type: 'ignored', reason: 'unknown-instance', instanceKey: key }] };
  const disable = disableId !== undefined ? findDisable(plan, inst0.componentId, disableId) : undefined;
  if (disableId !== undefined && !disable) {
    return { state, events: [{ type: 'ignored', reason: 'unknown-disable', instanceKey: key }] };
  }
  const next = clone(state);
  const inst = next.instances.find((i) => keyOf(i) === key);
  const prevStatus = next.status;
  const entry = {
    kind: 'override',
    instanceKey: key,
    disableId: disableId ?? null,
    progressDelta: 0,
    disabledChange: null,
    statusChange: null,
  };
  let target = disabled;
  if (disable && progress !== undefined) {
    const need = needOf(disable);
    const before = inst.progress[disableId] ?? 0;
    const after = Math.min(need, Math.max(0, progress));
    inst.progress[disableId] = after;
    entry.progressDelta = after - before;
    if (target === undefined && after >= need) target = true;
  }
  if (target !== undefined && target !== inst.disabled) {
    entry.disabledChange = { from: inst.disabled, to: target };
    inst.disabled = target;
  }
  normalize(next);
  if (next.status !== prevStatus) entry.statusChange = { from: prevStatus, to: next.status };
  const events = [];
  if (next.status === STATUS.DISABLED && prevStatus !== STATUS.DISABLED) events.push({ type: 'hazardDisabled' });
  next.history.push(entry);
  return { state: next, events };
}

export function undo(state, plan) {
  if (!state.history.length) return state;
  const next = clone(state);
  revertEntry(next, plan, next.history.pop());
  return normalize(next);
}

export function reset(state, plan) {
  const next = createInitialState(plan);
  next.history = [
    ...clone(state.history),
    { kind: 'reset', snapshot: { instances: clone(state.instances), status: state.status } },
  ];
  return next;
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
