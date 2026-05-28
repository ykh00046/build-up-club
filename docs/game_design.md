# Build-Up Lab Game Design

## Design Principle

Make football tactics playable in 10-second decisions.

The player should not manage a whole match. Each level is one tactical problem: escape pressure from the first or second line and reach a target zone.

## Scenario Anatomy

Each level contains:

- Our shape: the build-up structure.
- Opponent shape: the press structure.
- Ball holder.
- Available teammates.
- Pressing lanes and cover shadows.
- Target zone.
- Action limit.
- Optional tactical actions.

Example:

```text
Scenario: Beat the 4-4-2 High Press
Our shape: 2-3 build-up
Opponent shape: 4-4-2 high press
Start: left center-back
Goal: find the pivot or reach the weak-side fullback
Limit: 3 actions
```

## Player Actions

Basic actions:

- Safe Pass: low risk, usually sideways or backward.
- Progressive Pass: higher value, can break a line.
- Carry: short movement by the ball holder to change angle.

Tactical actions:

- Bounce Pass: pass into a player who immediately returns or redirects.
- Third-Man Run: use one player as a connector to find a free teammate.
- Switch Play: move the ball to the weak side.
- Drop Pivot: defensive midfielder drops between center-backs.
- Decoy Run: move a teammate to pull pressure away.
- Overload Side: create a local numerical advantage.

These should replace generic power-up items. They should feel like football concepts, not magic buttons.

## Opponent Behavior

The opponent should be readable before being smart.

Initial pressing types:

- Static Block: defenders hold shape and block lanes.
- Directional Press: nearest defender steps toward the ball.
- Cover Shadow: defender blocks a passing lane behind them.
- Trap Side: opponent wants to force play toward one side.
- Man-Oriented Press: defenders follow assigned players after actions.

MVP opponent logic:

- Each defender has a zone, pressure radius, and cover-shadow cone.
- After each action, defenders shift one step according to the pressing rule.
- Interception happens when the ball path crosses a pressure radius or cover shadow.

## Win Conditions

A level is cleared when the ball reaches:

- Pivot zone.
- Half-space zone.
- Weak-side fullback.
- Free number 8.
- Forward between lines.
- Exit line beyond the first press.

The exact target depends on the scenario.

## Fail Conditions

- Ball path is intercepted.
- Ball holder is trapped after opponent shift.
- Action limit is exceeded.
- Player uses a tactical action in an invalid context.

## Scoring

Use a tactical rating instead of only star count.

Possible scoring signals:

- Actions used.
- Lines broken.
- Risk taken.
- Whether the intended tactical concept was used.
- Whether the ball reached the highest-value zone.

Simple MVP rating:

- S: optimal route, intended concept used.
- A: clean escape with one extra action.
- B: escaped but inefficient.
- Failed: intercepted, trapped, or out of actions.

## Level Progression

Phase 1: Learn the language

- What is a safe pass?
- What is a blocked lane?
- What is a cover shadow?
- What is the free man?

Phase 2: Basic build-up escapes

- Center-back to pivot.
- Fullback bounce.
- Goalkeeper as extra player.
- Switch away from pressure.

Phase 3: Tactical concepts

- Third-man route.
- Drop pivot.
- Side overload.
- Decoy movement.

Phase 4: Recognizable opponent shapes

- 4-4-2 high press.
- 4-3-3 press.
- 4-2-3-1 mid-block.
- Man-oriented press.

## UX Notes

- Show the opponent's pressing intent visually.
- Do not hide rules in text.
- Use lane colors: green safe, yellow risky, red blocked.
- Highlight the target zone before the first action.
- When failing, show exactly why: intercepted lane, cover shadow, trapped receiver.
- Keep each level solvable in 2-5 actions.

