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

## Live tests

`npm run test:live` drives a real Foundry world with Playwright (GM and player browsers) through nine scenarios: import Wheel of Misery, review and save its plan, hazard turn card, a player disable roll, applying results, disabling every instance, reset, and cleanup. It is manual only: it never runs in CI and is not shipped.

1. Launch a disposable Foundry 14 / PF2e world with this checkout and pf2e-hazarder enabled. The world id must be `visioner-qa`, or set `VISIONER_DISPOSABLE_WORLD`; the runner refuses any other world.
2. Run `npm install` and `npx playwright install chromium` once.
3. Run `npm run test:live`. It prompts for the Foundry URL and the GM and player account names and passwords (a player owning no other tokens is best). `VISIONER_FOUNDRY_URL`, `VISIONER_GM_USER`, `VISIONER_GM_PASSWORD`, `VISIONER_PLAYER_USER`, `VISIONER_PLAYER_PASSWORD` and `~/.config/pf2e-visioner/live.json` supply defaults.
4. Each scenario prints `PASS` or `FAIL`. All created documents are flagged and removed afterwards; if a run dies, `npm run test:live:cleanup` recovers from the journal in `artifacts/live/`.

Never run it in a campaign world.
