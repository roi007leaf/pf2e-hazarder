import { MODULE_ID } from './constants.js';
import { detectSystem } from './systemCompat.js';
import { registerSettings } from './settings.js';
import { registerHooks } from './hooks/registration.js';
import { buildApi, createRunner } from './api.js';

Hooks.once('init', () => {
  detectSystem();
  registerSettings();
  const runner = createRunner();
  registerHooks(runner);
  game.modules.get(MODULE_ID).api = buildApi(runner);
  console.log(`${MODULE_ID} | Initialized`);
});
