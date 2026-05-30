# Build-Up Lab Task Tracker

Start with `docs/master_plan.md` for the current step-by-step roadmap. This file tracks checklist status only.

## Archive Status

- [x] Archived previous Pass Master prototype docs.
- [x] Archived review screenshots.
- [x] Kept current `index.html` as the technical starting point.

Archive path:

`docs/archive/2026-05-28-pass-master-prototype/`

## Milestone 1: Product Reframe

- [x] Rename game title to Build-Up Lab.
- [x] Update subtitle to Beat the Press.
- [x] Replace goal-only objective with target-zone objective.
- [x] Replace generic item labels with tactical action labels.
- [x] Update first 3 levels to teach build-up concepts.
- [x] Update result copy to tactical rating language (S/A/B Grade Emblem).

## Milestone 2: Tactical Visibility

- [x] Draw pressing radius.
- [x] Draw cover-shadow cones.
- [x] Preview pass lane safety (Cyan safe, Orange risky, Red blocked).
- [x] Show target zone (Dashed tactical borders and labels).
- [x] Show "free man" hint in tutorial levels.
- [x] Explain failure cause visually (Drill Interrupted overlay + context).

## Milestone 3: Tactical Actions

- [x] Implement Bounce Pass (Quick one-two Connector multi-stage route).
- [x] Implement Third-Man Run (Blind-side coordinate modifier and connect).
- [x] Implement Switch Play (Lobbed lofted pass over pressing block).
- [x] Implement Drop Pivot (Midfielder deep drop CB space modifier).
- [x] Restrict actions per level.
- [x] Record action usage for scoring.

## Milestone 4: Level Rebuild

- [x] Design 20 build-up puzzle levels.
- [x] Document intended solution for each level.
- [x] Remove unintended shortcuts.
- [x] Tune action limits.
- [x] Tune S/A/B ratings.

## Milestone 5: Solver And Validation

- [x] Replace static-only solver (BFS algorithm with presser/cover shadow compatibility).
- [x] Include opponent shifts in validation.
- [x] Include cover shadows in validation.
- [x] Validate all level solutions.
- [x] Add console test summary for all levels.

## Milestone 6: Mobile Test Build

- [x] Improve portrait layout.
- [x] Ensure 44px minimum touch targets.
- [x] Add shareable clear summary.
- [x] Add simple replay or route summary.
- [x] Prepare a 20-person external test.

## Milestone 7: Critical Fixes & Balancing

- [x] Fix Bounce/Third-Man Stage 2 cover shadow holder selection (connector instead of original holder).
- [x] Prohibit direct passes to target zone when a tactical action is active (prevent action waste and preview desync).
- [x] Balance Level 6 & 7 scenarios to prevent bypassing tactical concepts via simple short passes.
- [x] Enforce target player verification for Third-Man and Drop Pivot inside tryPass() to align runtime logic with the solver.
- [x] Balance Level 16, 18, and 20 layouts/parameters to force advanced multi-stage build-ups (3-4 passes) and solve in optimal rating.
- [x] Reclassify the 20 levels into a 4-tab Tactical Training Board structure (Tutorials, Patterns, Shapes, Challenges) with details cards.
- [x] Refine in-game and result screen terms into tactical football coaching vocabulary (Action Limit, Reset Shape, Adjust Pass, Press Escaped).
- [x] Validate all 20 levels using Playwright script to verify S-Grade solvability.

## Milestone 8: UI Fine-Tuning & Unicode Clean-up

- [x] Resolve Unicode character breakdown issues by replacing arrows, emojis, and dashes with clean ASCII symbols.
- [x] Rename the third tab from SHAPES to PRESS SHAPES for enhanced tactical clarity.
- [x] Inject tab-specific training descriptions dynamically below the tab headers.

## Milestone 9: Positional Play Upgrade

- [x] Add five vertical pitch channels.
- [x] Highlight half-spaces on the tactical board.
- [x] Label target zones with their channel.
- [x] Show lines broken and target channel on the result screen.
- [x] Add level metadata: ourShape, opponentShape, pressingIdea, buildUpAnswer, intendedConcept.
- [x] Add scenario briefing panel before each drill.
- [x] Add lane quality states: safe, risky, baited, blocked, line-breaking.
- [x] Add trap zone data model and rendering.
- [x] Add trap-zone trigger logic.
- [ ] Add defender roles beyond type: firstPresser, screenPivot, trapWide, farSideLock.
- [ ] Upgrade S/A/B rating to include concept bonus and trap-risk penalty.

## Milestone 10: Pressing System Depth

- [ ] Implement 4-4-2 high press behavior as a named scheme.
- [ ] Implement 4-3-3 press behavior as a named scheme.
- [ ] Implement man-oriented press assignments.
- [ ] Implement wide trap collapse after receiver enters trap zone.
- [ ] Implement back-pass and wide-receive pressing triggers.
- [ ] Rebuild advanced levels around explicit pressing ideas and build-up answers.

## Milestone 11: Contributor Prototype Integration

- [x] Review `football/` contributor prototype.
- [x] Identify reusable design and logic ideas.
- [x] Refactor lane checks into a pure `evaluateLane` helper.
- [x] Add `receiverState` helper for free/pressured/trapped receiver status.
- [x] Extend `receiverState` into free/underPressure/backToGoal/trapped states with precise fail reasons.
- [x] Convert tactical actions into data-driven action card definitions.
- [x] Add scenario briefing from level metadata.
- [x] Add tactical ticker/log for route feedback.
- [x] Implement Tactical Guides checkbox controls for Pressing Radius, Cover Shadows, Halfspace Channels, and Engagement Lines.
- [x] Render faded tactical sub-roles below player labels (e.g. DEEP PIVOT, MEZZALA).
- [x] Render Switch play lob pass 3D trajectory (flight y-offset & linear dotted shadow ground path).
- [x] Replace blocked X markers on pass lanes with rectangular CUT badges.
- [ ] Consider Direct Drag as a later alternate input mode.

## Milestone 12: World Stage Reframe

- [x] Define world-stage positioning without committing to full 11v11 simulation.
- [x] Document licensing-safe language: World Stage, International Matchday, Knockout Drill.
- [x] Add match context metadata: minute, scoreState, stageLabel, teamPalette.
- [x] Render match context in scenario cards and briefing modal.
- [x] Update share summary into a world-stage challenge result.
- [x] Add faded 11v11 off-ball context as non-interactive visual framing.

## Milestone 13: Match Moment Packaging

- [x] Add match context to the result modal.
- [x] Add one-line solved moment recap to the result modal.
- [x] Include solved moment recap in the share summary.
- [x] Add a compact visual share card layout.
- [x] Add a daily/featured match moment entry point.

## Milestone 14: Gameplay Reform

- [x] Define why the current structure is not fun enough.
- [x] Document the new pressure-manipulation core loop.
- [x] Add pressure meter data model and UI.
- [x] Add visible post-pass movement animation for our support shape and opponent press shift.
- [x] Add body orientation rendering for attackers and defenders.
- [x] Reframe cover shadow as a defender body-orientation shadow over our teammate.
- [x] Add passer body-angle risk to lane evaluation.
- [x] Make pass concepts visually distinct: direct to-feet, bounce wall pass, third-man, and long space drop.
- [x] Model long space passes as runner movement into a landing zone.
- [x] Show space-pass landing read: open, contested, trap, or no-space with reason.
- [ ] Add pressure changes to pass, carry, tactical action, trap, and reset outcomes.
- [ ] Add `requiredConcepts` and `forbiddenShortcuts` level metadata.
- [ ] Upgrade S/A/B scoring to include pressure and intended concept completion.
- [x] Add a simple Carry action for angle creation.
- [ ] Implement named press schemes: 442HighPress, 433MidPress, WideTrap, ManLock.
- [ ] Rebuild five flagship levels as a Reform Test Pack.
- [ ] Add solver/report checks that compare optimal route against intended concepts.
