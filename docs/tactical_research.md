# Build-Up Lab Tactical Research

## Purpose

The current prototype proves the interaction model, but the football layer is still too thin. Build-Up Lab should not merely rename puzzle power-ups into football terms. It needs a deeper model of:

- how teams build from the back,
- how pressing teams restrict progression,
- how build-up teams create a free man,
- how players escape pressure through spacing, timing, and rotations.

This document translates real football build-up and pressing concepts into game systems.

## Source Base

Primary and high-signal references used for this research:

- FIFA Training Centre, "Playing out centrally": build-up under pressure, cover shadows, player-to-player press, half-press, switches of play.
- FIFA Training Centre, "Defending as a unit": recognising when to initiate press during opposition build-up.
- UEFA Technical Reports: tactical trend tracking and elite-game observations.
- The Coaches' Voice, "Third-man runs": third-man mechanisms as a way to break lines.
- World Class Coaching, "Build Up From the Back - La Salida Lavolpiana": pivot dropping between centre-backs to create a 3v2 build-up.
- The Bench View Soccer, positional play and pressing traps explainers: useful synthesis of positional superiority, pressing triggers, wide traps, and cover shadows.

## Core Football Model

Build-up is not "pass until goal." It is a controlled attempt to progress the ball while manipulating the opponent's pressing shape.

The fundamental question:

> Can the team in possession create a free player, free lane, or free zone before the pressing team traps the ball?

The pressing team's question:

> Can we force the ball into a predictable area, remove central options, and trigger pressure at the right moment?

Build-Up Lab should model the tension between those two questions.

## Build-Up Principles

### 1. Create The Free Man

The build-up team tries to create one player who is not controlled by the press. This can happen through:

- numerical superiority: 3v2, 4v3, goalkeeper added as extra player;
- positional superiority: player receives behind a pressing line;
- qualitative superiority: a player can receive under pressure and turn;
- dynamic superiority: a player becomes free because a defender jumps to press.

Game translation:

- Each defender has a mark target, pressure radius, and cover shadow.
- A player becomes "free" when no defender can pressure them within the next opponent shift and their receiving lane is not blocked.
- Tutorial levels should explicitly show "FREE MAN" only after the player has seen blocked lanes.

### 2. Stretch The Press

Build-up teams stretch the opponent horizontally and vertically:

- centre-backs split,
- full-backs hold width or invert,
- goalkeeper becomes a passing option,
- pivot drops or moves away to open a lane,
- winger stays wide to pin the outside defender.

Game translation:

- Wider spacing should make switch play stronger.
- Narrow spacing should make bounce and third-man combinations stronger.
- If the user clusters players, the press should compress and create more blocked lanes.

### 3. Draw Pressure, Then Play Away

One major build-up pattern is to invite pressure toward one side, then escape:

- pass to centre-back,
- opponent jumps,
- bounce through pivot,
- switch to weak side,
- find winger/full-back in space.

Game translation:

- Pressing defenders should shift toward the ball after each action.
- Repeated passes into one side should increase trap risk but open weak-side value.
- Switch Play should be powerful only when the press has shifted enough.

### 4. Play Through, Around, Or Over

Against pressure, teams can progress in three broad ways:

- through: central pivot, third-man, vertical lane;
- around: full-back/winger, side rotation, switch;
- over: lofted pass behind or to weak side.

Game translation:

- Target zones should have type: `through`, `around`, `over`, `reset`.
- Different defensive schemes should deny different route types.
- A route should feel like a tactical answer, not just the shortest geometric path.

### 5. Third-Man Principle

The third man is a way to reach a player who cannot be passed to directly. A common pattern:

```text
A cannot pass to C directly.
A passes to B.
B lays off or redirects.
C receives behind the pressure.
```

Game translation:

- Third-Man should require:
  - a connector,
  - a runner,
  - blocked or risky direct lane,
  - a final receiver/runner reaching a target zone.
- The action should fail or be unavailable if the runner is not the intended target.
- Preview must show two segments and the final runner movement.

### 6. Bounce / Wall Pass

Bounce pass is not a magic bypass. It works because the connector plays quickly before the defender can adjust.

Game translation:

- Bounce should be best against a single presser or cover shadow.
- It should be weak if both segments are covered.
- It should use the connector as the holder for the second pass lane.
- It should count as one tactical action but two ball movements.

### 7. Drop Pivot / La Salida Lavolpiana

When a pivot drops between centre-backs, the build-up line can become a back three, often creating 3v2 against two forwards.

Game translation:

- Drop Pivot should change the structure before the pass.
- It should create a new angle or overload, not simply teleport a player to a target.
- It should be especially useful against 4-4-2 or two-forward high presses.
- It should be less useful if the opponent presses with three forwards.

### 8. Switch Play

Switching play works when pressure has shifted and the far side is weakly protected. It should not always be a free long pass.

Game translation:

- Switch should require:
  - enough distance,
  - weak-side target,
  - press shifted toward the ball,
  - no far-side trap defender.
- Switch can ignore close block radius if treated as lofted, but should still be affected by receiver pressure and far-side anticipation.

## Pressing Principles

### 1. Pressing Is Coordinated

Pressing is not one defender running at the ball. It is a group action:

- first presser closes the ball,
- second presser blocks the next option,
- midfielders screen central lanes,
- back line squeezes up,
- weak-side players tuck in.

Game translation:

- A press should be defined as a group shape, not isolated defenders.
- Pressing schemes should have roles:
  - `firstPresser`,
  - `coverShadow`,
  - `screenPivot`,
  - `trapWide`,
  - `farSideLock`,
  - `backLineSqueeze`.

### 2. Cover Shadow

The first presser uses their body angle to block the lane behind them. This should remain a core mechanic.

Current implementation is directionally correct:

```text
ball holder -> defender -> covered lane
```

Needed depth:

- cover shadow angle should depend on pressing body orientation;
- body orientation should be influenced by pressing intent;
- a defender should be able to curve their run to force play inside or outside.

Game translation:

```js
pressingIntent: "forceWide" | "forceInside" | "lockPivot"
coverShadowTargetRole: "pivot" | "fullback" | "center"
```

### 3. Pressing Triggers

Pressing teams do not press equally at all times. Common triggers:

- pass to goalkeeper,
- back pass,
- sideways pass under pressure,
- bad body orientation,
- receiver near touchline,
- slow first touch,
- ball played into a trap zone.

Game translation:

- Add trigger rules to levels:

```js
pressTriggers: [
  { event: "backPass", response: "jump" },
  { event: "wideReceive", response: "trapWide" },
  { event: "passToGK", response: "frontLineJump" }
]
```

- In MVP, triggers can be turn-based instead of continuous.

### 4. Pressing Traps

A pressing trap deliberately leaves one pass looking open, then collapses once the ball enters that area. Wide/touchline traps are especially intuitive.

Game translation:

- Mark some zones as trap zones.
- A pass into a trap zone is allowed, but after the pass:
  - nearby defenders gain extra shift,
  - available lanes reduce,
  - receiver may become trapped.

```js
trapZone: {
  x, y, w, h,
  label: "Wide Trap",
  trigger: "receiverInside",
  defenderBoost: 1.5
}
```

### 5. Man-Oriented Press

In man-oriented pressing, defenders follow or jump to direct opponents. It can be broken by rotations, third-man runs, and vacating space.

Game translation:

- Defender assignments:

```js
assignment: { type: "man", playerId: 3, looseness: 20 }
```

- Rotation actions should disturb assignments.
- Decoy run and third-man should become more valuable here.

### 6. Mid-Block vs High Press

High press:

- pressure starts near build-up line,
- mistakes are punished quickly,
- space behind press is valuable.

Mid-block:

- first line may screen rather than jump,
- central lanes are blocked,
- patience and switches matter more.

Game translation:

- High press levels should emphasize action limit and immediate traps.
- Mid-block levels should emphasize lane manipulation and target zone selection.

## Pressing Schemes To Model

### 4-4-2 High Press

Typical behavior:

- two forwards press centre-backs,
- one forward curves run to block pivot,
- wide midfielder jumps to full-back,
- central midfield screens inside.

Build-up answers:

- goalkeeper creates 3v2,
- pivot drops,
- third-man into midfield,
- switch to weak-side full-back.

Game system:

- two `firstPresser` defenders,
- central `screenPivot`,
- wide trap if ball goes full-back too early.

### 4-3-3 Press

Typical behavior:

- front three match back line,
- wingers press outside centre-backs or full-backs,
- striker blocks pivot lane,
- midfield three jump aggressively.

Build-up answers:

- create 4v3 with goalkeeper,
- find full-back behind winger,
- rotate pivot/full-back,
- play over first line.

Game system:

- wider front pressure,
- switch less free than against 4-4-2,
- drop pivot may be less effective if striker locks centre.

### Man-Oriented Press

Typical behavior:

- defenders track direct opponents,
- ball-side pressure is aggressive,
- rotations can drag markers away.

Build-up answers:

- third-man,
- decoy run,
- bounce pass,
- rotating a player out of zone to open receiving lane.

Game system:

- assignments plus looseness radius.
- moving a marked player changes the map.

### Wide Trap

Typical behavior:

- opponent invites pass to full-back,
- touchline becomes extra defender,
- winger and full-back collapse,
- inside lane is covered.

Build-up answers:

- bounce inside before trap closes,
- drop pivot as reset,
- switch early before ball reaches trap,
- third-man from full-back into half-space.

Game system:

- trap zone near sideline.
- if receiver catches in trap zone, next action has reduced options.

## Game System Upgrade Proposal

### Add Tactical State Layers

Current game has:

- players,
- defenders,
- target zone,
- tactical actions,
- pass count.

Needed next:

```js
level: {
  ourShape: "2-3",
  opponentShape: "4-4-2 high press",
  buildUpObjective: "findPivot",
  pressureModel: "highPress",
  targetZone: {},
  trapZones: [],
  pressTriggers: [],
  tacticalActions: {},
  intendedConcept: "dropPivotToBounce"
}
```

### Defender Role Model

Replace generic defender types with tactical roles:

```js
{
  id: "ST1",
  role: "firstPresser",
  behavior: "curveRun",
  pressureRadius: 20,
  coverShadowAngle: 38,
  coverShadowLength: 95,
  intent: "lockPivot"
}
```

### Receiver State

A receiver should not just be in or out of a circle. They can be:

- free,
- under pressure,
- back-to-goal,
- trapped,
- able to turn,
- forced to reset.

Game translation:

```js
receiverState = {
  pressure: 0..100,
  canTurn: boolean,
  availableNextLanes: number,
  trapRisk: 0..100
}
```

### Lane Quality

Instead of only `safe` or `blocked`, use:

- safe,
- risky,
- baited,
- blocked,
- line-breaking.

This gives the game more football feel.

```js
laneQuality = {
  status: "safe" | "risky" | "baited" | "blocked",
  breaksLine: true,
  bypassedDefenders: 2,
  trapRisk: 40
}
```

### Rating Upgrade

S/A/B should eventually consider tactical quality, not only actions used.

Current:

- S if actions <= optimal.

Proposed:

```js
ratingScore =
  actionEfficiency
  + lineBreakValue
  + conceptBonus
  - trapRiskPenalty
  - unnecessaryResetPenalty
```

Keep S/A/B UI, but calculate with football concepts.

## Level Design Framework

Each level should be authored with this format:

```md
Scenario:
Opponent shape:
Our shape:
Pressing idea:
Build-up answer:
Target zone:
Allowed actions:
Intended S route:
Common wrong route:
Teaching point:
```

Example:

```md
Scenario: 4-4-2 locks the pivot
Opponent shape: 4-4-2 high press
Our shape: 2-3 build-up
Pressing idea: ST1 presses LCB while screening pivot; ST2 locks RCB.
Build-up answer: Drop pivot to create back three, then bounce through the free side.
Target zone: between-lines right half-space
Allowed actions: Drop Pivot 1, Bounce 1
Intended S route: LCB -> Drop Pivot -> RCB -> Bounce to 8
Common wrong route: direct pass to pivot, intercepted by cover shadow
Teaching point: dropping the pivot changes the first-line numbers.
```

## What To Build Next

### Short Term

- Add trap zones.
- Add pressing intent to pressers.
- Add receiver state after a pass.
- Add lane quality labels.
- Rewrite first 20 levels using scenario metadata.

### Medium Term

- Add specific opponent schemes:
  - 4-4-2 high press,
  - 4-3-3 press,
  - man-oriented press,
  - wide trap,
  - mid-block screen.
- Add "concept bonus" rating.
- Add a scenario briefing panel before each drill.

### Long Term

- Scenario editor.
- Daily challenge from authored templates.
- Shareable tactical board image.
- Coaching mode that explains why the intended route works.

## Design Warning

Do not make this a full 11v11 simulator yet. The strongest product shape is:

> A compact tactical puzzle that teaches one build-up principle per scenario.

The simulation should be deep enough to make the football logic credible, but constrained enough that each puzzle is readable in 10-20 seconds.

