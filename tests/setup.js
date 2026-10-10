global.game = {
  i18n: { lang: 'en', localize: (k) => k, format: (k) => k },
  user: { isGM: true, id: 'gm1' },
  users: { activeGM: { isSelf: true } },
  system: { id: 'pf2e' },
  settings: { get: () => null, set: () => {}, register: () => {} },
  modules: new Map(),
};
global.ui = { notifications: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } };
