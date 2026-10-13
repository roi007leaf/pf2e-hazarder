# Changelog

## 0.1.2 (prerelease)

- **Proficiency requirements:** disable options marked "(trained)", "(expert)", "(master)" or "(legendary)" record a minimum rank, shown as a badge on the tracker and editable in the plan. Under-ranked characters can't roll from the tracker, and under-ranked rolls from chat are not counted (a warning tells the GM). Toggle with the "Enforce proficiency requirements" setting (on by default).

## 0.1.1 (prerelease)

- **"Any combination" disables:** a component can require N successes across all its disable options combined (e.g. three Occultism or Religion successes in any mix). Detected from the disable text and editable in the plan as "Successes in any combination". The tracker shows the shared total.

## 0.1.0 (prerelease)

First release.

- **Hazard plans:** routine and disable text parsed into actions per turn, components, disable options and counteracts; the GM reviews only when something was flagged.
- **GM turn card:** remaining actions as PF2e action glyphs, the routine, actions with descriptions, traits and save buttons, and Strike buttons; actions are spent automatically and spent-out buttons lock.
- **Combat tracker:** the hazard's remaining actions on its row in the core and PF2e HUD trackers — click to spend or refund.
- **Disable tracker:** a chat card per hazard token with per-component progress, posted at combat start; players roll from the card, results are matched automatically, and DCs respect PF2e's metagame setting.
- **States:** armed, triggered, active, disabled, reset — with a reaction prompt on critical failures and optional skipping or removal of disabled hazards.
- **PF2e Toolbelt:** save requests carry Target Helper targets.
