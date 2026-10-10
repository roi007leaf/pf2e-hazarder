import { buildSaveRequest, toolbeltTargetHelper } from '../../scripts/integrations/toolbelt.js';

afterEach(() => {
  delete game.toolbelt;
  game.modules = new Map();
});

describe('toolbeltTargetHelper', () => {
  test('null when the module is missing or inactive', () => {
    expect(toolbeltTargetHelper()).toBeNull();
    game.modules = new Map([['pf2e-toolbelt', { active: false }]]);
    expect(toolbeltTargetHelper()).toBeNull();
  });

  test('null when Target Helper is disabled', () => {
    game.modules = new Map([['pf2e-toolbelt', { active: true }]]);
    game.toolbelt = { getToolSetting: () => false, api: { targetHelper: {} } };
    expect(toolbeltTargetHelper()).toBeNull();
  });

  test('returns the Target Helper api when enabled', () => {
    const api = { setMessageFlagTargets: jest.fn() };
    game.modules = new Map([['pf2e-toolbelt', { active: true }]]);
    game.toolbelt = {
      getToolSetting: (tool, key) => tool === 'targetHelper' && key === 'enabled',
      api: { targetHelper: api },
    };
    expect(toolbeltTargetHelper()).toBe(api);
  });
});

describe('buildSaveRequest', () => {
  const speaker = { alias: 'Faith' };

  test('plain save link without Toolbelt', () => {
    expect(
      buildSaveRequest({
        raw: '@Check[will|dc:25]',
        speaker,
        targetUuids: ['a'],
        targetHelper: null,
      }),
    ).toEqual({ content: '@Check[will|dc:25]', speaker });
  });

  test('sets explicit targets through the Toolbelt api', () => {
    const targetHelper = {
      setMessageFlagTargets: (data, uuids) => {
        data.flags = { 'pf2e-toolbelt': { targetHelper: { targets: uuids } } };
        return data;
      },
    };
    expect(
      buildSaveRequest({
        raw: '@Check[will|dc:25]',
        speaker,
        targetUuids: ['a', 'b'],
        targetHelper,
      }),
    ).toEqual({
      content: '@Check[will|dc:25]',
      speaker,
      flags: { 'pf2e-toolbelt': { targetHelper: { targets: ['a', 'b'] } } },
    });
  });

  test('no targets leaves target selection to Toolbelt', () => {
    const targetHelper = { setMessageFlagTargets: jest.fn() };
    buildSaveRequest({ raw: '@Check[will|dc:25]', speaker, targetUuids: [], targetHelper });
    expect(targetHelper.setMessageFlagTargets).not.toHaveBeenCalled();
  });
});
