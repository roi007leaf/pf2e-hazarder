import { STATUS, TAG_PREFIX } from '../constants.js';
import { instanceKey } from './RulesEngine.js';

export function buildTag(tokenId, componentId, index, disableId) {
  return `${TAG_PREFIX}${tokenId}:${componentId}:${index}:${disableId}`;
}

export function parseTag(options = []) {
  const tag = options.find((o) => typeof o === 'string' && o.startsWith(TAG_PREFIX));
  if (!tag) return null;
  const [tokenId, componentId, index, disableId] = tag.slice(TAG_PREFIX.length).split(':');
  if (!tokenId || !componentId || index === undefined || !disableId) return null;
  return { tokenId, instanceKey: instanceKey(componentId, Number(index)), disableId };
}

export function extractCheck(context = {}) {
  const options = Array.isArray(context.options) ? context.options : [];
  const stat = options.find(
    (o) => o.startsWith('check:statistic:') && !o.startsWith('check:statistic:base:'),
  );
  const dc = context.dc?.value;
  return {
    statistic: stat ? stat.slice('check:statistic:'.length) : null,
    dc: Number.isFinite(dc) ? dc : null,
    options,
  };
}

export function matchCheck(check, candidates) {
  const tagged = parseTag(check.options);
  if (tagged) return { kind: 'tagged', matches: [tagged] };
  if (!check.statistic || check.dc == null) return { kind: 'none', matches: [] };
  const matches = [];
  for (const { tokenId, plan, state } of candidates) {
    if (!plan || !state || state.status === STATUS.DISABLED) continue;
    for (const comp of plan.components) {
      for (const d of comp.disables) {
        if (d.skill !== check.statistic || d.dc !== check.dc) continue;
        for (const inst of state.instances) {
          if (inst.componentId !== comp.id || inst.disabled) continue;
          matches.push({ tokenId, instanceKey: instanceKey(comp.id, inst.index), disableId: d.id });
        }
      }
    }
  }
  if (matches.length === 0) return { kind: 'none', matches };
  return { kind: matches.length === 1 ? 'unique' : 'ambiguous', matches };
}
