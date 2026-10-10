import hazards from '../fixtures/hazards.json';
import { draftPlan } from '../../scripts/parser/draftPlan.js';

const complex = hazards.filter((h) => h.system.details.isComplex);

test('parser never throws on any installed hazard', () => {
  for (const h of hazards) expect(() => draftPlan(h)).not.toThrow();
});

test('parse coverage on complex hazards', () => {
  const withActions = complex.filter((h) => draftPlan(h).plan.actionsPerTurn !== null);
  const withDisables = complex.filter((h) =>
    draftPlan(h).plan.components.some((c) => c.disables.length),
  );
  const missesA = complex.filter((h) => !withActions.includes(h)).map((h) => `${h.pack}/${h.name}`);
  const missesD = complex
    .filter((h) => !withDisables.includes(h))
    .map((h) => `${h.pack}/${h.name}`);
  console.log(
    `complex=${complex.length} actions=${withActions.length} disables=${withDisables.length}\n` +
      `no actions: ${missesA.join(', ')}\nno disables: ${missesD.join(', ')}`,
  );
  expect(withActions.length / complex.length).toBeGreaterThanOrEqual(0.85);
  expect(withDisables.length / complex.length).toBeGreaterThanOrEqual(0.85);
});
