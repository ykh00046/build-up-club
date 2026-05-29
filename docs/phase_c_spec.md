# Phase C Specification: Pressing Traps And Positional Play

## Goal

Phase C turns Build-Up Lab from a tactical passing puzzle into a credible build-up/pressing puzzle. The focus is not more actions or more levels. The focus is richer football logic.

## Current Baseline

Already implemented:

- Target zones.
- Cover shadows.
- Tactical actions: Bounce, Third Man, Switch, Drop Pivot.
- 20 validated scenarios.
- Tactical training board tabs.
- Five vertical channels.
- Half-space overlays.
- Result stats for lines broken and target channel.
- A contributor prototype in `football/` explores broadcast-board UI, React/SVG pitch rendering, action cards, direct drag, timeline planning, and pure tactical helpers.

Still missing:

- Trap zones.
- Pressing triggers.
- Named press schemes.
- Defender roles.
- Tactical metadata per level.
- Tactical scoring beyond action count.

## Data Model

### Level Metadata

Add these fields to every level:

```js
{
  ourShape: "2-3 build-up",
  opponentShape: "4-4-2 high press",
  pressingIdea: "Two forwards lock centre-backs and screen the pivot.",
  buildUpAnswer: "Drop the pivot to create a back three, then bounce into the right half-space.",
  intendedConcept: "dropPivotBounce"
}
```

These fields should appear in the scenario briefing panel and later in the share summary.

### Trap Zones

```js
trapZones: [
  {
    x: 42,
    y: 170,
    w: 92,
    h: 58,
    label: "Wide Trap",
    trigger: "receiverInside",
    defenderBoost: 1.5,
    penalty: 20
  }
]
```

Behavior:

- Trap zones are visible but subtle.
- A pass into a trap zone is allowed.
- After the pass resolves, defenders near the trap zone shift more aggressively.
- If the receiver has no safe outlet after the trap shift, the state becomes lose/trapped.

### Defender Roles

Keep current `type`, but add `role`.

```js
{
  x: 110,
  y: 100,
  type: "presser",
  role: "firstPresser",
  intent: "lockPivot",
  blockRadius: 22,
  coverShadowAngle: 35,
  coverShadowLength: 80
}
```

Initial roles:

- `firstPresser`: jumps toward the ball holder.
- `screenPivot`: prioritizes blocking the centre/pivot lane.
- `trapWide`: accelerates if the ball reaches a wide trap.
- `farSideLock`: protects the weak-side switch target.

### Press Triggers

```js
pressTriggers: [
  { event: "wideReceive", response: "trapWide" },
  { event: "backPass", response: "frontLineJump" },
  { event: "switchPlay", response: "farSideLock" }
]
```

MVP trigger events:

- `wideReceive`: receiver is in left or right wing channel.
- `backPass`: target x is lower than holder x by at least 20.
- `switchPlay`: active action is Switch.
- `targetTrap`: receiver lands inside a trap zone.

## Lane Quality

Replace binary preview with a richer status.

```js
{
  status: "safe" | "risky" | "baited" | "blocked" | "lineBreaking",
  reason: "coverShadow" | "trapZone" | "outOfRange" | "lineBreak",
  breaksLines: 2,
  trapRisk: 0
}
```

Display:

- Safe: cyan.
- Risky: yellow.
- Baited: orange.
- Blocked: red.
- Line-breaking: cyan with pulse or thicker line.

## Tactical Rating

Keep the S/A/B display, but calculate it with tactical quality.

```js
score = 100
score -= actionOverage * 20
score += linesBroken * 8
score += intendedConceptUsed ? 20 : 0
score -= trapRiskPenalty
score -= invalidResetPenalty
```

Mapping:

- S: 90+
- A: 70-89
- B: 50-69
- Fail: below 50 or lost possession.

## Scenario Briefing Panel

Before each scenario starts, show:

```text
DRILL 01: Find the Free Man
Our Shape: 2-3 build-up
Opponent: 4-4-2 high press
Pressing Idea: Pivot is screened by the first presser.
Build-Up Answer: Find the free player behind the first line.
```

Keep it short and skippable.

## Implementation Order

1. Add `evaluateLane` as a pure helper and use it for preview, runtime validation, soft-lock checks, and solver.
2. Add metadata fields to all levels.
3. Render scenario briefing panel from metadata.
4. Add action-card metadata for each tactical action.
5. Add tactical ticker/log.
6. Add trap zone data and draw function.
7. Implement `pointInTrapZone`.
8. Apply trap trigger after pass resolution.
9. Add defender roles to `advanceDefender`.
10. Upgrade scoring.
11. Revalidate all 20 levels.

## Contributor Prototype Reuse

Use `football/` as a design and logic reference, not as a direct app replacement.

Reuse now:

- `evaluateLane` / `receiverState` style pure helpers.
- Broadcast tactical board visual hierarchy.
- Action-card data model.
- Scenario briefing/ticker concepts.

Defer:

- Full React migration.
- Timeline input as default.
- Desktop-only side rail layout.

## Acceptance Criteria

- At least three levels contain trap zones.
- A wide trap can be visually identified and mechanically triggered.
- At least one level punishes the tempting wide pass but rewards a reset/switch/third-man answer.
- Preview line can show `baited` separately from `blocked`.
- Result screen can explain the route with target channel, lines broken, and concept used.
