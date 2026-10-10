import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  { ignores: ['coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  prettier,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        game: 'readonly',
        canvas: 'readonly',
        ui: 'readonly',
        Hooks: 'readonly',
        foundry: 'readonly',
        CONFIG: 'readonly',
        ChatMessage: 'readonly',
        fromUuid: 'readonly',
        fromUuidSync: 'readonly',
      },
    },
  },
];
