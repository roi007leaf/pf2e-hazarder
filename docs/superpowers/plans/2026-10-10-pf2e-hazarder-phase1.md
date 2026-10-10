# PF2e Hazarder Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run complex PF2e/SF2e hazards in combat: parsed-and-confirmed hazard plans, a GM turn card with an action pool, a live disable tracker with multi-success components, and triggered/disabled/reset states.

**Architecture:** Pure core (parser, rules engine, roll matcher) with no Foundry globals, fully Jest-tested. A thin Foundry layer (stores, runner, hooks, ApplicationV2 + chat cards) wires it up. The active GM's client is the single writer: it observes every check chat message, matches it to a hazard instance, applies the result and re-renders the tracker card.

**Tech Stack:** Foundry VTT v14 module (ES modules, ApplicationV2 + HandlebarsApplicationMixin, Handlebars templates), pf2e 8.x / sf2e 1.x system APIs, Jest 30 + Babel (jsdom), ESLint 9 + Prettier, Husky. Tooling mirrors `../pf2e-afflictioner`.

**Spec:** `docs/superpowers/specs/2026-10-10-pf2e-hazarder-design.md`

## Global Constraints

- Module id: `pf2e-hazarder`. Foundry compatibility minimum `14`, verified `14`.
- Systems: `pf2e` minimum `8.0.0`; `sf2e` minimum `1.0.0`. System-namespaced message flags are read through `getSystemId()` (`pf2e` or `sf2e`).
- Plan stored at `actor.flags["pf2e-hazarder"].plan`, `version: 1`. State stored at `tokenDoc.flags["pf2e-hazarder"].state`, `version: 1`.
- Status values exactly: `armed`, `triggered`, `active`, `disabled`, `reset`.
- Degrees: crit success = +2 successes, success = +1, failure = 0, crit failure = trigger.
- Roll tag format exactly: `hazarder:instance:<tokenId>:<componentId>:<index>:<disableId>`.
- Parser never throws; unparseable pieces become empty fields plus a warning.
- Only the active GM (`game.users.activeGM?.isSelf`) writes hazard flags.
- Prettier: printWidth 100, singleQuote, trailingComma all, 2-space indent.
- All user-facing strings go through `game.i18n` with keys in `lang/en.json` under `PF2E_HAZARDER.*`.

## Review Focus

1. **Hazard with no parseable disables** (empty `disables`): tracker must render "No disable options — edit the plan" and never throw. Test in Task 9 (`buildTrackerView` empty-disables case).
2. **Same skill + DC on several instances or hazards**: must yield `ambiguous` and a GM picker, never an auto-apply. Test in Task 5 (`multi-instance component is ambiguous`, `two hazards same check is ambiguous`).
3. **Hero-point reroll** (`context.isReroll === true`): the earlier result from the same actor on the same instance must be replaced, not stacked. Test in Task 4 (`reroll replaces previous result`).
4. **Results after an instance is already disabled, or overshooting the requirement**: progress clamps at `successesNeeded`; results on disabled instances are ignored with an `ignored` event. Test in Task 4 (`clamps progress`, `ignores disabled instance`).
5. **Plan edited mid-combat** (count changed from 3 to 2): state must re-sync without losing progress on surviving instances and `actionsRemaining` floors at 0. Test in Task 4 (`syncStateToPlan keeps progress`, `actionsRemaining floors at zero`).

---

## File Structure

```
pf2e-hazarder/
  module.json                     manifest
  package.json, babel.config.cjs, eslint.config.mjs, .prettierrc.json, .gitignore, .husky/pre-commit
  lang/en.json                    strings
  styles/hazarder.css             card + panel styles
  templates/tracker-card.hbs      disable tracker chat card
  templates/turn-card.hbs         GM turn card
  templates/plan-panel.hbs        plan confirm panel form
  scripts/
    main.js                       init/ready wiring
    constants.js                  ids, statuses, degrees, tag prefix
    systemCompat.js               getSystemId / getSystemFlags
    settings.js                   module settings
    api.js                        public API (openPlan, startHazard)
    parser/inline.js              @Check / @UUID counteract / strip helpers
    parser/draftPlan.js           hazard source -> { plan, warnings }
    services/RulesEngine.js       pure state transitions
    services/RollMatcher.js       pure check -> instance matching
    services/HazardRunner.js      GM-side orchestration
    stores/hazardStore.js         flag read/write + migration
    ui/trackerView.js             pure tracker view-model
    ui/turnView.js                pure turn-card view-model
    ui/planForm.js                pure form <-> plan conversion
    ui/TrackerCard.js             post/update tracker message, button handlers
    ui/TurnCard.js                post GM turn card
    ui/PlanPanel.js               ApplicationV2 confirm panel
    ui/TriggeredPrompt.js         DialogV2 on trigger
    hooks/registration.js         all Hooks.on wiring
  tools/extract-hazard-fixtures.mjs   builds tests/fixtures/hazards.json from installed packs
  tests/setup.js, tests/fixtures/hazards.json, tests/**/*.test.js
  tests/live/                     live harness (Task 12)
```

---

### Task 1: Scaffold the module

**Files:**

- Create: `module.json`, `package.json`, `babel.config.cjs`, `eslint.config.mjs`, `.prettierrc.json`, `.gitignore`, `.husky/pre-commit`, `lang/en.json`, `styles/hazarder.css`, `scripts/main.js`, `scripts/constants.js`, `scripts/systemCompat.js`, `scripts/settings.js`, `tests/setup.js`
- Test: `tests/constants.test.js`

**Interfaces:**

- Produces: `MODULE_ID`, `PLAN_VERSION`, `STATE_VERSION`, `TAG_PREFIX`, `STATUS`, `DEGREE`, `OUTCOME_TO_DEGREE` from `scripts/constants.js`; `detectSystem()`, `getSystemId()`, `getSystemFlags(doc)` from `scripts/systemCompat.js`; `registerSettings()` and setting keys `publicFlavorCard` (Boolean, default false), `skipDisabledTurns` (Boolean, default true), `removeDisabledFromCombat` (Boolean, default false).

- [ ] **Step 1: Write manifest and tooling files**

`module.json`:

```json
{
  "id": "pf2e-hazarder",
  "title": "PF2e Hazarder",
  "description": "Run Pathfinder 2e and Starfinder 2e hazards: structured routines, action pools, multi-success disable tracking, triggered/disabled/reset states.",
  "version": "0.1.0",
  "compatibility": { "minimum": "14", "verified": "14" },
  "authors": [{ "name": "RoiLeaf", "discord": "RoiLeaf" }],
  "relationships": {
    "systems": [
      { "id": "pf2e", "type": "system", "compatibility": { "minimum": "8.0.0" } },
      { "id": "sf2e", "type": "system", "compatibility": { "minimum": "1.0.0" } }
    ]
  },
  "esmodules": ["scripts/main.js"],
  "styles": ["styles/hazarder.css"],
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }]
}
```

`package.json`:

```json
{
  "name": "pf2e-hazarder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "jest --maxWorkers=50%",
    "test:watch": "jest --watch",
    "lint": "eslint .",
    "format": "prettier --write .",
    "fixtures": "node tools/extract-hazard-fixtures.mjs",
    "test:live": "node tests/live/run.mjs",
    "prepare": "husky"
  },
  "devDependencies": {
    "@babel/core": "^7.28.3",
    "@babel/preset-env": "^7.28.3",
    "@eslint/js": "^9.35.0",
    "babel-jest": "^30.1.2",
    "eslint": "^9.35.0",
    "eslint-config-prettier": "^10.1.8",
    "globals": "^16.3.0",
    "husky": "^9.1.7",
    "jest": "^30.1.3",
    "jest-environment-jsdom": "^30.1.2",
    "playwright": "^1.63.0",
    "prettier": "^3.6.2"
  },
  "jest": {
    "testEnvironment": "jsdom",
    "setupFilesAfterEnv": ["<rootDir>/tests/setup.js"],
    "testMatch": ["**/tests/**/*.test.js"],
    "testPathIgnorePatterns": ["/node_modules/", "/tests/live/"]
  }
}
```

`babel.config.cjs`:

```js
module.exports = { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] };
```

`eslint.config.mjs`:

```js
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
```

`.prettierrc.json`:

```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "bracketSpacing": true,
  "arrowParens": "always"
}
```

`.gitignore`:

```
node_modules/
coverage/
artifacts/
```

`.husky/pre-commit`:

```
npm run lint && npm test
```

- [ ] **Step 2: Write the failing test**

`tests/setup.js`:

```js
global.game = {
  i18n: { lang: 'en', localize: (k) => k, format: (k) => k },
  user: { isGM: true, id: 'gm1' },
  users: { activeGM: { isSelf: true } },
  system: { id: 'pf2e' },
  settings: { get: () => null, set: () => {}, register: () => {} },
  modules: new Map(),
};
global.ui = { notifications: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } };
```

`tests/constants.test.js`:

```js
import { DEGREE, OUTCOME_TO_DEGREE, STATUS, TAG_PREFIX, MODULE_ID } from '../scripts/constants.js';

test('constants match the spec', () => {
  expect(MODULE_ID).toBe('pf2e-hazarder');
  expect(TAG_PREFIX).toBe('hazarder:instance:');
  expect(Object.values(STATUS).sort()).toEqual([
    'active',
    'armed',
    'disabled',
    'reset',
    'triggered',
  ]);
  expect(OUTCOME_TO_DEGREE.criticalSuccess).toBe(DEGREE.CRIT_SUCCESS);
  expect(OUTCOME_TO_DEGREE.criticalFailure).toBe(DEGREE.CRIT_FAIL);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm install && npx jest tests/constants.test.js`
Expected: FAIL with "Cannot find module '../scripts/constants.js'"

- [ ] **Step 4: Write implementation**

`scripts/constants.js`:

```js
export const MODULE_ID = 'pf2e-hazarder';
export const PLAN_VERSION = 1;
export const STATE_VERSION = 1;
export const TAG_PREFIX = 'hazarder:instance:';

export const STATUS = Object.freeze({
  ARMED: 'armed',
  TRIGGERED: 'triggered',
  ACTIVE: 'active',
  DISABLED: 'disabled',
  RESET: 'reset',
});

export const DEGREE = Object.freeze({ CRIT_FAIL: 0, FAIL: 1, SUCCESS: 2, CRIT_SUCCESS: 3 });

export const OUTCOME_TO_DEGREE = Object.freeze({
  criticalFailure: DEGREE.CRIT_FAIL,
  failure: DEGREE.FAIL,
  success: DEGREE.SUCCESS,
  criticalSuccess: DEGREE.CRIT_SUCCESS,
});
```

`scripts/systemCompat.js`:

```js
let systemId = null;

export function detectSystem() {
  systemId = game.system.id;
}

export function getSystemId() {
  return systemId || game.system?.id || 'pf2e';
}

export function getSystemFlags(doc) {
  return doc?.flags?.[getSystemId()];
}
```

`scripts/settings.js`:

```js
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
}
```

`scripts/main.js` (filled in by later tasks; start minimal):

```js
import { MODULE_ID } from './constants.js';
import { detectSystem } from './systemCompat.js';
import { registerSettings } from './settings.js';

Hooks.once('init', () => {
  detectSystem();
  registerSettings();
  console.log(`${MODULE_ID} | Initialized`);
});
```

`lang/en.json` (all keys used anywhere in this plan; later tasks reference these exact keys):

```json
{
  "PF2E_HAZARDER": {
    "Settings": {
      "PublicFlavorCard": {
        "Name": "Public hazard turn card",
        "Hint": "Also post a short public card when a hazard takes its turn."
      },
      "SkipDisabledTurns": {
        "Name": "Skip disabled hazards",
        "Hint": "Automatically advance past a disabled hazard's turn."
      },
      "RemoveDisabled": {
        "Name": "Remove disabled hazards from combat",
        "Hint": "Remove a hazard's combatant once every component is disabled."
      }
    },
    "Status": {
      "armed": "Armed",
      "triggered": "Triggered",
      "active": "Active",
      "disabled": "Disabled",
      "reset": "Reset"
    },
    "Tracker": {
      "Title": "{name}: Disable",
      "NoDisables": "No disable options — edit the plan",
      "Counteract": "Counteract with {spell} (rank {rank}, DC {dc})",
      "Undo": "Undo last",
      "Reset": "Reset hazard",
      "EditPlan": "Edit plan",
      "NoActor": "Select your token first."
    },
    "Turn": {
      "Title": "{name}'s turn",
      "Actions": "Actions: {remaining} / {total}",
      "DisabledNote": "{count} disabled",
      "Flavor": "{name} acts!"
    },
    "Plan": {
      "Title": "Hazard plan: {name}",
      "Review": "{name} has no confirmed plan. Review it now?",
      "Save": "Save plan",
      "ActionsPerTurn": "Actions per turn",
      "Component": "Component",
      "Count": "Count",
      "ActionsEach": "Actions lost per disabled instance",
      "Skill": "Skill",
      "DC": "DC",
      "Label": "Label",
      "SuccessesNeeded": "Successes needed",
      "AddComponent": "Add component",
      "AddDisable": "Add disable option",
      "Warnings": "Parser warnings"
    },
    "Warnings": {
      "actions-per-turn-missing": "Could not find \"(N actions)\" in the routine.",
      "no-disables": "No inline checks found in the disable text.",
      "successes-heuristic": "Successes needed guessed from wording — please verify.",
      "component-count-unknown": "Found a named component but not how many — set the count.",
      "parse-error": "The parser failed; fill the plan in by hand."
    },
    "Match": { "ApplyTo": "Apply to hazard…", "Applied": "Applied to {name}" },
    "Triggered": {
      "Title": "{name} triggered!",
      "Body": "A critical failure triggered the hazard. Post its reaction?",
      "Fire": "Post reaction"
    },
    "Disabled": "{name} is disabled."
  }
}
```

`styles/hazarder.css`:

```css
.hazarder-card .hz-component {
  margin: 4px 0;
}
.hazarder-card .hz-instance {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}
.hazarder-card .hz-instance.disabled {
  opacity: 0.5;
  text-decoration: line-through;
}
.hazarder-card .hz-pip {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid currentColor;
}
.hazarder-card .hz-pip.filled {
  background: currentColor;
}
.hazarder-card .hz-actions .hz-pip.spent {
  opacity: 0.25;
}
.hazarder-card button {
  flex: 0 0 auto;
  width: auto;
  line-height: 1.4;
}
.hazarder-plan .hz-warning {
  color: var(--color-level-warning, #c90);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/constants.test.js && npm run lint`
Expected: PASS, lint clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold pf2e-hazarder module"
```

---

### Task 2: Inline-roll parsing helpers

**Files:**

- Create: `scripts/parser/inline.js`
- Test: `tests/parser/inline.test.js`

**Interfaces:**

- Produces:
  - `stripHtml(html: string) => string` — tags removed, whitespace collapsed, trimmed; `''` for nullish.
  - `parseInlineChecks(html: string) => Array<{ skill: string, dc: number|null, label: string, traits: string[], index: number, end: number }>` — `index`/`end` are character offsets of the match in the _raw_ html.
  - `parseCounteracts(html: string) => Array<{ spellUuid: string, name: string, rank: number|null, dc: number|null }>`

- [ ] **Step 1: Write the failing test**

`tests/parser/inline.test.js`:

```js
import { parseCounteracts, parseInlineChecks, stripHtml } from '../../scripts/parser/inline.js';

describe('stripHtml', () => {
  test('removes tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello <strong>you</strong>\n there</p>')).toBe('Hello you there');
  });
  test('nullish gives empty string', () => {
    expect(stripHtml(undefined)).toBe('');
  });
});

describe('parseInlineChecks', () => {
  test('parses skill, dc, name and traits', () => {
    const html =
      '<p>@Check[thievery|dc:32|name:Disable Telekinetic Decoration|traits:action:disable-a-device] (master)</p>';
    const [c] = parseInlineChecks(html);
    expect(c).toMatchObject({
      skill: 'thievery',
      dc: 32,
      label: 'Disable Telekinetic Decoration',
      traits: ['action:disable-a-device'],
    });
  });
  test('supports type: key, brace label and comma traits', () => {
    const html = '@Check[type:religion|dc:35|traits:haunt,mechanical]{Religion (expert)}';
    const [c] = parseInlineChecks(html);
    expect(c).toMatchObject({
      skill: 'religion',
      dc: 35,
      label: 'Religion (expert)',
      traits: ['haunt', 'mechanical'],
    });
  });
  test('falls back to skill as label and null dc', () => {
    const [c] = parseInlineChecks('@Check[survival]');
    expect(c).toMatchObject({ skill: 'survival', dc: null, label: 'survival', traits: [] });
  });
  test('reports offsets in raw text', () => {
    const html = 'x @Check[athletics|dc:20] y';
    const [c] = parseInlineChecks(html);
    expect(html.slice(c.index, c.end)).toBe('@Check[athletics|dc:20]');
  });
  test('finds several checks', () => {
    expect(parseInlineChecks('@Check[a|dc:1] or @Check[b|dc:2]')).toHaveLength(2);
  });
});

describe('parseCounteracts', () => {
  test('parses spell uuid, rank and dc', () => {
    const html =
      '@UUID[Compendium.pf2e.spells-srd.Item.9HpwDN4MYQJnW0LG]{Dispel Magic} (6th rank; counteract DC 30) to counteract';
    expect(parseCounteracts(html)).toEqual([
      {
        spellUuid: 'Compendium.pf2e.spells-srd.Item.9HpwDN4MYQJnW0LG',
        name: 'Dispel Magic',
        rank: 6,
        dc: 30,
      },
    ]);
  });
  test('ignores non-spell uuids', () => {
    expect(
      parseCounteracts(
        '@UUID[Compendium.pf2e.equipment-srd.Item.x]{Rope} (1st rank; counteract DC 1)',
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/parser/inline.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

`scripts/parser/inline.js`:

```js
const CHECK_RE = /@Check\[([^\]]+)\](?:\{([^}]*)\})?/g;
const COUNTERACT_RE = /@UUID\[(Compendium\.[^\]]*spells[^\]]*)\]\{([^}]*)\}\s*\(([^)]*)\)/g;

export function stripHtml(html) {
  if (html == null) return '';
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseInlineChecks(html) {
  const out = [];
  if (!html) return out;
  for (const m of String(html).matchAll(CHECK_RE)) {
    const parts = m[1].split('|');
    const params = {};
    parts.forEach((part, i) => {
      const colon = part.indexOf(':');
      if (i === 0 && colon === -1) {
        params.type = part.trim();
        return;
      }
      if (colon === -1) return;
      params[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
    });
    if (!params.type) continue;
    const dc = Number.parseInt(params.dc, 10);
    out.push({
      skill: params.type,
      dc: Number.isFinite(dc) ? dc : null,
      label: params.name || (m[2] ? m[2].trim() : '') || params.type,
      traits: params.traits
        ? params.traits
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : [],
      index: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

export function parseCounteracts(html) {
  const out = [];
  if (!html) return out;
  for (const m of String(html).matchAll(COUNTERACT_RE)) {
    const rank = /(\d+)(?:st|nd|rd|th)\s+rank/i.exec(m[3]);
    const dc = /counteract\s+DC\s+(\d+)/i.exec(m[3]);
    out.push({
      spellUuid: m[1],
      name: m[2].trim(),
      rank: rank ? Number(rank[1]) : null,
      dc: dc ? Number(dc[1]) : null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/parser/inline.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/parser/inline.js tests/parser/inline.test.js
git commit -m "feat(parser): parse inline checks and counteract links"
```

---

### Task 3: Draft plan parser + real-data fixtures

**Files:**

- Create: `scripts/parser/draftPlan.js`, `tools/extract-hazard-fixtures.mjs`, `tests/fixtures/hazards.json` (generated)
- Test: `tests/parser/draftPlan.test.js`, `tests/parser/coverage.test.js`

**Interfaces:**

- Consumes: `stripHtml`, `parseInlineChecks`, `parseCounteracts` (Task 2); `PLAN_VERSION` (Task 1).
- Produces: `draftPlan(source) => { plan: Plan, warnings: string[] }` where `source` is an actor source object `{ name, system: { details: { isComplex, routine, disable, reset } }, items: [{ _id, type, name, system: { actionType: { value } } }] }` and `Plan` is:

  ```
  { version: 1, confirmed: false, actionsPerTurn: number|null,
    components: [{ id, name, count, actionsEach,
      disables: [{ id, skill, dc, label, traits, successesNeeded }],
      counteract: { spellUuid, name, rank, dc } | null }],
    reactionItemId: string|null, routineItemIds: string[], resetText: string, resetAfterSeconds: null }
  ```

  Warning codes exactly: `actions-per-turn-missing`, `no-disables`, `successes-heuristic`, `component-count-unknown`, `parse-error`.

- [ ] **Step 1: Write the fixture extractor**

`tools/extract-hazard-fixtures.mjs` (reads every installed pf2e pack, keeps hazard actors, writes minimal fields; set `FOUNDRY_APP` if Foundry is installed elsewhere):

```js
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FOUNDRY_APP =
  process.env.FOUNDRY_APP ?? 'C:/Program Files/Foundry Virtual Tabletop/resources/app';
const PACKS = process.env.PF2E_PACKS ?? path.resolve('../../systems/pf2e/packs');
const require = createRequire(import.meta.url);
const { ClassicLevel } = require(path.join(FOUNDRY_APP, 'node_modules/classic-level'));

const pick = (actor, items) => ({
  _id: actor._id,
  name: actor.name,
  system: {
    details: {
      isComplex: !!actor.system?.details?.isComplex,
      routine: actor.system?.details?.routine ?? '',
      disable: actor.system?.details?.disable ?? '',
      reset: actor.system?.details?.reset ?? '',
    },
  },
  items: items.map((i) => ({
    _id: i._id,
    type: i.type,
    name: i.name,
    system: { actionType: { value: i.system?.actionType?.value ?? null } },
  })),
});

const out = [];
for (const pack of fs.readdirSync(PACKS)) {
  const src = path.join(PACKS, pack);
  if (!fs.statSync(src).isDirectory()) continue;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hz-'));
  fs.cpSync(src, tmp, { recursive: true });
  const db = new ClassicLevel(tmp, { valueEncoding: 'json' });
  const actors = [];
  const items = new Map();
  try {
    for await (const [k, v] of db.iterator()) {
      if (k.startsWith('!actors!') && v.type === 'hazard') actors.push(v);
      else if (k.startsWith('!actors.items!')) items.set(k.slice('!actors.items!'.length), v);
    }
  } catch {
    // not a LevelDB pack
  } finally {
    await db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  for (const a of actors) {
    const own = (a.items ?? []).map((id) => items.get(`${a._id}.${id}`)).filter(Boolean);
    out.push({ pack, ...pick(a, own) });
  }
}
fs.mkdirSync('tests/fixtures', { recursive: true });
fs.writeFileSync('tests/fixtures/hazards.json', JSON.stringify(out, null, 1));
console.log(
  `wrote ${out.length} hazards (${out.filter((h) => h.system.details.isComplex).length} complex)`,
);
```

Run: `npm run fixtures`
Expected: `wrote N hazards (M complex)` with N ≥ 53 and M ≥ 16. Commit the JSON (pf2e system data is ORC/OGL open content).

- [ ] **Step 2: Write the failing unit tests**

`tests/parser/draftPlan.test.js`:

```js
import { draftPlan } from '../../scripts/parser/draftPlan.js';

const hazard = (details, items = [], name = 'Test Hazard') => ({
  name,
  system: { details: { isComplex: true, routine: '', disable: '', reset: '', ...details } },
  items,
});

test('actions per turn from routine', () => {
  const { plan, warnings } = draftPlan(
    hazard({ routine: '<p>(2 actions) On its initiative…</p>' }),
  );
  expect(plan.actionsPerTurn).toBe(2);
  expect(warnings).not.toContain('actions-per-turn-missing');
});

test('missing actions count on complex hazard warns', () => {
  const { plan, warnings } = draftPlan(hazard({ routine: 'It attacks.' }));
  expect(plan.actionsPerTurn).toBeNull();
  expect(warnings).toContain('actions-per-turn-missing');
});

test('simple hazard has null actions and no actions warning', () => {
  const { plan, warnings } = draftPlan(
    hazard({ isComplex: false, disable: '@Check[thievery|dc:18]' }),
  );
  expect(plan.actionsPerTurn).toBeNull();
  expect(warnings).not.toContain('actions-per-turn-missing');
});

test('disables come from inline checks on one implicit component', () => {
  const { plan } = draftPlan(
    hazard({
      routine: '(1 action)',
      disable:
        '@Check[thievery|dc:26|name:Stop Wheel] (expert) or @Check[thievery|dc:22|name:Erase Rune] (master)',
    }),
  );
  expect(plan.components).toHaveLength(1);
  expect(plan.components[0]).toMatchObject({
    id: 'c1',
    name: 'Test Hazard',
    count: 1,
    actionsEach: 0,
  });
  expect(
    plan.components[0].disables.map((d) => [d.id, d.skill, d.dc, d.label, d.successesNeeded]),
  ).toEqual([
    ['d1', 'thievery', 26, 'Stop Wheel', 1],
    ['d2', 'thievery', 22, 'Erase Rune', 1],
  ]);
});

test('"twice" after a check sets successesNeeded 2 with a warning', () => {
  const { plan, warnings } = draftPlan(
    hazard({
      routine: '(9 actions)',
      disable: '@Check[religion|dc:35]{Religion (expert)} twice to exorcise',
    }),
  );
  expect(plan.components[0].disables[0].successesNeeded).toBe(2);
  expect(warnings).toContain('successes-heuristic');
});

test('"twice" belonging to a later check does not leak backwards', () => {
  const { plan } = draftPlan(
    hazard({
      routine: '(1 action)',
      disable: '@Check[thievery|dc:37] to jam, or @Check[religion|dc:35] twice',
    }),
  );
  expect(plan.components[0].disables.map((d) => d.successesNeeded)).toEqual([1, 2]);
});

test('named component with per-instance actions', () => {
  const { plan, warnings } = draftPlan(
    hazard({
      routine:
        "(9 actions) Each of the mannequins uses three of the haunt's actions on each turn, and the haunt loses three actions each turn for every disabled or destroyed mannequin.",
      disable: '@Check[thievery|dc:37]',
    }),
  );
  expect(plan.components[0]).toMatchObject({ name: 'mannequin', actionsEach: 3, count: 1 });
  expect(warnings).toContain('component-count-unknown');
});

test('no inline checks warns no-disables', () => {
  const { plan, warnings } = draftPlan(hazard({ routine: '(1 action)', disable: 'Smash it.' }));
  expect(plan.components[0].disables).toEqual([]);
  expect(warnings).toContain('no-disables');
});

test('counteract attaches to the component', () => {
  const { plan } = draftPlan(
    hazard({
      routine: '(1 action)',
      disable:
        '@UUID[Compendium.pf2e.spells-srd.Item.abc]{Dispel Magic} (4th rank; counteract DC 22) to counteract each rune',
    }),
  );
  expect(plan.components[0].counteract).toEqual({
    spellUuid: 'Compendium.pf2e.spells-srd.Item.abc',
    name: 'Dispel Magic',
    rank: 4,
    dc: 22,
  });
});

test('reaction and routine items', () => {
  const { plan } = draftPlan(
    hazard({ routine: '(1 action)' }, [
      { _id: 'r1', type: 'action', name: 'Awaken', system: { actionType: { value: 'reaction' } } },
      { _id: 'm1', type: 'melee', name: 'Fist', system: { actionType: { value: null } } },
      { _id: 'a1', type: 'action', name: 'Submerge', system: { actionType: { value: 'free' } } },
    ]),
  );
  expect(plan.reactionItemId).toBe('r1');
  expect(plan.routineItemIds).toEqual(['m1', 'a1']);
});

test('defaults and reset text', () => {
  const { plan } = draftPlan(
    hazard({ routine: '(1 action)', reset: '<p>Resets after 1 minute.</p>' }),
  );
  expect(plan).toMatchObject({
    version: 1,
    confirmed: false,
    resetText: 'Resets after 1 minute.',
    resetAfterSeconds: null,
  });
});

test('never throws on garbage', () => {
  const { plan, warnings } = draftPlan({ name: 'X', system: null, items: 'nope' });
  expect(plan.components).toHaveLength(1);
  expect(warnings).toContain('parse-error');
});
```

`tests/parser/coverage.test.js`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest tests/parser`
Expected: FAIL with "Cannot find module '../../scripts/parser/draftPlan.js'"

- [ ] **Step 4: Write implementation**

`scripts/parser/draftPlan.js`:

```js
import { PLAN_VERSION } from '../constants.js';
import { parseCounteracts, parseInlineChecks, stripHtml } from './inline.js';

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : (WORD_NUM[s.toLowerCase()] ?? null));

function emptyComponent(name) {
  return { id: 'c1', name, count: 1, actionsEach: 0, disables: [], counteract: null };
}

function basePlan(name) {
  return {
    version: PLAN_VERSION,
    confirmed: false,
    actionsPerTurn: null,
    components: [emptyComponent(name)],
    reactionItemId: null,
    routineItemIds: [],
    resetText: '',
    resetAfterSeconds: null,
  };
}

function successesAfter(rawDisable, check, nextIndex) {
  const tail = stripHtml(rawDisable.slice(check.end, nextIndex)).split(/[,;]|\bor\b/)[0];
  if (/\btwice\b/i.test(tail)) return 2;
  const m = /\b(\d+|two|three|four|five|six)\s+times\b/i.exec(tail);
  return m ? toNum(m[1]) : 1;
}

function parseComponent(routineText) {
  const each = /uses\s+(\d+|one|two|three|four|five|six)\s+of\s+the\s+[\w'’ ]*?actions/i.exec(
    routineText,
  );
  const noun =
    /every\s+disabled(?:\s+or\s+destroyed)?\s+(\w+)/i.exec(routineText) ??
    /each\s+(?:of\s+the\s+)?(\w+?)s?\s+uses/i.exec(routineText);
  if (!each || !noun) return null;
  return { name: noun[1].toLowerCase(), actionsEach: toNum(each[1]) ?? 0 };
}

export function draftPlan(source) {
  const name = source?.name ?? 'Hazard';
  const warnings = [];
  try {
    const details = source.system.details;
    const plan = basePlan(name);
    const routineText = stripHtml(details.routine);
    const rawDisable = String(details.disable ?? '');

    const apt = /^\s*\(\s*(\d+)\s+actions?\s*\)/i.exec(routineText);
    if (details.isComplex) {
      if (apt) plan.actionsPerTurn = Number(apt[1]);
      else warnings.push('actions-per-turn-missing');
    }

    const component = plan.components[0];
    const named = details.isComplex ? parseComponent(routineText) : null;
    if (named) {
      component.name = named.name;
      component.actionsEach = named.actionsEach;
      warnings.push('component-count-unknown');
    }

    const checks = parseInlineChecks(rawDisable);
    checks.forEach((c, i) => {
      const next = checks[i + 1]?.index ?? rawDisable.length;
      const successesNeeded = successesAfter(rawDisable, c, next) ?? 1;
      if (successesNeeded > 1 && !warnings.includes('successes-heuristic')) {
        warnings.push('successes-heuristic');
      }
      component.disables.push({
        id: `d${i + 1}`,
        skill: c.skill,
        dc: c.dc,
        label: c.label,
        traits: c.traits,
        successesNeeded,
      });
    });
    if (!checks.length) warnings.push('no-disables');

    component.counteract = parseCounteracts(rawDisable)[0] ?? null;

    const items = Array.isArray(source.items) ? source.items : [];
    const isReaction = (i) => i.type === 'action' && i.system?.actionType?.value === 'reaction';
    plan.reactionItemId = items.find(isReaction)?._id ?? null;
    plan.routineItemIds = items
      .filter((i) => (i.type === 'melee' || i.type === 'action') && !isReaction(i))
      .map((i) => i._id);
    plan.resetText = stripHtml(details.reset);
    return { plan, warnings };
  } catch {
    return { plan: basePlan(name), warnings: [...warnings, 'parse-error'] };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/parser`
Expected: PASS. The coverage test prints counts and misses. If a ratio is under 0.85, read the printed misses, open those hazards in `tests/fixtures/hazards.json`, and extend the regexes in `draftPlan.js` (add a unit test per new pattern). Do not lower the 0.85 threshold.

- [ ] **Step 6: Commit**

```bash
git add scripts/parser/draftPlan.js tools/extract-hazard-fixtures.mjs tests/fixtures/hazards.json tests/parser
git commit -m "feat(parser): draft hazard plans from routine/disable text with real-data coverage test"
```

---

### Task 4: Rules engine

**Files:**

- Create: `scripts/services/RulesEngine.js`
- Test: `tests/services/RulesEngine.test.js`

**Interfaces:**

- Consumes: `STATUS`, `DEGREE`, `STATE_VERSION` (Task 1); `Plan` shape (Task 3).
- Produces (all pure; never mutate inputs; return new objects):
  - `instanceKey(componentId: string, index: number) => string` → `"c1:0"`
  - `createInitialState(plan) => State` — `{ version: 1, status: 'armed', instances: [{ componentId, index, progress: { [disableId]: 0 }, disabled: false }], history: [] }`
  - `syncStateToPlan(state, plan) => State`
  - `activate(state) => State` — status `active` unless `disabled`
  - `applyResult(state, plan, r) => { state, events }` where `r = { instanceKey, disableId, degree, actorUuid, messageId, userId, isReroll, at }`; events are objects with `type` one of `ignored`, `progress`, `instanceDisabled`, `hazardDisabled`, `hazardTriggered`
  - `override(state, plan, { instanceKey, disableId, progress?, disabled? }) => { state, events }`
  - `undo(state) => State` (callers may pass `plan` as a second argument; it is ignored)
  - `reset(state, plan) => State` — fresh instances, status `armed`, history kept
  - `actionsRemaining(state, plan) => number|null`
  - `disabledCount(state) => number`

- [ ] **Step 1: Write the failing tests**

`tests/services/RulesEngine.test.js`:

```js
import {
  actionsRemaining,
  activate,
  applyResult,
  createInitialState,
  disabledCount,
  instanceKey,
  override,
  reset,
  syncStateToPlan,
  undo,
} from '../../scripts/services/RulesEngine.js';
import { DEGREE } from '../../scripts/constants.js';

const plan = {
  actionsPerTurn: 9,
  components: [
    {
      id: 'c1',
      name: 'mannequin',
      count: 3,
      actionsEach: 3,
      disables: [
        { id: 'd1', skill: 'thievery', dc: 37, successesNeeded: 1 },
        { id: 'd2', skill: 'religion', dc: 35, successesNeeded: 2 },
      ],
    },
  ],
};
const r = (over = {}) => ({
  instanceKey: 'c1:0',
  disableId: 'd2',
  degree: DEGREE.SUCCESS,
  actorUuid: 'Actor.a',
  messageId: 'm1',
  userId: 'u1',
  isReroll: false,
  at: 1,
  ...over,
});

test('initial state', () => {
  const s = createInitialState(plan);
  expect(s.status).toBe('armed');
  expect(s.instances).toHaveLength(3);
  expect(s.instances[0]).toEqual({
    componentId: 'c1',
    index: 0,
    progress: { d1: 0, d2: 0 },
    disabled: false,
  });
  expect(instanceKey('c1', 2)).toBe('c1:2');
});

test('success adds one, crit success adds two and disables', () => {
  let s = activate(createInitialState(plan));
  ({ state: s } = applyResult(s, plan, r()));
  expect(s.instances[0].progress.d2).toBe(1);
  expect(s.instances[0].disabled).toBe(false);
  const res = applyResult(s, plan, r({ degree: DEGREE.CRIT_SUCCESS, messageId: 'm2' }));
  expect(res.state.instances[0].progress.d2).toBe(2);
  expect(res.state.instances[0].disabled).toBe(true);
  expect(res.events.map((e) => e.type)).toContain('instanceDisabled');
});

test('clamps progress at successesNeeded', () => {
  const { state } = applyResult(
    createInitialState(plan),
    plan,
    r({ disableId: 'd1', degree: DEGREE.CRIT_SUCCESS }),
  );
  expect(state.instances[0].progress.d1).toBe(1);
});

test('failure changes nothing', () => {
  const { state, events } = applyResult(createInitialState(plan), plan, r({ degree: DEGREE.FAIL }));
  expect(state.instances[0].progress.d2).toBe(0);
  expect(events.map((e) => e.type)).toEqual(['progress']);
});

test('crit failure triggers an armed hazard', () => {
  const { state, events } = applyResult(
    createInitialState(plan),
    plan,
    r({ degree: DEGREE.CRIT_FAIL }),
  );
  expect(state.status).toBe('triggered');
  expect(events.map((e) => e.type)).toContain('hazardTriggered');
});

test('crit failure on an active hazard keeps it active but emits trigger', () => {
  const { state, events } = applyResult(
    activate(createInitialState(plan)),
    plan,
    r({ degree: DEGREE.CRIT_FAIL }),
  );
  expect(state.status).toBe('active');
  expect(events.map((e) => e.type)).toContain('hazardTriggered');
});

test('ignores disabled instance', () => {
  let { state } = applyResult(createInitialState(plan), plan, r({ disableId: 'd1' }));
  const res = applyResult(state, plan, r({ disableId: 'd2', messageId: 'm9' }));
  expect(res.events).toEqual([
    { type: 'ignored', reason: 'instance-disabled', instanceKey: 'c1:0' },
  ]);
  expect(res.state).toEqual(state);
});

test('all instances disabled disables hazard', () => {
  let s = activate(createInitialState(plan));
  let events = [];
  for (const i of [0, 1, 2])
    ({ state: s, events } = applyResult(
      s,
      plan,
      r({ instanceKey: `c1:${i}`, disableId: 'd1', messageId: `m${i}` }),
    ));
  expect(s.status).toBe('disabled');
  expect(events.map((e) => e.type)).toContain('hazardDisabled');
  expect(disabledCount(s)).toBe(3);
});

test('reroll replaces previous result from same actor on same instance', () => {
  let { state } = applyResult(createInitialState(plan), plan, r({ degree: DEGREE.SUCCESS }));
  ({ state } = applyResult(
    state,
    plan,
    r({ degree: DEGREE.FAIL, isReroll: true, messageId: 'm2' }),
  ));
  expect(state.instances[0].progress.d2).toBe(0);
  expect(state.history.filter((h) => h.kind === 'result')).toHaveLength(1);
});

test('undo reverts the last result including disabled flag and status', () => {
  let s = activate(
    createInitialState({ ...plan, components: [{ ...plan.components[0], count: 1 }] }),
  );
  const p1 = { ...plan, components: [{ ...plan.components[0], count: 1 }] };
  ({ state: s } = applyResult(s, p1, r({ disableId: 'd1' })));
  expect(s.status).toBe('disabled');
  s = undo(s, p1);
  expect(s.status).toBe('active');
  expect(s.instances[0]).toMatchObject({ disabled: false, progress: { d1: 0 } });
});

test('override sets progress and disabled with undo support', () => {
  let { state } = override(createInitialState(plan), plan, {
    instanceKey: 'c1:1',
    disableId: 'd2',
    progress: 1,
  });
  expect(state.instances[1].progress.d2).toBe(1);
  ({ state } = override(state, plan, { instanceKey: 'c1:1', disabled: true }));
  expect(state.instances[1].disabled).toBe(true);
  state = undo(state, plan);
  expect(state.instances[1].disabled).toBe(false);
});

test('actionsRemaining subtracts disabled instances and floors at zero', () => {
  let s = createInitialState(plan);
  expect(actionsRemaining(s, plan)).toBe(9);
  ({ state: s } = applyResult(s, plan, r({ disableId: 'd1' })));
  expect(actionsRemaining(s, plan)).toBe(6);
  const greedy = { ...plan, actionsPerTurn: 2 };
  expect(actionsRemaining(s, greedy)).toBe(0);
  expect(actionsRemaining(s, { ...plan, actionsPerTurn: null })).toBeNull();
});

test('syncStateToPlan keeps progress on surviving instances', () => {
  let { state } = applyResult(createInitialState(plan), plan, r({ instanceKey: 'c1:0' }));
  const smaller = { ...plan, components: [{ ...plan.components[0], count: 2 }] };
  const synced = syncStateToPlan(state, smaller);
  expect(synced.instances).toHaveLength(2);
  expect(synced.instances[0].progress.d2).toBe(1);
  const bigger = {
    ...plan,
    components: [
      {
        ...plan.components[0],
        count: 4,
        disables: [...plan.components[0].disables, { id: 'd3', successesNeeded: 1 }],
      },
    ],
  };
  const grown = syncStateToPlan(state, bigger);
  expect(grown.instances).toHaveLength(4);
  expect(grown.instances[0].progress).toEqual({ d1: 0, d2: 1, d3: 0 });
});

test('reset rearms with fresh instances', () => {
  let { state } = applyResult(activate(createInitialState(plan)), plan, r());
  state = reset(state, plan);
  expect(state.status).toBe('armed');
  expect(state.instances[0].progress.d2).toBe(0);
});

test('inputs are not mutated', () => {
  const s = createInitialState(plan);
  const copy = structuredClone(s);
  applyResult(s, plan, r());
  expect(s).toEqual(copy);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/services/RulesEngine.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

`scripts/services/RulesEngine.js`:

```js
import { DEGREE, STATE_VERSION, STATUS } from '../constants.js';

export const instanceKey = (componentId, index) => `${componentId}:${index}`;
const keyOf = (inst) => instanceKey(inst.componentId, inst.index);
const clone = (v) => structuredClone(v);

function freshProgress(component) {
  return Object.fromEntries((component.disables ?? []).map((d) => [d.id, 0]));
}

function buildInstances(plan) {
  const out = [];
  for (const c of plan.components ?? []) {
    for (let index = 0; index < (c.count ?? 1); index++) {
      out.push({ componentId: c.id, index, progress: freshProgress(c), disabled: false });
    }
  }
  return out;
}

export function createInitialState(plan) {
  return {
    version: STATE_VERSION,
    status: STATUS.ARMED,
    instances: buildInstances(plan),
    history: [],
  };
}

export function syncStateToPlan(state, plan) {
  const next = clone(state);
  const old = new Map(state.instances.map((i) => [keyOf(i), i]));
  next.instances = buildInstances(plan).map((fresh) => {
    const prev = old.get(keyOf(fresh));
    if (!prev) return fresh;
    const progress = { ...fresh.progress };
    for (const id of Object.keys(progress)) progress[id] = prev.progress?.[id] ?? 0;
    return { ...fresh, progress, disabled: prev.disabled };
  });
  return next;
}

export function activate(state) {
  if (state.status === STATUS.DISABLED) return state;
  return { ...clone(state), status: STATUS.ACTIVE };
}

const findComponent = (plan, componentId) => plan.components.find((c) => c.id === componentId);

function allDisabled(state) {
  return state.instances.length > 0 && state.instances.every((i) => i.disabled);
}

function revertEntry(state, entry) {
  const inst = state.instances.find((i) => keyOf(i) === entry.instanceKey);
  if (inst) {
    if (entry.disableId && entry.prevProgress !== undefined)
      inst.progress[entry.disableId] = entry.prevProgress;
    inst.disabled = entry.prevDisabled;
  }
  state.status = entry.prevStatus;
}

export function applyResult(state, plan, r) {
  let next = clone(state);
  if (r.isReroll) {
    const idx = next.history.findLastIndex(
      (h) => h.kind === 'result' && h.instanceKey === r.instanceKey && h.actorUuid === r.actorUuid,
    );
    if (idx !== -1) {
      revertEntry(next, next.history[idx]);
      next.history.splice(idx, 1);
    }
  }
  const inst = next.instances.find((i) => keyOf(i) === r.instanceKey);
  if (!inst)
    return {
      state,
      events: [{ type: 'ignored', reason: 'unknown-instance', instanceKey: r.instanceKey }],
    };
  if (inst.disabled) {
    return {
      state: r.isReroll ? next : state,
      events: [{ type: 'ignored', reason: 'instance-disabled', instanceKey: r.instanceKey }],
    };
  }
  const disable = findComponent(plan, inst.componentId)?.disables.find((d) => d.id === r.disableId);
  if (!disable)
    return {
      state,
      events: [{ type: 'ignored', reason: 'unknown-disable', instanceKey: r.instanceKey }],
    };

  const entry = {
    kind: 'result',
    instanceKey: r.instanceKey,
    disableId: r.disableId,
    prevProgress: inst.progress[r.disableId] ?? 0,
    prevDisabled: inst.disabled,
    prevStatus: next.status,
    actorUuid: r.actorUuid,
    messageId: r.messageId,
    userId: r.userId,
    at: r.at,
  };
  const events = [];
  if (r.degree === DEGREE.CRIT_FAIL) {
    if (next.status === STATUS.ARMED || next.status === STATUS.RESET)
      next.status = STATUS.TRIGGERED;
    events.push({ type: 'hazardTriggered', instanceKey: r.instanceKey });
  } else {
    const delta = r.degree === DEGREE.CRIT_SUCCESS ? 2 : r.degree === DEGREE.SUCCESS ? 1 : 0;
    const need = disable.successesNeeded ?? 1;
    inst.progress[r.disableId] = Math.min(need, (inst.progress[r.disableId] ?? 0) + delta);
    events.push({
      type: 'progress',
      instanceKey: r.instanceKey,
      disableId: r.disableId,
      value: inst.progress[r.disableId],
    });
    if (inst.progress[r.disableId] >= need) {
      inst.disabled = true;
      events.push({ type: 'instanceDisabled', instanceKey: r.instanceKey });
      if (allDisabled(next)) {
        next.status = STATUS.DISABLED;
        events.push({ type: 'hazardDisabled' });
      }
    }
  }
  next.history.push(entry);
  return { state: next, events };
}

export function override(state, plan, { instanceKey: key, disableId, progress, disabled }) {
  const next = clone(state);
  const inst = next.instances.find((i) => keyOf(i) === key);
  if (!inst)
    return { state, events: [{ type: 'ignored', reason: 'unknown-instance', instanceKey: key }] };
  const entry = {
    kind: 'override',
    instanceKey: key,
    disableId: disableId ?? null,
    prevProgress: disableId ? (inst.progress[disableId] ?? 0) : undefined,
    prevDisabled: inst.disabled,
    prevStatus: next.status,
  };
  if (disableId && progress !== undefined) inst.progress[disableId] = Math.max(0, progress);
  if (disabled !== undefined) inst.disabled = disabled;
  const events = [];
  if (allDisabled(next)) {
    if (next.status !== STATUS.DISABLED) events.push({ type: 'hazardDisabled' });
    next.status = STATUS.DISABLED;
  } else if (next.status === STATUS.DISABLED) {
    next.status = STATUS.ACTIVE;
  }
  next.history.push(entry);
  return { state: next, events };
}

export function undo(state) {
  if (!state.history.length) return state;
  const next = clone(state);
  revertEntry(next, next.history.pop());
  return next;
}

export function reset(state, plan) {
  return { ...createInitialState(plan), history: clone(state.history) };
}

export function disabledCount(state) {
  return state.instances.filter((i) => i.disabled).length;
}

export function actionsRemaining(state, plan) {
  if (plan.actionsPerTurn == null) return null;
  let lost = 0;
  for (const inst of state.instances) {
    if (inst.disabled) lost += findComponent(plan, inst.componentId)?.actionsEach ?? 0;
  }
  return Math.max(0, plan.actionsPerTurn - lost);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/services/RulesEngine.test.js`
Expected: PASS (15 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/services/RulesEngine.js tests/services/RulesEngine.test.js
git commit -m "feat(engine): pure hazard state transitions with reroll, undo and sync"
```

---

### Task 5: Roll matcher

**Files:**

- Create: `scripts/services/RollMatcher.js`
- Test: `tests/services/RollMatcher.test.js`

**Interfaces:**

- Consumes: `TAG_PREFIX`, `STATUS` (Task 1); `instanceKey` (Task 4).
- Produces:
  - `buildTag(tokenId, componentId, index, disableId) => string`
  - `parseTag(options: string[]) => { tokenId, instanceKey, disableId } | null`
  - `extractCheck(context) => { statistic: string|null, dc: number|null, options: string[] }` — `statistic` from the roll option `check:statistic:<slug>` (ignoring `check:statistic:base:*`), `dc` from `context.dc?.value`.
  - `matchCheck(check, candidates) => { kind: 'tagged'|'unique'|'ambiguous'|'none', matches: Array<{ tokenId, instanceKey, disableId }> }` where `candidates = Array<{ tokenId, plan, state }>`.

- [ ] **Step 1: Write the failing tests**

`tests/services/RollMatcher.test.js`:

```js
import {
  buildTag,
  extractCheck,
  matchCheck,
  parseTag,
} from '../../scripts/services/RollMatcher.js';
import { createInitialState } from '../../scripts/services/RulesEngine.js';

const planOf = (count, disables) => ({
  components: [{ id: 'c1', count, actionsEach: 0, disables }],
});
const cand = (tokenId, plan, status = 'active') => ({
  tokenId,
  plan,
  state: { ...createInitialState(plan), status },
});
const thieveryPlan = planOf(1, [{ id: 'd1', skill: 'thievery', dc: 22, successesNeeded: 1 }]);

test('tag round-trips', () => {
  const tag = buildTag('tok1', 'c1', 2, 'd3');
  expect(tag).toBe('hazarder:instance:tok1:c1:2:d3');
  expect(parseTag(['x', tag])).toEqual({ tokenId: 'tok1', instanceKey: 'c1:2', disableId: 'd3' });
  expect(parseTag(['x'])).toBeNull();
});

test('extractCheck reads statistic and dc', () => {
  const ctx = {
    dc: { value: 22 },
    options: ['check:statistic:base:thievery', 'check:statistic:thievery'],
  };
  expect(extractCheck(ctx)).toEqual({ statistic: 'thievery', dc: 22, options: ctx.options });
  expect(extractCheck({})).toEqual({ statistic: null, dc: null, options: [] });
});

test('tagged wins', () => {
  const check = { statistic: 'thievery', dc: 22, options: [buildTag('t1', 'c1', 0, 'd1')] };
  expect(matchCheck(check, [cand('t1', thieveryPlan)])).toEqual({
    kind: 'tagged',
    matches: [{ tokenId: 't1', instanceKey: 'c1:0', disableId: 'd1' }],
  });
});

test('unique skill + dc match', () => {
  const res = matchCheck({ statistic: 'thievery', dc: 22, options: [] }, [
    cand('t1', thieveryPlan),
  ]);
  expect(res.kind).toBe('unique');
  expect(res.matches).toEqual([{ tokenId: 't1', instanceKey: 'c1:0', disableId: 'd1' }]);
});

test('multi-instance component is ambiguous', () => {
  const plan = planOf(3, [{ id: 'd1', skill: 'thievery', dc: 22, successesNeeded: 1 }]);
  const res = matchCheck({ statistic: 'thievery', dc: 22, options: [] }, [cand('t1', plan)]);
  expect(res.kind).toBe('ambiguous');
  expect(res.matches).toHaveLength(3);
});

test('two hazards same check is ambiguous', () => {
  const res = matchCheck({ statistic: 'thievery', dc: 22, options: [] }, [
    cand('t1', thieveryPlan),
    cand('t2', thieveryPlan),
  ]);
  expect(res.kind).toBe('ambiguous');
});

test('disabled hazards and disabled instances are skipped', () => {
  const plan = planOf(2, [{ id: 'd1', skill: 'thievery', dc: 22, successesNeeded: 1 }]);
  const c = cand('t1', plan);
  c.state.instances[0].disabled = true;
  expect(matchCheck({ statistic: 'thievery', dc: 22, options: [] }, [c]).kind).toBe('unique');
  expect(
    matchCheck({ statistic: 'thievery', dc: 22, options: [] }, [
      cand('t1', thieveryPlan, 'disabled'),
    ]).kind,
  ).toBe('none');
});

test('wrong dc, missing statistic or missing dc is none', () => {
  expect(
    matchCheck({ statistic: 'thievery', dc: 23, options: [] }, [cand('t1', thieveryPlan)]).kind,
  ).toBe('none');
  expect(
    matchCheck({ statistic: null, dc: 22, options: [] }, [cand('t1', thieveryPlan)]).kind,
  ).toBe('none');
  expect(
    matchCheck({ statistic: 'thievery', dc: null, options: [] }, [cand('t1', thieveryPlan)]).kind,
  ).toBe('none');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/services/RollMatcher.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

`scripts/services/RollMatcher.js`:

```js
import { STATUS, TAG_PREFIX } from '../constants.js';
import { instanceKey } from './RulesEngine.js';

export function buildTag(tokenId, componentId, index, disableId) {
  return `${TAG_PREFIX}${tokenId}:${componentId}:${index}:${disableId}`;
}

export function parseTag(options = []) {
  const tag = options.find((o) => typeof o === 'string' && o.startsWith(TAG_PREFIX));
  if (!tag) return null;
  const [tokenId, componentId, index, disableId] = tag.slice(TAG_PREFIX.length).split(':');
  if (!tokenId || !componentId || index === undefined || !disableId) return null;
  return { tokenId, instanceKey: instanceKey(componentId, Number(index)), disableId };
}

export function extractCheck(context = {}) {
  const options = Array.isArray(context.options) ? context.options : [];
  const stat = options.find(
    (o) => o.startsWith('check:statistic:') && !o.startsWith('check:statistic:base:'),
  );
  const dc = context.dc?.value;
  return {
    statistic: stat ? stat.slice('check:statistic:'.length) : null,
    dc: Number.isFinite(dc) ? dc : null,
    options,
  };
}

export function matchCheck(check, candidates) {
  const tagged = parseTag(check.options);
  if (tagged) return { kind: 'tagged', matches: [tagged] };
  if (!check.statistic || check.dc == null) return { kind: 'none', matches: [] };
  const matches = [];
  for (const { tokenId, plan, state } of candidates) {
    if (!plan || !state || state.status === STATUS.DISABLED) continue;
    for (const comp of plan.components) {
      for (const d of comp.disables) {
        if (d.skill !== check.statistic || d.dc !== check.dc) continue;
        for (const inst of state.instances) {
          if (inst.componentId !== comp.id || inst.disabled) continue;
          matches.push({ tokenId, instanceKey: instanceKey(comp.id, inst.index), disableId: d.id });
        }
      }
    }
  }
  if (matches.length === 0) return { kind: 'none', matches };
  return { kind: matches.length === 1 ? 'unique' : 'ambiguous', matches };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/services/RollMatcher.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/services/RollMatcher.js tests/services/RollMatcher.test.js
git commit -m "feat(matcher): match check messages to hazard instances"
```

---

### Task 6: Hazard store

**Files:**

- Create: `scripts/stores/hazardStore.js`
- Test: `tests/stores/hazardStore.test.js`

**Interfaces:**

- Consumes: `MODULE_ID`, `PLAN_VERSION`, `STATE_VERSION` (Task 1); `draftPlan` (Task 3); `createInitialState`, `syncStateToPlan` (Task 4).
- Produces:
  - `getPlan(actor) => Plan|null` (null when absent or unknown version)
  - `async setPlan(actor, plan) => void` — writes a deep copy
  - `getOrDraftPlan(actor) => { plan, warnings, isDraft }` — stored plan if present (`warnings: []`, `isDraft: !plan.confirmed`), else `draftPlan(actor.toObject())`
  - `getState(tokenDoc) => State|null`
  - `async setState(tokenDoc, state) => void`
  - `getOrCreateState(tokenDoc, plan) => State` — synced to plan
  - `getTrackerMessageId(tokenDoc) => string|null`, `async setTrackerMessageId(tokenDoc, id) => void`

- [ ] **Step 1: Write the failing tests**

`tests/stores/hazardStore.test.js`:

```js
import {
  getOrCreateState,
  getOrDraftPlan,
  getPlan,
  getState,
  getTrackerMessageId,
  setPlan,
  setState,
  setTrackerMessageId,
} from '../../scripts/stores/hazardStore.js';

function doc(flags = {}, source = {}) {
  return {
    flags: { 'pf2e-hazarder': { ...flags } },
    getFlag(scope, key) {
      return this.flags[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.flags[scope][key] = value;
    },
    toObject: () => source,
  };
}

const plan = {
  version: 1,
  confirmed: true,
  actionsPerTurn: 1,
  components: [{ id: 'c1', count: 2, actionsEach: 0, disables: [{ id: 'd1' }] }],
};

test('plan round-trip copies data', async () => {
  const a = doc();
  await setPlan(a, plan);
  expect(getPlan(a)).toEqual(plan);
  expect(getPlan(a)).not.toBe(plan);
});

test('unknown plan version is ignored', () => {
  expect(getPlan(doc({ plan: { ...plan, version: 99 } }))).toBeNull();
});

test('getOrDraftPlan drafts when missing', () => {
  const a = doc(
    {},
    {
      name: 'Pit',
      system: {
        details: { isComplex: false, routine: '', disable: '@Check[thievery|dc:18]', reset: '' },
      },
      items: [],
    },
  );
  const res = getOrDraftPlan(a);
  expect(res.isDraft).toBe(true);
  expect(res.plan.components[0].disables[0].dc).toBe(18);
});

test('getOrDraftPlan returns stored confirmed plan', () => {
  const res = getOrDraftPlan(doc({ plan }));
  expect(res).toEqual({ plan, warnings: [], isDraft: false });
});

test('state is created and synced to plan', async () => {
  const t = doc();
  const s = getOrCreateState(t, plan);
  expect(s.instances).toHaveLength(2);
  await setState(t, s);
  expect(getState(t)).toEqual(s);
  const grown = getOrCreateState(t, { ...plan, components: [{ ...plan.components[0], count: 3 }] });
  expect(grown.instances).toHaveLength(3);
});

test('tracker message id', async () => {
  const t = doc();
  expect(getTrackerMessageId(t)).toBeNull();
  await setTrackerMessageId(t, 'msg1');
  expect(getTrackerMessageId(t)).toBe('msg1');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/stores/hazardStore.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

`scripts/stores/hazardStore.js`:

```js
import { MODULE_ID, PLAN_VERSION, STATE_VERSION } from '../constants.js';
import { draftPlan } from '../parser/draftPlan.js';
import { createInitialState, syncStateToPlan } from '../services/RulesEngine.js';

const copy = (v) => structuredClone(v);

export function getPlan(actor) {
  const p = actor?.getFlag(MODULE_ID, 'plan');
  return p?.version === PLAN_VERSION ? copy(p) : null;
}

export async function setPlan(actor, plan) {
  await actor.setFlag(MODULE_ID, 'plan', copy(plan));
}

export function getOrDraftPlan(actor) {
  const stored = getPlan(actor);
  if (stored) return { plan: stored, warnings: [], isDraft: !stored.confirmed };
  const { plan, warnings } = draftPlan(actor.toObject());
  return { plan, warnings, isDraft: true };
}

export function getState(tokenDoc) {
  const s = tokenDoc?.getFlag(MODULE_ID, 'state');
  return s?.version === STATE_VERSION ? copy(s) : null;
}

export async function setState(tokenDoc, state) {
  await tokenDoc.setFlag(MODULE_ID, 'state', copy(state));
}

export function getOrCreateState(tokenDoc, plan) {
  const s = getState(tokenDoc);
  return s ? syncStateToPlan(s, plan) : createInitialState(plan);
}

export function getTrackerMessageId(tokenDoc) {
  return tokenDoc?.getFlag(MODULE_ID, 'trackerMessageId') ?? null;
}

export async function setTrackerMessageId(tokenDoc, id) {
  await tokenDoc.setFlag(MODULE_ID, 'trackerMessageId', id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/stores/hazardStore.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/stores/hazardStore.js tests/stores/hazardStore.test.js
git commit -m "feat(store): plan and state flag storage"
```

---

### Task 7: Plan form conversion + plan panel

**Files:**

- Create: `scripts/ui/planForm.js`, `scripts/ui/PlanPanel.js`, `templates/plan-panel.hbs`
- Test: `tests/ui/planForm.test.js`

**Interfaces:**

- Consumes: `Plan` (Task 3), `getOrDraftPlan`, `setPlan` (Task 6), `MODULE_ID` (Task 1).
- Produces:
  - `planToContext(plan, warnings, actor) => object` — template context (`warnings` localized via key `PF2E_HAZARDER.Warnings.<code>`; `items` = actor's action/melee items `{ id, name }`)
  - `formToPlan(data: object, basePlan: Plan) => Plan` — `data` is the flat object from `foundry.utils.expandObject(new FormDataExtended(form).object)`; returns `confirmed: true`; drops disables with empty skill; `count` ≥ 1; numbers parsed; component ids `c<n>`, disable ids `d<n>` preserved from `data` when present else assigned.
  - `class PlanPanel extends HandlebarsApplicationMixin(ApplicationV2)` with `static async open(actor) => Promise<Plan|null>` resolving with the saved plan or `null` if closed unsaved.

- [ ] **Step 1: Write the failing test**

`tests/ui/planForm.test.js`:

```js
import { formToPlan, planToContext } from '../../scripts/ui/planForm.js';

const base = {
  version: 1,
  confirmed: false,
  actionsPerTurn: 9,
  components: [
    {
      id: 'c1',
      name: 'x',
      count: 1,
      actionsEach: 0,
      disables: [
        { id: 'd1', skill: 'thievery', dc: 20, label: 'A', traits: ['t'], successesNeeded: 1 },
      ],
      counteract: null,
    },
  ],
  reactionItemId: null,
  routineItemIds: [],
  resetText: '',
  resetAfterSeconds: null,
};

test('formToPlan parses numbers and confirms', () => {
  const data = {
    actionsPerTurn: '6',
    reactionItemId: 'r1',
    components: {
      0: {
        id: 'c1',
        name: 'Rune',
        count: '4',
        actionsEach: '0',
        disables: {
          0: { id: 'd1', skill: 'thievery', dc: '22', label: 'Erase', successesNeeded: '1' },
          1: { skill: '', dc: '', label: '', successesNeeded: '' },
        },
      },
    },
  };
  const plan = formToPlan(data, base);
  expect(plan.confirmed).toBe(true);
  expect(plan.actionsPerTurn).toBe(6);
  expect(plan.reactionItemId).toBe('r1');
  expect(plan.components[0]).toMatchObject({ id: 'c1', name: 'Rune', count: 4, actionsEach: 0 });
  expect(plan.components[0].disables).toEqual([
    { id: 'd1', skill: 'thievery', dc: 22, label: 'Erase', traits: ['t'], successesNeeded: 1 },
  ]);
});

test('formToPlan assigns ids, clamps count and blank actions → null', () => {
  const data = {
    actionsPerTurn: '',
    components: {
      0: {
        name: 'A',
        count: '0',
        actionsEach: '',
        disables: { 0: { skill: 'religion', dc: '30', label: '', successesNeeded: '2' } },
      },
    },
  };
  const plan = formToPlan(data, base);
  expect(plan.actionsPerTurn).toBeNull();
  expect(plan.components[0]).toMatchObject({ id: 'c1', count: 1, actionsEach: 0 });
  expect(plan.components[0].disables[0]).toMatchObject({
    id: 'd1',
    skill: 'religion',
    dc: 30,
    label: 'religion',
    successesNeeded: 2,
    traits: [],
  });
  expect(plan.components[0].counteract).toBeNull();
});

test('planToContext lists warnings and items', () => {
  const actor = {
    items: [
      { id: 'r1', name: 'Awaken', type: 'action' },
      { id: 'f', name: 'Feat', type: 'feat' },
    ],
  };
  const ctx = planToContext(base, ['no-disables'], actor);
  expect(ctx.warnings).toEqual(['PF2E_HAZARDER.Warnings.no-disables']);
  expect(ctx.items).toEqual([{ id: 'r1', name: 'Awaken' }]);
  expect(ctx.plan).toBe(base);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ui/planForm.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

`scripts/ui/planForm.js`:

```js
const int = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const list = (obj) =>
  Array.isArray(obj)
    ? obj
    : Object.keys(obj ?? {})
        .sort((a, b) => a - b)
        .map((k) => obj[k]);

export function planToContext(plan, warnings, actor) {
  return {
    plan,
    warnings: warnings.map((w) => `PF2E_HAZARDER.Warnings.${w}`),
    items: [...(actor.items ?? [])]
      .filter((i) => i.type === 'action' || i.type === 'melee')
      .map((i) => ({ id: i.id, name: i.name })),
  };
}

export function formToPlan(data, basePlan) {
  const baseComps = new Map(basePlan.components.map((c) => [c.id, c]));
  const components = list(data.components).map((c, ci) => {
    const id = c.id || `c${ci + 1}`;
    const prev = baseComps.get(id);
    const prevDisables = new Map((prev?.disables ?? []).map((d) => [d.id, d]));
    const disables = list(c.disables)
      .filter((d) => d.skill && String(d.skill).trim())
      .map((d, di) => {
        const did = d.id || `d${di + 1}`;
        const skill = String(d.skill).trim();
        return {
          id: did,
          skill,
          dc: int(d.dc),
          label: (d.label && String(d.label).trim()) || skill,
          traits: d.id ? (prevDisables.get(did)?.traits ?? []) : [],
          successesNeeded: Math.max(1, int(d.successesNeeded) ?? 1),
        };
      });
    return {
      id,
      name: (c.name && String(c.name).trim()) || basePlan.components[0]?.name || id,
      count: Math.max(1, int(c.count) ?? 1),
      actionsEach: Math.max(0, int(c.actionsEach) ?? 0),
      disables,
      counteract: prev?.counteract ?? null,
    };
  });
  return {
    ...structuredClone(basePlan),
    confirmed: true,
    actionsPerTurn: int(data.actionsPerTurn),
    reactionItemId: data.reactionItemId || null,
    components,
  };
}
```

`scripts/ui/PlanPanel.js`:

```js
import { MODULE_ID } from '../constants.js';
import { getOrDraftPlan, setPlan } from '../stores/hazardStore.js';
import { formToPlan, planToContext } from './planForm.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PlanPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'hazarder-plan-{id}',
    classes: ['hazarder-plan'],
    tag: 'form',
    window: { resizable: true },
    position: { width: 560, height: 'auto' },
    form: { handler: PlanPanel.#onSubmit, closeOnSubmit: true },
    actions: { addComponent: PlanPanel.#addComponent, addDisable: PlanPanel.#addDisable },
  };

  static PARTS = { form: { template: `modules/${MODULE_ID}/templates/plan-panel.hbs` } };

  static open(actor) {
    return new Promise((resolve) => new PlanPanel({ actor, resolve }).render(true));
  }

  constructor({ actor, resolve, ...options }) {
    super(options);
    this.actor = actor;
    this.resolve = resolve;
    const { plan, warnings } = getOrDraftPlan(actor);
    this.plan = plan;
    this.warnings = warnings;
    this.saved = null;
  }

  get title() {
    return game.i18n.format('PF2E_HAZARDER.Plan.Title', { name: this.actor.name });
  }

  async _prepareContext() {
    return planToContext(this.plan, this.warnings, this.actor);
  }

  static async #onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    this.saved = formToPlan(data, this.plan);
    await setPlan(this.actor, this.saved);
  }

  static #addComponent() {
    const n = this.plan.components.length + 1;
    this.plan.components.push({
      id: `c${n}`,
      name: '',
      count: 1,
      actionsEach: 0,
      disables: [],
      counteract: null,
    });
    this.render();
  }

  static #addDisable(event, target) {
    const comp = this.plan.components[Number(target.dataset.component)];
    comp.disables.push({
      id: `d${comp.disables.length + 1}`,
      skill: '',
      dc: null,
      label: '',
      traits: [],
      successesNeeded: 1,
    });
    this.render();
  }

  _onClose(options) {
    super._onClose(options);
    this.resolve?.(this.saved);
  }
}
```

`templates/plan-panel.hbs`:

```hbs
<section class="hazarder-plan-body">
  {{#if warnings.length}}
    <fieldset class="hz-warnings">
      <legend>{{localize "PF2E_HAZARDER.Plan.Warnings"}}</legend>
      {{#each warnings}}<p class="hz-warning">{{localize this}}</p>{{/each}}
    </fieldset>
  {{/if}}
  <div class="form-group">
    <label>{{localize "PF2E_HAZARDER.Plan.ActionsPerTurn"}}</label>
    <input type="number" name="actionsPerTurn" value="{{plan.actionsPerTurn}}" min="0" />
  </div>
  <div class="form-group">
    <label>Reaction</label>
    <select name="reactionItemId">
      <option value=""></option>
      {{#each items}}<option value="{{id}}" {{#if (eq id ../plan.reactionItemId)}}selected{{/if}}>{{name}}</option>{{/each}}
    </select>
  </div>
  {{#each plan.components as |c ci|}}
    <fieldset class="hz-component">
      <legend>{{localize "PF2E_HAZARDER.Plan.Component"}} {{c.id}}</legend>
      <input type="hidden" name="components.{{ci}}.id" value="{{c.id}}" />
      <div class="form-group"><label>{{localize "PF2E_HAZARDER.Plan.Component"}}</label><input type="text" name="components.{{ci}}.name" value="{{c.name}}" /></div>
      <div class="form-group"><label>{{localize "PF2E_HAZARDER.Plan.Count"}}</label><input type="number" min="1" name="components.{{ci}}.count" value="{{c.count}}" /></div>
      <div class="form-group"><label>{{localize "PF2E_HAZARDER.Plan.ActionsEach"}}</label><input type="number" min="0" name="components.{{ci}}.actionsEach" value="{{c.actionsEach}}" /></div>
      {{#each c.disables as |d di|}}
        <div class="form-group hz-disable">
          <input type="hidden" name="components.{{ci}}.disables.{{di}}.id" value="{{d.id}}" />
          <input type="text" placeholder="{{localize 'PF2E_HAZARDER.Plan.Skill'}}" name="components.{{ci}}.disables.{{di}}.skill" value="{{d.skill}}" />
          <input type="number" placeholder="{{localize 'PF2E_HAZARDER.Plan.DC'}}" name="components.{{ci}}.disables.{{di}}.dc" value="{{d.dc}}" />
          <input type="text" placeholder="{{localize 'PF2E_HAZARDER.Plan.Label'}}" name="components.{{ci}}.disables.{{di}}.label" value="{{d.label}}" />
          <input type="number" min="1" title="{{localize 'PF2E_HAZARDER.Plan.SuccessesNeeded'}}" name="components.{{ci}}.disables.{{di}}.successesNeeded" value="{{d.successesNeeded}}" />
        </div>
      {{/each}}
      <button type="button" data-action="addDisable" data-component="{{ci}}">{{localize "PF2E_HAZARDER.Plan.AddDisable"}}</button>
    </fieldset>
  {{/each}}
  <button type="button" data-action="addComponent">{{localize "PF2E_HAZARDER.Plan.AddComponent"}}</button>
  <footer class="form-footer"><button type="submit">{{localize "PF2E_HAZARDER.Plan.Save"}}</button></footer>
</section>
```

Note: `addComponent`/`addDisable` re-render from `this.plan`, so unsaved edits in visible fields are lost on add. Before pushing, both handlers must first fold current field values into `this.plan`: add as the first line of each handler

```js
this.plan = {
  ...formToPlan(
    foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object),
    this.plan,
  ),
  confirmed: this.plan.confirmed,
};
```

— but `formToPlan` drops blank-skill disables, which would delete the just-added empty row on the next add. Accept that: an empty row only survives until the next add, which is fine for authoring.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/ui/planForm.test.js && npm run lint`
Expected: PASS (3 tests), lint clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/ui/planForm.js scripts/ui/PlanPanel.js templates/plan-panel.hbs tests/ui/planForm.test.js
git commit -m "feat(ui): plan confirm panel"
```

---

### Task 8: Turn card

**Files:**

- Create: `scripts/ui/turnView.js`, `scripts/ui/TurnCard.js`, `templates/turn-card.hbs`
- Test: `tests/ui/turnView.test.js`

**Interfaces:**

- Consumes: `actionsRemaining`, `disabledCount` (Task 4); `getOrDraftPlan`, `getOrCreateState` (Task 6); `MODULE_ID` (Task 1).
- Produces:
  - `buildTurnView({ name, plan, state, routineHtml, items }) => { title, total, remaining, pips: Array<{ spent: boolean }>, disabledNote: string|null, routineHtml, items: Array<{ id, name }> }` where `title` is the i18n key result of `PF2E_HAZARDER.Turn.Title`; `pips` length = `total` (0 when total null); pips beyond `remaining` are `spent: true`.
  - `async postTurnCard(combatant) => ChatMessage|null` — whispers to all GMs; optional public flavor card per setting `publicFlavorCard`. Buttons carry `data-hz-action="item"` and `data-item-id`, `data-token-uuid`.

- [ ] **Step 1: Write the failing test**

`tests/ui/turnView.test.js`:

```js
import { buildTurnView } from '../../scripts/ui/turnView.js';
import { createInitialState } from '../../scripts/services/RulesEngine.js';

const plan = {
  actionsPerTurn: 9,
  components: [
    { id: 'c1', count: 3, actionsEach: 3, disables: [{ id: 'd1', successesNeeded: 1 }] },
  ],
  routineItemIds: ['m1', 'zz'],
};

test('pips reflect disabled instances', () => {
  const state = createInitialState(plan);
  state.instances[0].disabled = true;
  const v = buildTurnView({
    name: 'Mannequins',
    plan,
    state,
    routineHtml: '<p>r</p>',
    items: [{ id: 'm1', name: 'Fist' }],
  });
  expect(v.total).toBe(9);
  expect(v.remaining).toBe(6);
  expect(v.pips.filter((p) => p.spent)).toHaveLength(3);
  expect(v.disabledNote).toBe('PF2E_HAZARDER.Turn.DisabledNote');
  expect(v.items).toEqual([{ id: 'm1', name: 'Fist' }]);
});

test('null actions per turn gives no pips', () => {
  const v = buildTurnView({
    name: 'X',
    plan: { ...plan, actionsPerTurn: null },
    state: createInitialState(plan),
    routineHtml: '',
    items: [],
  });
  expect(v.pips).toEqual([]);
  expect(v.disabledNote).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ui/turnView.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

`scripts/ui/turnView.js`:

```js
import { actionsRemaining, disabledCount } from '../services/RulesEngine.js';

export function buildTurnView({ name, plan, state, routineHtml, items }) {
  const total = plan.actionsPerTurn ?? 0;
  const remaining = actionsRemaining(state, plan) ?? 0;
  const disabled = disabledCount(state);
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    title: game.i18n.format('PF2E_HAZARDER.Turn.Title', { name }),
    total,
    remaining,
    pips: Array.from({ length: total }, (_, i) => ({ spent: i >= remaining })),
    disabledNote: disabled
      ? game.i18n.format('PF2E_HAZARDER.Turn.DisabledNote', { count: disabled })
      : null,
    routineHtml,
    items: (plan.routineItemIds ?? []).map((id) => byId.get(id)).filter(Boolean),
  };
}
```

`scripts/ui/TurnCard.js`:

```js
import { MODULE_ID } from '../constants.js';
import { getOrCreateState, getOrDraftPlan } from '../stores/hazardStore.js';
import { buildTurnView } from './turnView.js';

const render = (path, data) => foundry.applications.handlebars.renderTemplate(path, data);

export async function postTurnCard(combatant) {
  const tokenDoc = combatant.token;
  const actor = combatant.actor;
  if (!tokenDoc || !actor) return null;
  const { plan } = getOrDraftPlan(actor);
  const state = getOrCreateState(tokenDoc, plan);
  const routineHtml = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
    actor.system.details.routine ?? '',
    { rollData: actor.getRollData(), relativeTo: actor },
  );
  const view = buildTurnView({
    name: tokenDoc.name,
    plan,
    state,
    routineHtml,
    items: actor.items.map((i) => ({ id: i.id, name: i.name })),
  });
  const content = await render(`modules/${MODULE_ID}/templates/turn-card.hbs`, {
    ...view,
    tokenUuid: tokenDoc.uuid,
  });
  const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
  const msg = await ChatMessage.create({
    content,
    whisper: gmIds,
    speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    flags: { [MODULE_ID]: { kind: 'turn' } },
  });
  if (game.settings.get(MODULE_ID, 'publicFlavorCard')) {
    await ChatMessage.create({
      content: `<p>${game.i18n.format('PF2E_HAZARDER.Turn.Flavor', { name: tokenDoc.name })}</p>`,
      speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    });
  }
  return msg;
}
```

`templates/turn-card.hbs`:

```hbs
<div class="hazarder-card hz-turn" data-token-uuid="{{tokenUuid}}">
  <h3>{{title}}</h3>
  {{#if total}}
    <div class="hz-actions">
      {{#each pips}}<span class="hz-pip filled {{#if spent}}spent{{/if}}"></span>{{/each}}
      <span>{{remaining}} / {{total}}</span>
      {{#if disabledNote}}<em>({{disabledNote}})</em>{{/if}}
    </div>
  {{/if}}
  <div class="hz-routine">{{{routineHtml}}}</div>
  {{#if items.length}}
    <div class="hz-items">
      {{#each items}}<button type="button" data-hz-action="item" data-item-id="{{id}}" data-token-uuid="{{../tokenUuid}}">{{name}}</button>{{/each}}
    </div>
  {{/if}}
</div>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/ui/turnView.test.js && npm run lint`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/ui/turnView.js scripts/ui/TurnCard.js templates/turn-card.hbs tests/ui/turnView.test.js
git commit -m "feat(ui): GM hazard turn card with action pool"
```

---

### Task 9: Disable tracker card

**Files:**

- Create: `scripts/ui/trackerView.js`, `scripts/ui/TrackerCard.js`, `templates/tracker-card.hbs`
- Test: `tests/ui/trackerView.test.js`

**Interfaces:**

- Consumes: `instanceKey` (Task 4); `buildTag` (Task 5); `getOrDraftPlan`, `getOrCreateState`, `getTrackerMessageId`, `setTrackerMessageId` (Task 6); `getSystemId` (Task 1).
- Produces:
  - `buildTrackerView({ name, plan, state, isGM }) => { title, status, statusLabel, empty: boolean, components: Array<{ name, counteract: string|null, instances: Array<{ key, label, disabled, options: Array<{ disableId, label, skill, dc, have, need, pips: Array<{ filled }> }> }> }>, isGM }`
  - `async upsertTracker(tokenDoc) => ChatMessage` — creates the card or updates content of the stored message (re-creates if the message was deleted).
  - `async rollDisable({ tokenUuid, instanceKey, disableId }) => void` — rolls for the user's controlled token actor, else `game.user.character`; warns `PF2E_HAZARDER.Tracker.NoActor` if none; uses `actor.getStatistic(skill).roll({ dc: { value: dc }, extraRollOptions: [tag], traits })`.

- [ ] **Step 1: Write the failing test**

`tests/ui/trackerView.test.js`:

```js
import { buildTrackerView } from '../../scripts/ui/trackerView.js';
import { createInitialState } from '../../scripts/services/RulesEngine.js';

const plan = {
  components: [
    {
      id: 'c1',
      name: 'Rune',
      count: 2,
      actionsEach: 0,
      disables: [{ id: 'd1', skill: 'thievery', dc: 22, label: 'Erase', successesNeeded: 2 }],
      counteract: { spellUuid: 'u', name: 'Dispel Magic', rank: 4, dc: 22 },
    },
  ],
};

test('builds instances with pips', () => {
  const state = createInitialState(plan);
  state.status = 'active';
  state.instances[1].progress.d1 = 1;
  const v = buildTrackerView({ name: 'Wheel', plan, state, isGM: false });
  expect(v.empty).toBe(false);
  expect(v.statusLabel).toBe('PF2E_HAZARDER.Status.active');
  expect(v.components[0].counteract).toBe('PF2E_HAZARDER.Tracker.Counteract');
  expect(v.components[0].instances.map((i) => i.label)).toEqual(['Rune 1', 'Rune 2']);
  expect(v.components[0].instances[1].options[0]).toMatchObject({
    disableId: 'd1',
    have: 1,
    need: 2,
    skill: 'thievery',
    dc: 22,
  });
  expect(v.components[0].instances[1].options[0].pips).toEqual([
    { filled: true },
    { filled: false },
  ]);
});

test('single-instance components are labelled by name only', () => {
  const p = { components: [{ ...plan.components[0], count: 1 }] };
  const v = buildTrackerView({ name: 'W', plan: p, state: createInitialState(p), isGM: true });
  expect(v.components[0].instances[0].label).toBe('Rune');
});

test('no disables anywhere is empty and does not throw', () => {
  const p = {
    components: [{ id: 'c1', name: 'X', count: 1, actionsEach: 0, disables: [], counteract: null }],
  };
  const v = buildTrackerView({ name: 'X', plan: p, state: createInitialState(p), isGM: true });
  expect(v.empty).toBe(true);
  expect(v.components[0].instances[0].options).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/ui/trackerView.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

`scripts/ui/trackerView.js`:

```js
import { instanceKey } from '../services/RulesEngine.js';

export function buildTrackerView({ name, plan, state, isGM }) {
  const components = plan.components.map((c) => {
    const instances = state.instances
      .filter((i) => i.componentId === c.id)
      .map((inst) => ({
        key: instanceKey(c.id, inst.index),
        label: c.count > 1 ? `${c.name} ${inst.index + 1}` : c.name,
        disabled: inst.disabled,
        options: c.disables.map((d) => {
          const have = inst.progress?.[d.id] ?? 0;
          const need = d.successesNeeded ?? 1;
          return {
            disableId: d.id,
            label: d.label,
            skill: d.skill,
            dc: d.dc,
            have,
            need,
            pips: Array.from({ length: need }, (_, i) => ({ filled: i < have })),
          };
        }),
      }));
    const counteract = c.counteract
      ? game.i18n.format('PF2E_HAZARDER.Tracker.Counteract', {
          spell: c.counteract.name,
          rank: c.counteract.rank ?? '?',
          dc: c.counteract.dc ?? '?',
        })
      : null;
    return { name: c.name, counteract, counteractUuid: c.counteract?.spellUuid ?? null, instances };
  });
  return {
    title: game.i18n.format('PF2E_HAZARDER.Tracker.Title', { name }),
    status: state.status,
    statusLabel: game.i18n.localize(`PF2E_HAZARDER.Status.${state.status}`),
    empty: plan.components.every((c) => c.disables.length === 0),
    components,
    isGM,
  };
}
```

`scripts/ui/TrackerCard.js`:

```js
import { MODULE_ID } from '../constants.js';
import { buildTag } from '../services/RollMatcher.js';
import {
  getOrCreateState,
  getOrDraftPlan,
  getTrackerMessageId,
  setTrackerMessageId,
} from '../stores/hazardStore.js';
import { buildTrackerView } from './trackerView.js';

const TEMPLATE = `modules/${MODULE_ID}/templates/tracker-card.hbs`;

export async function renderTrackerContent(tokenDoc) {
  const { plan } = getOrDraftPlan(tokenDoc.actor);
  const state = getOrCreateState(tokenDoc, plan);
  const view = buildTrackerView({ name: tokenDoc.name, plan, state, isGM: game.user.isGM });
  return foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    ...view,
    tokenUuid: tokenDoc.uuid,
  });
}

export async function upsertTracker(tokenDoc) {
  const content = await renderTrackerContent(tokenDoc);
  const existing = game.messages.get(getTrackerMessageId(tokenDoc) ?? '');
  if (existing) {
    await existing.update({ content });
    return existing;
  }
  const msg = await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ token: tokenDoc }),
    flags: { [MODULE_ID]: { kind: 'tracker', tokenUuid: tokenDoc.uuid } },
  });
  await setTrackerMessageId(tokenDoc, msg.id);
  return msg;
}

export async function rollDisable({ tokenUuid, instanceKey, disableId }) {
  const tokenDoc = await fromUuid(tokenUuid);
  if (!tokenDoc?.actor) return;
  const { plan } = getOrDraftPlan(tokenDoc.actor);
  const [componentId, index] = instanceKey.split(':');
  const disable = plan.components
    .find((c) => c.id === componentId)
    ?.disables.find((d) => d.id === disableId);
  if (!disable) return;
  const roller = canvas.tokens?.controlled?.[0]?.actor ?? game.user.character;
  if (!roller) {
    ui.notifications.warn(game.i18n.localize('PF2E_HAZARDER.Tracker.NoActor'));
    return;
  }
  const statistic = roller.getStatistic(disable.skill);
  if (!statistic) return;
  await statistic.roll({
    dc: disable.dc != null ? { value: disable.dc } : undefined,
    extraRollOptions: [buildTag(tokenDoc.id, componentId, Number(index), disableId)],
    traits: disable.traits?.filter((t) => !t.includes(':')) ?? [],
  });
}
```

`templates/tracker-card.hbs`:

```hbs
<div class="hazarder-card hz-tracker" data-token-uuid="{{tokenUuid}}">
  <h3>{{title}} <small>({{statusLabel}})</small></h3>
  {{#if empty}}<p>{{localize "PF2E_HAZARDER.Tracker.NoDisables"}}</p>{{/if}}
  {{#each components}}
    <div class="hz-component">
      {{#each instances}}
        <div class="hz-instance {{#if disabled}}disabled{{/if}}" data-instance-key="{{key}}">
          <strong>{{label}}</strong>
          {{#each options}}
            <span class="hz-option">
              {{#each pips}}<span class="hz-pip {{#if filled}}filled{{/if}}" data-hz-action="pip" data-instance-key="{{../../key}}" data-disable-id="{{../disableId}}"></span>{{/each}}
              {{#unless ../disabled}}
                <button type="button" data-hz-action="disable" data-instance-key="{{../key}}" data-disable-id="{{disableId}}">{{label}} ({{skill}} DC {{dc}})</button>
              {{/unless}}
            </span>
          {{/each}}
        </div>
      {{/each}}
      {{#if counteract}}<p class="hz-counteract">@UUID[{{counteractUuid}}]{ {{counteract}} }</p>{{/if}}
    </div>
  {{/each}}
  {{#if isGM}}
    <div class="hz-gm">
      <button type="button" data-hz-action="undo">{{localize "PF2E_HAZARDER.Tracker.Undo"}}</button>
      <button type="button" data-hz-action="reset">{{localize "PF2E_HAZARDER.Tracker.Reset"}}</button>
      <button type="button" data-hz-action="plan">{{localize "PF2E_HAZARDER.Tracker.EditPlan"}}</button>
    </div>
  {{/if}}
</div>
```

Note on `isGM`: the card's content is shared by everyone, so `isGM` is evaluated on the GM client that writes it. Task 11's render hook removes `.hz-gm` for non-GM viewers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/ui/trackerView.test.js && npm run lint`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/ui/trackerView.js scripts/ui/TrackerCard.js templates/tracker-card.hbs tests/ui/trackerView.test.js
git commit -m "feat(ui): disable tracker chat card"
```

---

### Task 10: Hazard runner (GM-side orchestration)

**Files:**

- Create: `scripts/services/HazardRunner.js`, `scripts/ui/TriggeredPrompt.js`
- Test: `tests/services/HazardRunner.test.js`

**Interfaces:**

- Consumes: Tasks 4–9. `OUTCOME_TO_DEGREE`, `MODULE_ID` (Task 1); `getSystemFlags` (Task 1).
- Produces a `HazardRunner` class constructed with injectable deps (for tests):

  ```
  new HazardRunner({
    getCandidates: () => Array<{ tokenId, tokenDoc, plan, state }>,
    resolveToken: (tokenId) => tokenDoc|null,
    store: { getOrDraftPlan, getOrCreateState, setState },
    ui: { upsertTracker(tokenDoc), showTriggered(tokenDoc, plan), notify(text) },
    isWriter: () => boolean,
    now: () => number,
  })
  ```

  Methods:
  - `async handleCheckMessage(message) => { kind, applied: boolean }` — ignores when `!isWriter()`, when `flags["pf2e-hazarder"].applied`, or when context type isn't `skill-check`/`perception-check` or outcome missing. `tagged`/`unique` → `applyResult` + mark message applied. `ambiguous` → `message.setFlag(MODULE_ID, 'candidates', matches)`.
  - `async apply(tokenDoc, { instanceKey, disableId, degree, actorUuid, messageId, userId, isReroll }) => events`
  - `async startHazard(tokenDoc) => State` — ensures state, `activate`, saves, upserts tracker.
  - `async undo(tokenDoc)`, `async reset(tokenDoc)`, `async overridePip(tokenDoc, instanceKey, disableId)` — `overridePip` cycles progress `have → have+1`, wrapping to 0 after `need`.
  - Exported helper `defaultCandidates()` — complex/simple hazard tokens in `game.combat` plus tokens on the viewed scene that have state with status `active` or `triggered`.

- [ ] **Step 1: Write the failing test**

`tests/services/HazardRunner.test.js`:

```js
import { HazardRunner } from '../../scripts/services/HazardRunner.js';
import { createInitialState, activate } from '../../scripts/services/RulesEngine.js';

const plan = {
  version: 1,
  confirmed: true,
  actionsPerTurn: 2,
  components: [
    {
      id: 'c1',
      name: 'Rune',
      count: 1,
      actionsEach: 0,
      disables: [{ id: 'd1', skill: 'thievery', dc: 22, successesNeeded: 1 }],
    },
  ],
  reactionItemId: 'r1',
};

function setup({ writer = true } = {}) {
  const tokenDoc = { id: 't1', name: 'Wheel', state: activate(createInitialState(plan)) };
  const store = {
    getOrDraftPlan: () => ({ plan, warnings: [], isDraft: false }),
    getOrCreateState: (t) => structuredClone(t.state),
    setState: jest.fn(async (t, s) => {
      t.state = s;
    }),
  };
  const ui = { upsertTracker: jest.fn(), showTriggered: jest.fn(), notify: jest.fn() };
  const runner = new HazardRunner({
    getCandidates: () => [{ tokenId: 't1', tokenDoc, plan, state: tokenDoc.state }],
    resolveToken: (id) => (id === 't1' ? tokenDoc : null),
    store,
    ui,
    isWriter: () => writer,
    now: () => 5,
  });
  return { runner, tokenDoc, store, ui };
}

const msg = (context, flags = {}) => ({
  id: 'm1',
  author: { id: 'u1' },
  flags: { pf2e: { context }, 'pf2e-hazarder': flags },
  speaker: { actor: 'a1' },
  setFlag: jest.fn(),
});
const ctx = (over = {}) => ({
  type: 'skill-check',
  outcome: 'success',
  dc: { value: 22 },
  options: ['check:statistic:thievery'],
  ...over,
});

test('unique match applies, marks message, refreshes tracker', async () => {
  const { runner, tokenDoc, ui } = setup();
  const m = msg(ctx());
  const res = await runner.handleCheckMessage(m);
  expect(res).toEqual({ kind: 'unique', applied: true });
  expect(tokenDoc.state.instances[0].disabled).toBe(true);
  expect(tokenDoc.state.status).toBe('disabled');
  expect(m.setFlag).toHaveBeenCalledWith('pf2e-hazarder', 'applied', true);
  expect(ui.upsertTracker).toHaveBeenCalledWith(tokenDoc);
  expect(ui.notify).toHaveBeenCalled();
});

test('crit failure shows triggered prompt', async () => {
  const { runner, ui } = setup();
  await runner.handleCheckMessage(msg(ctx({ outcome: 'criticalFailure' })));
  expect(ui.showTriggered).toHaveBeenCalled();
});

test('non-writer does nothing', async () => {
  const { runner, store } = setup({ writer: false });
  expect(await runner.handleCheckMessage(msg(ctx()))).toEqual({ kind: 'skipped', applied: false });
  expect(store.setState).not.toHaveBeenCalled();
});

test('already applied, wrong type, or no outcome is skipped', async () => {
  const { runner } = setup();
  expect((await runner.handleCheckMessage(msg(ctx(), { applied: true }))).kind).toBe('skipped');
  expect((await runner.handleCheckMessage(msg(ctx({ type: 'attack-roll' })))).kind).toBe('skipped');
  expect((await runner.handleCheckMessage(msg(ctx({ outcome: null })))).kind).toBe('skipped');
});

test('ambiguous stores candidates on the message', async () => {
  const { runner, tokenDoc } = setup();
  runner.getCandidates = () => [
    { tokenId: 't1', tokenDoc, plan, state: tokenDoc.state },
    { tokenId: 't2', tokenDoc, plan, state: tokenDoc.state },
  ];
  const m = msg(ctx());
  expect(await runner.handleCheckMessage(m)).toEqual({ kind: 'ambiguous', applied: false });
  expect(m.setFlag).toHaveBeenCalledWith('pf2e-hazarder', 'candidates', expect.any(Array));
});

test('reroll flag is passed through', async () => {
  const { runner, tokenDoc } = setup();
  await runner.handleCheckMessage(msg(ctx({ outcome: 'failure' })));
  await runner.handleCheckMessage({
    ...msg(ctx({ outcome: 'success', isReroll: true })),
    id: 'm2',
  });
  expect(tokenDoc.state.history.filter((h) => h.kind === 'result')).toHaveLength(1);
});

test('overridePip cycles progress', async () => {
  const p2 = {
    ...plan,
    components: [
      { ...plan.components[0], disables: [{ id: 'd1', skill: 'x', dc: 1, successesNeeded: 2 }] },
    ],
  };
  const { runner, tokenDoc, store } = setup();
  store.getOrDraftPlan = () => ({ plan: p2, warnings: [], isDraft: false });
  tokenDoc.state = activate(createInitialState(p2));
  await runner.overridePip(tokenDoc, 'c1:0', 'd1');
  expect(tokenDoc.state.instances[0].progress.d1).toBe(1);
  await runner.overridePip(tokenDoc, 'c1:0', 'd1');
  expect(tokenDoc.state.instances[0].progress.d1).toBe(2);
  await runner.overridePip(tokenDoc, 'c1:0', 'd1');
  expect(tokenDoc.state.instances[0].progress.d1).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/services/HazardRunner.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

`scripts/services/HazardRunner.js`:

```js
import { MODULE_ID, OUTCOME_TO_DEGREE, STATUS } from '../constants.js';
import { getSystemFlags } from '../systemCompat.js';
import * as Engine from './RulesEngine.js';
import { extractCheck, matchCheck } from './RollMatcher.js';

const CHECK_TYPES = new Set(['skill-check', 'perception-check']);

export function defaultCandidates(store) {
  const seen = new Map();
  const add = (tokenDoc) => {
    if (!tokenDoc?.actor || tokenDoc.actor.type !== 'hazard' || seen.has(tokenDoc.id)) return;
    const { plan } = store.getOrDraftPlan(tokenDoc.actor);
    seen.set(tokenDoc.id, {
      tokenId: tokenDoc.id,
      tokenDoc,
      plan,
      state: store.getOrCreateState(tokenDoc, plan),
    });
  };
  for (const c of game.combat?.combatants ?? []) add(c.token);
  for (const t of canvas.scene?.tokens ?? []) {
    const s = t.getFlag(MODULE_ID, 'state');
    if (s && (s.status === STATUS.ACTIVE || s.status === STATUS.TRIGGERED)) add(t);
  }
  return [...seen.values()];
}

export class HazardRunner {
  constructor({ getCandidates, resolveToken, store, ui, isWriter, now }) {
    this.getCandidates = getCandidates;
    this.resolveToken = resolveToken;
    this.store = store;
    this.ui = ui;
    this.isWriter = isWriter;
    this.now = now;
  }

  async handleCheckMessage(message) {
    const skipped = { kind: 'skipped', applied: false };
    if (!this.isWriter()) return skipped;
    if (message.flags?.[MODULE_ID]?.applied) return skipped;
    const context = getSystemFlags(message)?.context ?? message.flags?.pf2e?.context;
    if (!context || !CHECK_TYPES.has(context.type)) return skipped;
    const degree = OUTCOME_TO_DEGREE[context.outcome];
    if (degree === undefined) return skipped;

    const result = matchCheck(extractCheck(context), this.getCandidates());
    if (result.kind === 'ambiguous') {
      await message.setFlag(MODULE_ID, 'candidates', result.matches);
      return { kind: 'ambiguous', applied: false };
    }
    if (result.kind === 'none') return { kind: 'none', applied: false };
    const [m] = result.matches;
    const tokenDoc = this.resolveToken(m.tokenId);
    if (!tokenDoc) return { kind: result.kind, applied: false };
    await this.apply(tokenDoc, {
      instanceKey: m.instanceKey,
      disableId: m.disableId,
      degree,
      actorUuid: message.speaker?.actor ?? null,
      messageId: message.id,
      userId: message.author?.id ?? null,
      isReroll: !!context.isReroll,
    });
    await message.setFlag(MODULE_ID, 'applied', true);
    return { kind: result.kind, applied: true };
  }

  async apply(tokenDoc, r) {
    const { plan } = this.store.getOrDraftPlan(tokenDoc.actor);
    const state = this.store.getOrCreateState(tokenDoc, plan);
    const { state: next, events } = Engine.applyResult(state, plan, { ...r, at: this.now() });
    await this.store.setState(tokenDoc, next);
    await this.#afterEvents(tokenDoc, plan, events);
    await this.ui.upsertTracker(tokenDoc);
    return events;
  }

  async #afterEvents(tokenDoc, plan, events) {
    for (const e of events) {
      if (e.type === 'hazardTriggered') await this.ui.showTriggered(tokenDoc, plan);
      if (e.type === 'hazardDisabled')
        this.ui.notify(game.i18n.format('PF2E_HAZARDER.Disabled', { name: tokenDoc.name }));
    }
  }

  async startHazard(tokenDoc) {
    const { plan } = this.store.getOrDraftPlan(tokenDoc.actor);
    const state = Engine.activate(this.store.getOrCreateState(tokenDoc, plan));
    await this.store.setState(tokenDoc, state);
    await this.ui.upsertTracker(tokenDoc);
    return state;
  }

  async undo(tokenDoc) {
    const { plan } = this.store.getOrDraftPlan(tokenDoc.actor);
    await this.store.setState(
      tokenDoc,
      Engine.undo(this.store.getOrCreateState(tokenDoc, plan), plan),
    );
    await this.ui.upsertTracker(tokenDoc);
  }

  async reset(tokenDoc) {
    const { plan } = this.store.getOrDraftPlan(tokenDoc.actor);
    await this.store.setState(
      tokenDoc,
      Engine.reset(this.store.getOrCreateState(tokenDoc, plan), plan),
    );
    await this.ui.upsertTracker(tokenDoc);
  }

  async overridePip(tokenDoc, instanceKey, disableId) {
    const { plan } = this.store.getOrDraftPlan(tokenDoc.actor);
    const state = this.store.getOrCreateState(tokenDoc, plan);
    const inst = state.instances.find(
      (i) => Engine.instanceKey(i.componentId, i.index) === instanceKey,
    );
    const disable = plan.components
      .find((c) => c.id === inst?.componentId)
      ?.disables.find((d) => d.id === disableId);
    if (!inst || !disable) return;
    const need = disable.successesNeeded ?? 1;
    const have = inst.progress[disableId] ?? 0;
    const progress = have >= need ? 0 : have + 1;
    const { state: next, events } = Engine.override(state, plan, {
      instanceKey,
      disableId,
      progress,
      disabled: progress >= need,
    });
    await this.store.setState(tokenDoc, next);
    await this.#afterEvents(tokenDoc, plan, events);
    await this.ui.upsertTracker(tokenDoc);
  }
}
```

`scripts/ui/TriggeredPrompt.js`:

```js
export async function showTriggered(tokenDoc, plan) {
  const name = tokenDoc.name;
  const item = plan.reactionItemId ? tokenDoc.actor?.items.get(plan.reactionItemId) : null;
  const fire = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.format('PF2E_HAZARDER.Triggered.Title', { name }) },
    content: `<p>${game.i18n.localize('PF2E_HAZARDER.Triggered.Body')}</p>`,
    yes: { label: game.i18n.localize('PF2E_HAZARDER.Triggered.Fire') },
  });
  if (fire && item) await item.toMessage();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/services/HazardRunner.test.js && npm run lint`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/services/HazardRunner.js scripts/ui/TriggeredPrompt.js tests/services/HazardRunner.test.js
git commit -m "feat(runner): GM-side result application and triggered prompt"
```

---

### Task 11: Hook wiring, API and sheet button

**Files:**

- Create: `scripts/hooks/predicates.js` (pure; keeps the test free of `PlanPanel`, whose module body reads `foundry.applications` at import time), `scripts/hooks/registration.js`, `scripts/api.js`
- Modify: `scripts/main.js`
- Test: `tests/hooks/predicates.test.js`

**Interfaces:**

- Consumes: everything above.
- Produces:
  - `registerHooks(runner) => void`
  - `createRunner() => HazardRunner` (in `api.js`) wired with real deps: `getCandidates: () => defaultCandidates(store)`, `resolveToken: (id) => canvas.scene?.tokens.get(id) ?? game.combat?.combatants.find((c) => c.tokenId === id)?.token ?? null`, `store` = hazardStore module, `ui: { upsertTracker, showTriggered, notify: (t) => ui.notifications.info(t) }`, `isWriter: () => !!game.users.activeGM?.isSelf`, `now: () => game.time.worldTime`.
  - `game.modules.get('pf2e-hazarder').api = { openPlan(actor), startHazard(tokenDoc), runner }`
  - From `scripts/hooks/predicates.js`: `shouldPromptForPlan(actor) => boolean` (true for complex hazards whose stored plan is missing or unconfirmed), `isHazardTurn(combat) => boolean`.

Hooks registered (all GM-gated through `runner.isWriter()` unless noted):

- `createCombatant(combatant)`: if hazard → if `shouldPromptForPlan` → `DialogV2.confirm(PF2E_HAZARDER.Plan.Review)` → yes: `await PlanPanel.open(actor)`; then `runner.startHazard(combatant.token)`.
- `combatTurnChange(combat)`: if `isHazardTurn(combat)` → state disabled and setting `skipDisabledTurns` → `combat.nextTurn()`; else `postTurnCard(combat.combatant)`.
- `createChatMessage(message)`: `runner.handleCheckMessage(message)`.
- `renderChatMessageHTML(message, html)` (all clients): remove `.hz-gm` for non-GM; bind `[data-hz-action]` clicks: `disable` → `rollDisable`; `item` → `(await fromUuid(tokenUuid)).actor.items.get(id).toMessage()`; GM only: `pip` → `runner.overridePip`, `undo` → `runner.undo`, `reset` → confirm with plan `resetText`, then `runner.reset`; `plan` → `PlanPanel.open(actor)` then `runner.startHazard` (re-sync). For GM, if `message.flags['pf2e-hazarder'].candidates` and not applied → append one button per candidate labelled `"<token name> · <instance label>"` that calls `runner.apply(...)` with the message's degree and then sets `applied`.
- `getActorSheetHeaderButtons(sheet, buttons)` (GM): for `sheet.actor.type === 'hazard'` add `{ label: 'Hazard Plan', class: 'hazarder-plan', icon: 'fa-solid fa-list-check', onclick: () => PlanPanel.open(sheet.actor) }`.
- `updateCombat` with `combat.started === false` is not handled in phase 1 (hazard keeps its state).

- [ ] **Step 1: Write the failing test**

`tests/hooks/predicates.test.js`:

```js
import { isHazardTurn, shouldPromptForPlan } from '../../scripts/hooks/predicates.js';

const actor = (flags, isComplex = true) => ({
  type: 'hazard',
  isComplex,
  getFlag: (s, k) => flags[k],
});

test('prompt only for complex hazards without confirmed plan', () => {
  expect(shouldPromptForPlan(actor({}))).toBe(true);
  expect(shouldPromptForPlan(actor({ plan: { version: 1, confirmed: false } }))).toBe(true);
  expect(shouldPromptForPlan(actor({ plan: { version: 1, confirmed: true } }))).toBe(false);
  expect(shouldPromptForPlan(actor({}, false))).toBe(false);
  expect(shouldPromptForPlan({ type: 'npc', getFlag: () => null })).toBe(false);
});

test('isHazardTurn', () => {
  expect(isHazardTurn({ combatant: { actor: { type: 'hazard' } } })).toBe(true);
  expect(isHazardTurn({ combatant: { actor: { type: 'npc' } } })).toBe(false);
  expect(isHazardTurn({ combatant: null })).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/hooks/predicates.test.js`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write implementation**

`scripts/hooks/predicates.js`:

```js
import { getPlan } from '../stores/hazardStore.js';

export function shouldPromptForPlan(actor) {
  if (actor?.type !== 'hazard' || !actor.isComplex) return false;
  const plan = getPlan(actor);
  return !plan || !plan.confirmed;
}

export function isHazardTurn(combat) {
  return combat?.combatant?.actor?.type === 'hazard';
}
```

`scripts/hooks/registration.js`:

```js
import { MODULE_ID, OUTCOME_TO_DEGREE, STATUS } from '../constants.js';
import { getSystemFlags } from '../systemCompat.js';
import { getPlan, getState } from '../stores/hazardStore.js';
import { PlanPanel } from '../ui/PlanPanel.js';
import { rollDisable } from '../ui/TrackerCard.js';
import { postTurnCard } from '../ui/TurnCard.js';
import { isHazardTurn, shouldPromptForPlan } from './predicates.js';

async function confirmReview(actor) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.format('PF2E_HAZARDER.Plan.Title', { name: actor.name }) },
    content: `<p>${game.i18n.format('PF2E_HAZARDER.Plan.Review', { name: actor.name })}</p>`,
  });
}

function bindApplyLater(runner, message, root) {
  // Covers checks rolled while no GM was online: the GM can apply them later.
  if (message.flags?.[MODULE_ID]?.applied || message.flags?.[MODULE_ID]?.candidates?.length) return;
  const context = getSystemFlags(message)?.context ?? message.flags?.pf2e?.context;
  if (!context || !['skill-check', 'perception-check'].includes(context.type)) return;
  if (!runner.getCandidates().length) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.classList.add('hazarder-card');
  btn.textContent = game.i18n.localize('PF2E_HAZARDER.Match.ApplyTo');
  btn.addEventListener('click', () => runner.handleCheckMessage(message));
  root.append(btn);
}

function bindCandidatePicker(runner, message, root) {
  const candidates = message.flags?.[MODULE_ID]?.candidates;
  if (!candidates?.length || message.flags?.[MODULE_ID]?.applied) return;
  const context = getSystemFlags(message)?.context ?? message.flags?.pf2e?.context;
  const degree = OUTCOME_TO_DEGREE[context?.outcome];
  if (degree === undefined) return;
  const box = document.createElement('div');
  box.classList.add('hazarder-card', 'hz-picker');
  box.innerHTML = `<p>${game.i18n.localize('PF2E_HAZARDER.Match.ApplyTo')}</p>`;
  for (const c of candidates) {
    const tokenDoc = runner.resolveToken(c.tokenId);
    if (!tokenDoc) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${tokenDoc.name} · ${c.instanceKey}`;
    btn.addEventListener('click', async () => {
      await runner.apply(tokenDoc, {
        instanceKey: c.instanceKey,
        disableId: c.disableId,
        degree,
        actorUuid: message.speaker?.actor ?? null,
        messageId: message.id,
        userId: message.author?.id ?? null,
        isReroll: !!context.isReroll,
      });
      await message.setFlag(MODULE_ID, 'applied', true);
    });
    box.append(btn);
  }
  root.append(box);
}

async function onCardClick(runner, event) {
  const el = event.target.closest('[data-hz-action]');
  if (!el) return;
  const card = el.closest('[data-token-uuid]');
  const tokenUuid = el.dataset.tokenUuid ?? card?.dataset.tokenUuid;
  const action = el.dataset.hzAction;
  if (action === 'disable') {
    return rollDisable({
      tokenUuid,
      instanceKey: el.dataset.instanceKey,
      disableId: el.dataset.disableId,
    });
  }
  const tokenDoc = tokenUuid ? await fromUuid(tokenUuid) : null;
  if (!tokenDoc) return;
  if (action === 'item') return tokenDoc.actor?.items.get(el.dataset.itemId)?.toMessage();
  if (!game.user.isGM) return;
  if (action === 'pip')
    return runner.overridePip(tokenDoc, el.dataset.instanceKey, el.dataset.disableId);
  if (action === 'undo') return runner.undo(tokenDoc);
  if (action === 'reset') {
    const resetText = getPlan(tokenDoc.actor)?.resetText ?? '';
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('PF2E_HAZARDER.Tracker.Reset') },
      content: `<p>${resetText}</p>`,
    });
    if (ok) return runner.reset(tokenDoc);
    return;
  }
  if (action === 'plan') {
    const saved = await PlanPanel.open(tokenDoc.actor);
    if (saved) return runner.startHazard(tokenDoc);
  }
}

export function registerHooks(runner) {
  Hooks.on('createCombatant', async (combatant) => {
    if (!runner.isWriter() || combatant.actor?.type !== 'hazard' || !combatant.token) return;
    if (shouldPromptForPlan(combatant.actor) && (await confirmReview(combatant.actor))) {
      await PlanPanel.open(combatant.actor);
    }
    await runner.startHazard(combatant.token);
  });

  Hooks.on('combatTurnChange', async (combat) => {
    if (!runner.isWriter() || !isHazardTurn(combat)) return;
    const state = getState(combat.combatant.token);
    if (state?.status === STATUS.DISABLED && game.settings.get(MODULE_ID, 'skipDisabledTurns')) {
      await combat.nextTurn();
      return;
    }
    await postTurnCard(combat.combatant);
  });

  Hooks.on('createChatMessage', (message) => {
    runner.handleCheckMessage(message).catch((err) => console.error(`${MODULE_ID} |`, err));
  });

  Hooks.on('renderChatMessageHTML', (message, html) => {
    if (!game.user.isGM) html.querySelectorAll('.hz-gm').forEach((el) => el.remove());
    if (html.querySelector('.hazarder-card')) {
      html.addEventListener('click', (event) => onCardClick(runner, event));
    }
    if (game.user.isGM) {
      bindCandidatePicker(runner, message, html);
      // Only offer "apply later" for messages older than this session's live handling.
      if (Date.now() - (message.timestamp ?? 0) > 5000) bindApplyLater(runner, message, html);
    }
  });

  Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
    if (!game.user.isGM || sheet.actor?.type !== 'hazard') return;
    buttons.unshift({
      label: 'Hazard Plan',
      class: 'hazarder-plan',
      icon: 'fa-solid fa-list-check',
      onclick: () => PlanPanel.open(sheet.actor),
    });
  });

  Hooks.on('updateActor', async (actor, changes) => {
    if (!runner.isWriter() || actor.type !== 'hazard') return;
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.plan`)) return;
    for (const t of actor.getActiveTokens(false, true)) {
      if (getState(t)) await runner.startHazard(t);
    }
  });
}
```

Note on `updateActor`: `startHazard` re-syncs state to the edited plan and refreshes the tracker — this is the "plan edited mid-combat" path from Review Focus #5. It also re-activates an armed hazard whose plan changed; that is acceptable in phase 1 because editing a plan only happens when the GM is actively running the hazard.

`scripts/api.js`:

```js
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
```

`scripts/main.js` (replace whole file):

```js
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
```

- [ ] **Step 4: Run tests and lint**

Run: `npm test && npm run lint`
Expected: all suites PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/hooks scripts/api.js scripts/main.js tests/hooks/predicates.test.js
git commit -m "feat: wire hooks, chat card actions, sheet button and API"
```

---

### Task 12: Live verification, README, CHANGELOG

**Files:**

- Create: `tests/live/run.mjs`, `README.md`, `CHANGELOG.md`
- Reference: `../pf2e-afflictioner/tests/live/run.mjs` (copy its connection/login/world-launch helpers; do not reinvent them)

**Interfaces:**

- Consumes: `game.modules.get('pf2e-hazarder').api` (Task 11).

- [ ] **Step 1: Write the live harness**

Copy `../pf2e-afflictioner/tests/live/run.mjs` to `tests/live/run.mjs` and replace its scenario list with the steps below. Keep its existing helpers for launching/attaching to Foundry, logging in as GM and as a player in a second browser context, and `page.evaluate`. Each scenario runs inside `page.evaluate` on the GM page unless marked _player_:

1. Import "Wheel of Misery" from `pf2e.hazards` into the world; place a token on the active scene; create a combat with the token and one PC.
2. Assert the review dialog opened; click Save in the `PlanPanel` (`.hazarder-plan button[type=submit]`).
3. Assert `actor.getFlag('pf2e-hazarder','plan').confirmed === true` and a chat message with `flags['pf2e-hazarder'].kind === 'tracker'` exists.
4. Advance turns until the hazard's turn; assert a whispered message with `flags['pf2e-hazarder'].kind === 'turn'`.
5. _Player_: control the PC token, click the first `[data-hz-action="disable"]` button on the tracker card.
6. GM: wait for the resulting check message; assert it has `flags['pf2e-hazarder'].applied === true` and the token state changed (progress incremented, or status `triggered` on crit fail).
7. GM: `api.runner.apply(tokenDoc, { instanceKey, disableId, degree: 3 })` for every remaining instance; assert status `disabled`.
8. GM: click Reset on the tracker card and confirm; assert status `armed`.
9. Cleanup: delete combat, token and actor.

Run: `npm run test:live`
Expected: every scenario prints `PASS`. If a step fails, fix the code (not the assertion) and rerun.

- [ ] **Step 2: Write README and CHANGELOG**

`README.md`:

```markdown
# PF2e Hazarder

Run Pathfinder 2e and Starfinder 2e hazards in Foundry VTT v14.

## Phase 1 features

- **Hazard plans**: parses a hazard's routine and disable text into actions per turn, components, disable options and counteracts. The GM reviews and saves once; the plan lives on the actor.
- **GM turn card**: on the hazard's turn, shows remaining actions (reduced as components are disabled), the routine, and buttons for its Strikes and actions.
- **Disable tracker**: one chat card per hazard token with per-component progress. Players roll from the card; results from inline checks or check requests are matched automatically, ambiguous ones get a GM picker.
- **States**: armed, triggered, active, disabled, reset. Critical failures prompt the GM to post the reaction.

## Usage

Add a complex hazard to combat. Review the plan when asked, then run combat as normal. GMs can open the plan from the hazard sheet header ("Hazard Plan") or via `game.modules.get('pf2e-hazarder').api.openPlan(actor)`.

## Settings

- Public hazard turn card
- Skip disabled hazards
- Remove disabled hazards from combat
```

`CHANGELOG.md`:

```markdown
# Changelog

## 0.1.0

- Phase 1: hazard plans, GM turn card, disable tracker, triggered/disabled/reset states.
```

- [ ] **Step 3: Full verification**

Run: `npm test && npm run lint && npm run test:live`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/live README.md CHANGELOG.md
git commit -m "test: live harness for phase 1; docs"
```

---

## Notes for the implementer

- `removeDisabledFromCombat` is registered in Task 1 but only consumed if you add this to `HazardRunner.#afterEvents` in Task 10: on `hazardDisabled`, if `game.settings.get(MODULE_ID, 'removeDisabledFromCombat')`, delete the combatant whose `tokenId === tokenDoc.id` from `game.combat`. Do it in Task 10 Step 3 and keep the Task 10 tests passing (the test deps don't define `game.combat`, so guard with `game.combat?.`).
- Never import `scripts/ui/*.js` files that touch `foundry.applications` from pure modules (`parser/`, `services/RulesEngine.js`, `services/RollMatcher.js`, `ui/*View.js`, `ui/planForm.js`) — they must stay loadable in Jest without Foundry.
- `HazardRunner.js` imports only pure modules plus `systemCompat.js`; UI functions arrive through the `ui` dependency.
