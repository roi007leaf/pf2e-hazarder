const int = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const list = (obj) => (Array.isArray(obj) ? obj : Object.keys(obj ?? {}).sort((a, b) => a - b).map((k) => obj[k]));

export function planToContext(plan, warnings, actor) {
  return {
    plan,
    warnings: warnings.map((w) => `PF2E_HAZARDER.Warnings.${w}`),
    items: [...(actor.items ?? [])]
      .filter((i) => i.type === 'action' || i.type === 'melee')
      .map((i) => ({ id: i.id, name: i.name })),
  };
}

export function formToPlan(data, basePlan, { keepBlank = false } = {}) {
  const baseComps = new Map(basePlan.components.map((c) => [c.id, c]));
  const components = list(data.components).map((c, ci) => {
    const id = c.id || `c${ci + 1}`;
    const prev = baseComps.get(id);
    const prevDisables = new Map((prev?.disables ?? []).map((d) => [d.id, d]));
    const disables = list(c.disables)
      .filter((d) => keepBlank || (d.skill && String(d.skill).trim()))
      .map((d, di) => {
        const did = d.id || `d${di + 1}`;
        const skill = String(d.skill ?? '').trim();
        return {
          id: did,
          skill,
          dc: int(d.dc),
          label: (d.label && String(d.label).trim()) || skill,
          traits: d.id ? (prevDisables.get(did)?.traits ?? []) : [],
          successesNeeded: Math.max(1, int(d.successesNeeded) ?? 1),
        };
      });
    return {
      id,
      name: (c.name && String(c.name).trim()) || basePlan.components[0]?.name || id,
      count: Math.max(1, int(c.count) ?? 1),
      actionsEach: Math.max(0, int(c.actionsEach) ?? 0),
      disables,
      counteract: prev?.counteract ?? null,
    };
  });
  return {
    ...structuredClone(basePlan),
    confirmed: true,
    actionsPerTurn: int(data.actionsPerTurn),
    reactionItemId: data.reactionItemId || null,
    components,
  };
}
