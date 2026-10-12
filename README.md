# PF2e Hazarder

Run Pathfinder 2e and Starfinder 2e complex hazards in Foundry VTT v14 — the routine, the action pool, the disable checks and the hazard's state, without bookkeeping on scrap paper.

## Features

- **Hazard plans** — reads a hazard's routine and disable text and turns it into a plan: actions per turn, components, disable options (skill, DC, successes needed) and counteracts. The GM only reviews it when the parser flagged something; the plan lives on the actor (the base actor for unlinked tokens).
- **GM turn card** — on the hazard's turn: remaining actions as PF2e action glyphs (fewer as components are disabled), the routine, its actions with description, traits and save buttons, and buttons for its Strikes (attack, damage, critical). Using an action spends it automatically; spent-out buttons lock.
- **Action pool in the combat tracker** — the hazard's remaining actions show on its row in the core tracker and the PF2e HUD tracker; click a glyph to spend or refund an action.
- **Disable tracker** — one chat card per hazard token with per-component progress, posted at combat start and kept within reach on player turns. Players roll disable checks straight from the card; results from inline checks or check requests are matched to the right hazard automatically, and ambiguous ones get a GM picker. DCs follow PF2e's metagame "show DCs" setting.
- **States** — armed, triggered, active, disabled and reset. Critical failures prompt the GM to post the hazard's reaction; disabled hazards can skip their turn or leave combat.
- **PF2e Toolbelt** — when its Target Helper is active, save requests from the turn card carry the current targets.

## Usage

Add a complex hazard to combat and run combat as normal. Review the plan if asked. GMs can open the plan from the hazard sheet header (**Hazard Plan**) or with `game.modules.get('pf2e-hazarder').api.openPlan(actor)`.

## Settings

| Setting | Scope | Default |
|---|---|---|
| Public hazard turn card — also post a short public card on the hazard's turn | world | off |
| Skip disabled hazards — advance past a disabled hazard's turn | world | on |
| Remove disabled hazards from combat — once every component is disabled | world | off |
| Debug logging | client | off |

## Requirements

Foundry VTT v14 · PF2e 8.0+ or SF2e 1.0+. Optional: PF2e HUD, PF2e Toolbelt.

## Development

`npm test` (Jest), `npm run lint`. `npm run test:live` drives a real, disposable Foundry world with Playwright through the main hazard scenarios; it is manual only, never runs in CI and is not shipped — never run it in a campaign world.
