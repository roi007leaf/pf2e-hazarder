// Ordered scenarios; each depends on the state left by the previous one.
// `role` selects which browser session executes the in-page step (see world.js `step`).
export const scenarios = [
  { name: 'import-and-combat', role: 'gm' },
  { name: 'review-dialog-save', role: 'gm' },
  { name: 'plan-confirmed-tracker', role: 'gm' },
  { name: 'hazard-turn-card', role: 'gm' },
  { name: 'player-rolls-disable', role: 'player' },
  { name: 'check-applied', role: 'gm' },
  { name: 'disable-remaining', role: 'gm' },
  { name: 'reset', role: 'gm' },
  { name: 'cleanup', role: 'gm' },
];
