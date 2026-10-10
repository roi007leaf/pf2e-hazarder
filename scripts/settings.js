import { MODULE_ID } from './constants.js';

export function registerSettings() {
  const common = { scope: 'world', config: true, type: Boolean };
  game.settings.register(MODULE_ID, 'publicFlavorCard', {
    ...common,
    name: 'PF2E_HAZARDER.Settings.PublicFlavorCard.Name',
    hint: 'PF2E_HAZARDER.Settings.PublicFlavorCard.Hint',
    default: false,
  });
  game.settings.register(MODULE_ID, 'skipDisabledTurns', {
    ...common,
    name: 'PF2E_HAZARDER.Settings.SkipDisabledTurns.Name',
    hint: 'PF2E_HAZARDER.Settings.SkipDisabledTurns.Hint',
    default: true,
  });
  game.settings.register(MODULE_ID, 'removeDisabledFromCombat', {
    ...common,
    name: 'PF2E_HAZARDER.Settings.RemoveDisabled.Name',
    hint: 'PF2E_HAZARDER.Settings.RemoveDisabled.Hint',
    default: false,
  });
  game.settings.register(MODULE_ID, 'debug', {
    scope: 'client',
    config: true,
    type: Boolean,
    name: 'PF2E_HAZARDER.Settings.Debug.Name',
    hint: 'PF2E_HAZARDER.Settings.Debug.Hint',
    default: false,
  });
}
