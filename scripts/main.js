import { MODULE_ID } from './constants.js';
import { detectSystem } from './systemCompat.js';
import { registerSettings } from './settings.js';

Hooks.once('init', () => {
  detectSystem();
  registerSettings();
  console.log(`${MODULE_ID} | Initialized`);
});
