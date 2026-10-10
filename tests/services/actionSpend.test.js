import { actionCost, saveRequestCost } from '../../scripts/services/actionSpend.js';

describe('actionCost', () => {
  test('a Strike attack roll costs one action', () => {
    expect(actionCost({ contextType: 'attack-roll' })).toBe(1);
  });
  test('an action card costs its action count', () => {
    expect(actionCost({ originType: 'action', actionType: 'action', actions: 2 })).toBe(2);
    expect(actionCost({ originType: 'action', actionType: 'action', actions: null })).toBe(1);
  });
  test('free actions, reactions and passives cost nothing', () => {
    expect(actionCost({ originType: 'action', actionType: 'free' })).toBe(0);
    expect(actionCost({ originType: 'action', actionType: 'reaction' })).toBe(0);
    expect(actionCost({ originType: 'action', actionType: 'passive' })).toBe(0);
  });
  test('damage rolls, checks and unrelated messages cost nothing', () => {
    expect(actionCost({ contextType: 'damage-roll' })).toBe(0);
    expect(actionCost({ contextType: 'saving-throw' })).toBe(0);
    expect(actionCost({})).toBe(0);
  });
  test('a Hazarder save request carries its own cost', () => {
    expect(actionCost({ hazarderCost: 3 })).toBe(3);
    expect(actionCost({ hazarderCost: 0, contextType: 'attack-roll' })).toBe(0);
  });
});

describe('saveRequestCost', () => {
  test('routine saves cost one action per target, at least one', () => {
    expect(saveRequestCost({ fromItem: null, targets: 3 })).toBe(3);
    expect(saveRequestCost({ fromItem: null, targets: 0 })).toBe(1);
  });
  test('saves from an action cost nothing extra (the action itself is counted)', () => {
    expect(saveRequestCost({ fromItem: { actionType: 'free' }, targets: 2 })).toBe(0);
    expect(saveRequestCost({ fromItem: { actionType: 'action', actions: 1 }, targets: 2 })).toBe(0);
  });
});
