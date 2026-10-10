# PF2e Hazarder — Design

Date: 2026-10-10
Status: Approved in brainstorming, pending spec review

## Goal

Run Pathfinder 2e / Starfinder 2e hazards in Foundry VTT v14 end to end. The pf2e system already gives complex hazards Stealth initiative and counts hazard XP, but `routine`, `disable` and `reset` are display-only rich text with no state. Hazarder adds structured plans, live state, turn cards, multi-success disable tracking, triggering and reset.

Delivery in three phases, phase 1 first:

1. **Complex hazards in combat** — turn card, disable tracker, triggered/disabled/reset states.
2. **Full trap lifecycle** — region triggers, simple hazards, timed reset.
3. **Authoring** — full plan editor, compendium bulk review, optional curated overrides.

## Non-goals

- Detection / Seek against hazards (pf2e-visioner covers this).
- Initiative rolling and XP math (pf2e system covers this; Hazarder only flags outcomes).
- Hazard stat-block creation (PF2e Hazard Maker).

## Facts the design relies on

Verified against pf2e 8.6.0 `hazards` pack (53 hazards, 16 complex):

- 15/16 complex routines start with `(N actions)`.
- Disable text uses inline checks: `@Check[thievery|dc:32|name:Disable Telekinetic Decoration|traits:action:disable-a-device]`, counteract options use `@UUID[...spells-srd...]{Dispel Magic} (6th rank; counteract DC 30)`.
- Multi-component and multi-success rules are prose ("each mannequin uses three of the haunt's actions… loses three actions for every disabled mannequin", "Religion (expert) twice", "each rune").
- Reactions are `action` items with `actionType: reaction`; Strikes are `melee` items.
- Rules (AoN): crit success on a disable counts as two successes on a multi-success component; crit failure triggers the hazard.

## Compatibility and conventions

- Module id `pf2e-hazarder`. Foundry minimum 14, verified 14. Systems pf2e (min 8.0.0) and sf2e (min 1.0.0).
- Layout and tooling mirror pf2e-afflictioner: `scripts/{main,api,constants,settings,systemCompat}.js`, `scripts/{parser,stores,services,hooks,ui,regions}/`, Jest + Babel, ESLint + Prettier, Husky, live test harness under `tests/live/`.
- Localization in `lang/en.json`.

## Data model

### Hazard plan (per actor)

Stored at `actor.flags["pf2e-hazarder"].plan`. Shared by all tokens of that actor.

```js
{
  version: 1,
  confirmed: true,            // false = parser draft, never reviewed
  actionsPerTurn: 9,          // null for simple hazards
  components: [
    {
      id: "c1",
      name: "Mannequin",
      count: 3,               // instances of this component
      actionsEach: 3,         // actions removed from the pool when an instance is disabled; 0 if none
      disables: [
        { id: "d1", skill: "thievery", dc: 37, label: "Jam mechanisms",
          traits: ["clockwork", "haunt"], successesNeeded: 1 }
      ],
      counteract: { spellUuid: "Compendium.pf2e.spells-srd.Item.…", rank: 6, dc: 30 } // or null
    }
  ],
  reactionItemId: "…",        // or null
  routineItemIds: ["…"],      // Strikes/actions offered as buttons on the turn card
  resetText: "…",             // copied for display
  resetAfterSeconds: null     // phase 2
}
```

A hazard with no explicit components gets one implicit component (`count: 1`, `actionsEach: 0`) holding all disables.

### Live state (per token)

Stored at `tokenDoc.flags["pf2e-hazarder"].state`.

```js
{
  version: 1,
  status: "armed" | "triggered" | "active" | "disabled" | "reset",
  // progress is per disable option: a mannequin needs 1 Thievery success OR 2 Religion successes
  instances: [ { componentId: "c1", index: 0, progress: { d1: 0, d2: 1 }, disabled: false } ],
  history: [ { at, kind, instanceKey, delta, messageId, userId } ] // for undo
}
```

`actionsRemaining = actionsPerTurn - sum(actionsEach for disabled instances)`, floored at 0. Derived, not stored.

### Status transitions

- `armed` → `triggered` on: region trigger (phase 2), disable crit failure, or GM action.
- `triggered` → `active` when the hazard is in combat.
- any → `disabled` when every instance is disabled.
- `disabled` / `active` → `reset` → `armed` via the reset button (phase 1) or timer (phase 2). Reset clears successes and instance flags.

## Units

### `parser/` (pure, no Foundry globals)

`draftPlan(hazardSource) → { plan, warnings[] }`.

- Parses `@Check[...]` params (skill, dc, name, traits) into disable entries.
- Parses `@UUID[...spells-srd...]{Name} (Nth rank; counteract DC X)` into counteract.
- Parses `(N actions)` from routine into `actionsPerTurn`.
- Heuristics with warnings (never certainty): "twice" / "N times" → `successesNeeded`; "each <noun>" / "for every disabled <noun>" → component name; "uses N of the … actions" → `actionsEach`.
- Unparseable pieces become empty fields plus a warning. The parser never throws.

### `stores/`

`getPlan(actor)`, `setPlan(actor, plan)`, `getState(tokenDoc)`, `setState(tokenDoc, state)`, `migratePlan`, `migrateState`. Version mismatches migrate or fall back to a fresh draft.

### `services/`

- `RulesEngine` (pure): `applyResult(state, plan, { instanceKey, degree })` → `{ state, events[] }` where events include `componentDisabled`, `hazardDisabled`, `hazardTriggered`. Success +1, crit success +2, failure 0, crit failure → trigger. Also `actionsRemaining(state, plan)`, `undo(state)`, `reset(state, plan)`.
- `RollMatcher` (pure): given a check message context `{ skill, dc, label, rollOptions }` and active hazard plans/states, returns `{ kind: "tagged" | "unique" | "ambiguous" | "none", candidates }`. Tagged = roll option `hazarder:instance:<tokenId>:<componentId>:<index>`.
- `HazardRunner` (GM side): wires hooks, engine, stores and UI. Single writer.

### `hooks/`

- `combatTurnChange` / `updateCombat`: hazard's turn → post GM turn card.
- `createCombatant`: complex hazard without confirmed plan → prompt GM to review.
- `createChatMessage`: pf2e check with skill + DC → `RollMatcher` → apply or show "Apply to…" picker.
- `deleteToken`: drop state.

### Player → GM transport

Players never write hazard flags. Every check posts a chat message, and `createChatMessage` fires on the active GM's client, so the active GM is the single writer: it matches and applies results it observes. No player-initiated write exists in phase 1, so no `User#query` handler is needed yet (revisit if a later phase adds player-side writes). Applied messages get `flags.pf2e-hazarder.applied = true`. If no GM is online, rolls post normally and nothing is applied; the GM later sees an "Apply to hazard" control on unapplied hazard-tagged or matching messages.

### `ui/` (ApplicationV2)

- **Plan confirm panel**: shows parsed draft with warnings highlighted; edit actions per turn, components (name, count, actionsEach), disables (skill, DC, label, successesNeeded), counteract, reaction and routine items. Save sets `confirmed: true`. Phase 3 grows this into the full editor.
- **GM turn card** (whispered chat message): action pips (`actionsRemaining / actionsPerTurn`, disabled-instance note), routine text enriched, buttons for routine items. Setting: also post a public flavor card.
- **Disable tracker card** (one chat message per active hazard token, updated in place): per component/instance progress, disable buttons (roll selected token's skill via pf2e statistic with DC, label, traits and tagged roll option), counteract buttons (link spell). GM right-click on a pip: adjust, toggle disabled, undo last.
- **Triggered prompt** (GM): on crit failure, offer to fire the reaction item or note an extra routine.

## Phase 1 flow

1. GM adds complex hazard token to combat. If plan missing or unconfirmed → review prompt (GM may skip; draft is used).
2. Status becomes `active`; disable tracker card posted.
3. Hazard's turn → GM turn card with current action pool.
4. Disable attempt (player button, inline `@Check`, pf2e check request, or Storyframe) → check message → matched → applied on GM client → tracker card updated.
5. Crit failure → `triggered` prompt. All instances disabled → `disabled`, turns skipped; setting to remove from combat.
6. Reset button → shows reset text → state back to `armed`.

## Phase 2 (outline)

- Region behavior `pf2e-hazarder.trigger` linked to a hazard token; filters: party members / all creatures, only when armed.
- Trigger: fire reaction item; complex → start combat or add to current (reaction resolves before initiative); post tracker.
- Simple hazards: one card with reaction, save/attack, single-success disable.
- Timed reset: parse duration from reset text into `resetAfterSeconds` (GM-confirmed), schedule on world time.
- Flag outcome `overcome` for XP modules.

## Phase 3 (outline)

- Full plan editor from the hazard sheet header.
- Compendium bulk review: iterate a pack's hazards, show parse warnings, confirm each.
- Optional shipped override data for official hazards, applied over the parser draft.

## Error handling

- Parser never throws; gaps become blank fields + warnings.
- Version mismatch → migrate or re-draft.
- No GM online → nothing applied, nothing lost.
- Ambiguous roll match → GM picker, never a guess.
- Every state change records history; undo from the card.

## Testing

- **Jest unit**
  - Parser: fixtures extracted from pf2e `hazards` pack and AP bestiary packs (all complex + simple hazards); snapshot of drafts and a parse-coverage metric (share of hazards with actions-per-turn and ≥1 disable parsed, no warnings).
  - RulesEngine: all degree transitions, multi-component pools, crit-success double, crit-failure trigger, undo, reset.
  - RollMatcher: tagged, unique, ambiguous, none.
- **Live harness** (pattern from pf2e-afflictioner): add complex hazard to combat, plan prompt, hazard turn card, player-client disable roll via query, crit failure trigger, full disable, reset.

## Open questions

None blocking phase 1. Phase 2 trigger filters and reset-duration parsing will be detailed in the phase 2 plan.
