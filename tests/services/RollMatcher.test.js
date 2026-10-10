import { buildTag, extractCheck, matchCheck, parseTag } from '../../scripts/services/RollMatcher.js';
import { createInitialState } from '../../scripts/services/RulesEngine.js';

const planOf = (count, disables) => ({ components: [{ id: 'c1', count, actionsEach: 0, disables }] });
const cand = (tokenId, plan, status = 'active') => ({ tokenId, plan, state: { ...createInitialState(plan), status } });
const thieveryPlan = planOf(1, [{ id: 'd1', skill: 'thievery', dc: 22, successesNeeded: 1 }]);

test('tag round-trips', () => {
  const tag = buildTag('tok1', 'c1', 2, 'd3');
  expect(tag).toBe('hazarder:instance:tok1:c1:2:d3');
  expect(parseTag(['x', tag])).toEqual({ tokenId: 'tok1', instanceKey: 'c1:2', disableId: 'd3' });
  expect(parseTag(['x'])).toBeNull();
});

test('extractCheck reads statistic and dc', () => {
  const ctx = { dc: { value: 22 }, options: ['check:statistic:base:thievery', 'check:statistic:thievery'] };
  expect(extractCheck(ctx)).toEqual({ statistic: 'thievery', dc: 22, options: ctx.options });
  expect(extractCheck({})).toEqual({ statistic: null, dc: null, options: [] });
});

test('tagged wins', () => {
  const check = { statistic: 'thievery', dc: 22, options: [buildTag('t1', 'c1', 0, 'd1')] };
  expect(matchCheck(check, [cand('t1', thieveryPlan)])).toEqual({
    kind: 'tagged',
    matches: [{ tokenId: 't1', instanceKey: 'c1:0', disableId: 'd1' }],
  });
});

test('unique skill + dc match', () => {
  const res = matchCheck({ statistic: 'thievery', dc: 22, options: [] }, [cand('t1', thieveryPlan)]);
  expect(res.kind).toBe('unique');
  expect(res.matches).toEqual([{ tokenId: 't1', instanceKey: 'c1:0', disableId: 'd1' }]);
});

test('multi-instance component is ambiguous', () => {
  const plan = planOf(3, [{ id: 'd1', skill: 'thievery', dc: 22, successesNeeded: 1 }]);
  const res = matchCheck({ statistic: 'thievery', dc: 22, options: [] }, [cand('t1', plan)]);
  expect(res.kind).toBe('ambiguous');
  expect(res.matches).toHaveLength(3);
});

test('two hazards same check is ambiguous', () => {
  const res = matchCheck({ statistic: 'thievery', dc: 22, options: [] }, [cand('t1', thieveryPlan), cand('t2', thieveryPlan)]);
  expect(res.kind).toBe('ambiguous');
});

test('disabled hazards and disabled instances are skipped', () => {
  const plan = planOf(2, [{ id: 'd1', skill: 'thievery', dc: 22, successesNeeded: 1 }]);
  const c = cand('t1', plan);
  c.state.instances[0].disabled = true;
  expect(matchCheck({ statistic: 'thievery', dc: 22, options: [] }, [c]).kind).toBe('unique');
  expect(matchCheck({ statistic: 'thievery', dc: 22, options: [] }, [cand('t1', thieveryPlan, 'disabled')]).kind).toBe('none');
});

test('wrong dc, missing statistic or missing dc is none', () => {
  expect(matchCheck({ statistic: 'thievery', dc: 23, options: [] }, [cand('t1', thieveryPlan)]).kind).toBe('none');
  expect(matchCheck({ statistic: null, dc: 22, options: [] }, [cand('t1', thieveryPlan)]).kind).toBe('none');
  expect(matchCheck({ statistic: 'thievery', dc: null, options: [] }, [cand('t1', thieveryPlan)]).kind).toBe('none');
});
