import * as store from './stores/hazardStore.js';
import { HazardRunner, defaultCandidates } from './services/HazardRunner.js';
import { upsertTracker } from './ui/TrackerCard.js';
import { showTriggered } from './ui/TriggeredPrompt.js';
import { PlanPanel } from './ui/PlanPanel.js';

export function createRunner() {
  return new HazardRunner({
    getCandidates: () => defaultCandidates(store),
    resolveToken: (id) =>
      canvas.scene?.tokens.get(id) ??
      game.combat?.combatants.find((c) => c.tokenId === id)?.token ??
      null,
    store,
    ui: { upsertTracker, showTriggered, notify: (t) => ui.notifications.info(t) },
    isWriter: () => !!game.users.activeGM?.isSelf,
    now: () => game.time.worldTime,
  });
}

export function buildApi(runner) {
  return {
    runner,
    openPlan: (actor) => PlanPanel.open(actor),
    startHazard: (tokenDoc) => runner.startHazard(tokenDoc),
  };
}
