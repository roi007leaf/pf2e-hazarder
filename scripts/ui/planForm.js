const int = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const list = (obj) => (Array.isArray(obj) ? obj : Object.keys(obj ?? {}).sort((a, b) => a - b).map((k) => obj[k]));

export function nextId(prefix, items) {
  let max = 0;
  for (const it of items ?? []) {
    const id = String(it?.id ?? '');
    const n = id.startsWith(prefix) && /^[0-9]+$/.test(id.slice(prefix.length)) ? Number(id.slice(prefix.length)) : 0;
    max = Math.max(max, n);
  }
  return `${prefix}${max + 1}`;
}

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
  const compRows = list(data.components);
  const compIds = compRows.filter((c) => c.id).map((c) => ({ id: c.id }));
  const components = compRows.map((c) => {
    const id = c.id || nextId('c', compIds);
    if (!c.id) compIds.push({ id });
    const prev = baseComps.get(id);
    const prevDisables = new Map((prev?.disables ?? []).map((d) => [d.id, d]));
    const rows = list(c.disables);
    const dIds = rows.filter((d) => d.id).map((d) => ({ id: d.id }));
    const disables = rows
      .filter((d) => keepBlank || (d.skill && String(d.skill).trim()))
      .map((d) => {
        const did = d.id || nextId('d', dIds);
        if (!d.id) dIds.push({ id: did });
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
      name: (c.name && String(c.name).trim()) || prev?.name || (keepBlank ? '' : id),
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
