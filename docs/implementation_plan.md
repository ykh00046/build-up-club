# Build-Up Lab Implementation Plan

## Current Codebase Starting Point

The project currently has a single-file canvas prototype in `index.html`.

Reusable parts:

- Canvas rendering loop.
- Level data structure.
- Player and defender drawing.
- Pass animation.
- Interception checks.
- Scene states: title, level map, game, result.
- Undo, reset, localStorage progress.
- Basic audio and effects.

Parts to replace or heavily revise:

- Generic item system.
- Existing 10 levels.
- Star-only scoring.
- Static defender-only solver.
- Mobile layout and touch targets.
- Encoded/garbled documentation.

## Phase 1: Rename And Reframe

Goal: make the current prototype clearly communicate the new idea.

Tasks:

- Change title from Pass Master to Build-Up Lab.
- Replace "Soccer Puzzle Game" copy with "Beat the Press".
- Replace item names with tactical action names.
- Rename level concepts around build-up scenarios.
- Add a visible target zone instead of only the goal.
- Update fail messages to explain tactical failure.

Done when:

- First screen communicates build-up/press escape.
- Level 1 teaches "find the free man."
- The game no longer feels like a generic pass-to-goal puzzle.

## Phase 2: Tactical Model

Goal: add the minimum tactical vocabulary needed for build-up puzzles.

Data model additions:

```js
{
  ourShape: "2-3",
  opponentShape: "4-4-2 press",
  targetZone: { x, y, w, h, label },
  tacticalActions: ["bounce", "thirdMan"],
  defenders: [
    {
      type: "presser",
      pressureRadius,
      coverShadowAngle,
      coverShadowLength,
      assignment
    }
  ]
}
```

Implementation tasks:

- Draw target zones.
- Draw cover-shadow cones.
- Add lane evaluation: safe, risky, blocked.
- Add opponent shift after each action.
- Add trapped-receiver detection.

Done when:

- A blocked lane can be blocked by either radius or cover shadow.
- The player can see why a pass is dangerous before committing.
- Opponent shape changes predictably after each action.

## Phase 3: Tactical Actions

Goal: replace power-up items with football-native actions.

Actions for MVP:

- Bounce Pass: counts as one action but routes through a connector.
- Third-Man Run: reveals or activates a forward passing option.
- Switch Play: extends range toward weak side if the lane is open.
- Drop Pivot: moves pivot into a temporary support position.

Implementation tasks:

- Create action state separate from pass state.
- Add per-level allowed actions.
- Add action-specific validation.
- Add visual previews for each action.
- Record action usage for scoring.

Done when:

- Each action has a clear football purpose.
- Actions solve specific tactical problems instead of bypassing all rules.

## Phase 4: Level Rebuild

Goal: create 20 validated build-up puzzles.

Level set:

- 1-5: free man and blocked lane basics.
- 6-10: bounce pass and third-man basics.
- 11-15: switches and side traps.
- 16-20: 4-4-2 and 4-3-3 press scenarios.

Validation tasks:

- Build a solver that accounts for defender shifts.
- Verify each level has at least one solution.
- Verify the intended route matches S rating.
- Verify no unintended one-action shortcut exists unless designed.

Done when:

- All 20 levels have documented intended solutions.
- Solver result and level scoring agree.

## Phase 5: Mobile And Sharing

Goal: make the prototype testable by real users.

Tasks:

- Improve vertical mobile layout.
- Ensure touch targets are at least 44px.
- Add daily challenge seed placeholder.
- Add share text after clear.
- Add simple route replay or route summary.

Done when:

- The game is playable on a phone without zooming.
- A cleared level can be shared as a short challenge.

## Phase 6: Positional Play Depth

Goal: move from a tactics-themed puzzle into a credible build-up/pressing model.

Already started in `index.html`:

- Five vertical channels: left wing, left half-space, centre, right half-space, right wing.
- Subtle half-space overlays and channel labels.
- Result screen showing target channel and lines broken.
- Tactical training board categories.

Next data model additions:

```js
{
  ourShape: "2-3",
  opponentShape: "4-4-2 high press",
  pressingIdea: "lock pivot and force wide",
  buildUpAnswer: "drop pivot then bounce through weak side",
  intendedConcept: "dropPivotBounce",
  targetZone: { x, y, w, h, label, channel: "rightHalfSpace", routeType: "through" },
  trapZones: [
    { x, y, w, h, label: "Wide Trap", trigger: "receiverInside", defenderBoost: 1.5 }
  ],
  pressTriggers: [
    { event: "wideReceive", response: "trapWide" },
    { event: "backPass", response: "frontLineJump" }
  ]
}
```

Implementation tasks:

- Add `trapZones` rendering and detection.
- Add `pressTriggers` to defender movement.
- Add defender roles: `firstPresser`, `screenPivot`, `trapWide`, `farSideLock`.
- Add lane quality evaluation: `safe`, `risky`, `baited`, `blocked`, `lineBreaking`.
- Add scenario briefing panel using `ourShape`, `opponentShape`, `pressingIdea`, and `buildUpAnswer`.
- Upgrade S/A/B scoring to include concept bonus, line break value, and trap-risk penalty.

Done when:

- A wide trap can invite a pass, then collapse after the receiver enters it.
- A 4-4-2 press, 4-3-3 press, and man-oriented press behave differently.
- The result screen rewards more than action count.
- Each advanced level has a documented tactical idea and intended answer.

## Verification Plan

Manual checks:

- Play first 5 levels on desktop.
- Play first 5 levels on mobile viewport.
- Confirm fail feedback is understandable.
- Confirm each tactical action has a visible preview.

Automated checks:

- Solver returns solution for every level.
- Solver optimal action count matches expected rating.
- No level can be completed with fewer actions than intended unless allowed.
- Level data schema validates.
- Trap-zone levels have at least one baited but non-optimal route.
- S rating requires either the intended concept or an equivalent line-breaking route.
