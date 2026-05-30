# Build-Up Lab Gameplay Reform Plan

## Diagnosis

The current game is tactically coherent, but it is not fun enough.

The main issue is not content volume. More levels will not fix the core loop.

Current loop:

```text
read board -> choose pass/action -> see if route is accepted -> clear/fail
```

This feels like solving a static tactics worksheet. It lacks:

- pressure escalation,
- dramatic consequence,
- satisfying execution,
- visible team and opponent movement,
- meaningful tradeoffs,
- replay hooks beyond finding the one answer.

## Reform Goal

Turn Build-Up Lab from a static pass puzzle into a short, dramatic pressure-escape game.

New promise:

> Can you survive the press long enough to create the decisive escape?

The player should feel the opponent closing in, not only calculate a legal lane.

## New Core Loop

```text
scan pressure -> create angle -> commit action -> press reacts -> exploit opening -> escape
```

The fun should come from three beats:

1. Pressure is coming.
2. I manipulate the pressure.
3. I punish the opened space.

## Core Reform Pillars

### 1. Pressure Meter

Add a visible pressure meter that rises after every action and jumps when the player enters traps or plays into crowded areas.

Purpose:

- creates urgency,
- makes even safe passes feel costly,
- gives casual players an emotional target,
- makes the match moment feel alive.

Rules:

- Start pressure depends on scenario.
- Safe lateral pass: small increase.
- Backward reset: medium increase unless scenario teaches reset.
- Risky lane: medium increase.
- Trap zone receive: large increase.
- Intended tactical action: pressure decrease or freeze for one beat.
- If pressure reaches max, the receiver is trapped or the press collapses.

### 2. Intent-Based Scoring

S/A/B should not be based only on pass count.

Add level metadata:

```text
requiredConcepts: ['dropPivot', 'bounce']
preferredChannels: ['LHS']
forbiddenShortcuts: ['directZonePass']
```

Rating:

- S: escaped, used intended concept, avoided major trap, efficient.
- A: escaped cleanly but missed part of concept or used extra action.
- B: escaped with high pressure/risk.

This prevents "technically solved but boring" optimal routes.

### 3. Dynamic Press Schemes

Replace generic defender shifts with named pressure schemes.

Initial schemes:

- `442HighPress`: two forwards screen centre, wide midfielder jumps on fullback.
- `433MidPress`: front three curve press and lock one side.
- `WideTrap`: allows wide receive, then collapses.
- `ManLock`: nearest marker follows assigned player after first action.

Each scheme should have:

- readable name,
- briefing text,
- simple trigger,
- visible reaction.

This makes the opponent feel intentional instead of like red circles.

### 4. Ball-Holder Micro Movement

Add a simple "carry" action.

Carry should move the ball holder a short distance before passing, changing the angle.

Why:

- gives the player agency before passing,
- creates a football-native action,
- makes cover shadows feel interactive,
- adds skill without real-time controls.

Carry is not dribbling. It is a deliberate tactical touch:

```text
Carry Left / Carry Right / Carry Forward
```

### 5. Continuous Team Movement

Players and defenders must visibly move before and after the pass.

This is essential. If pieces are static, the game feels like a diagram. If they shift, scan, press, and support, the same tactical decision feels like a live match moment.

Minimum behavior:

- Before pass: defenders lean or step toward the ball-side pressure.
- During pass: nearest defenders start closing the receiving lane.
- After pass: the receiving team shifts support angles around the new ball holder.
- After pass: the opponent block slides, presses, or collapses according to its scheme.

Implementation rule:

- Game logic may stay turn-based.
- Visual movement should be animated over 250-450ms so players clearly see the press react.
- Movement must be readable, not realistic for its own sake.

This should become the first visible reform before adding more complex systems.

### 6. Body Orientation And Cover Shadow

Add body direction to attackers and defenders.

Why:

- pass angle should matter,
- receiving back-to-goal should feel different from receiving open,
- cover shadow should mean the opponent is hiding one of our players with body shape,
- pressure becomes readable before the player acts.

Rules:

- Defenders face the ball holder.
- A defender's cover shadow is cast behind their body orientation.
- A pass into a teammate hidden behind that body shape is blocked or heavily risky.
- A pass made sharply against the passer's body direction is risky.
- Carry and support movement should become ways to improve the body angle before passing.
- A long space pass creates a landing zone first; the target teammate must run into that zone to receive instead of waiting for a pass to feet.

This replaces the old interpretation where cover shadow was just a generic cone intersecting the pass path.

### 7. Playable Set Pieces Of Build-Up

Stop designing levels as rectangles plus target zones. Design them as named dramatic moments.

Examples:

- Final Minute: bait the striker, find the 6.
- Touchline Trap: survive the wide collapse.
- Derby Press: escape the man lock.
- Title Moment: switch only after attracting pressure inside.

Each moment needs:

- emotional setup,
- pressing idea,
- manipulation action,
- reward route.

## Immediate MVP Reform

Do not rewrite the whole game.

Implement in this order:

1. Add pressure meter state and UI.
2. Add visible post-pass movement animation for our support shape and opponent press shift.
3. Add pressure changes to pass resolution.
4. Add `requiredConcepts` metadata.
5. Change S/A/B to use pressure plus concept completion.
6. Rebuild 5 flagship levels around the new loop.
7. Put those 5 levels before the old directory as "Reform Test Pack".

## First Five Reform Test Levels

### 1. Final Minute Pivot

Goal:

Teach pressure meter and free man.

Fun beat:

The player has two safe-looking options, but only one keeps pressure low.

### 2. Touchline Trap

Goal:

Teach trap escalation.

Fun beat:

The wide pass is tempting, but it spikes pressure unless followed by bounce.

### 3. Drop Then Bounce

Goal:

Teach manipulating first line.

Fun beat:

Drop pivot freezes the first presser, then bounce opens the lane.

### 4. Attract Then Switch

Goal:

Teach switch isolation.

Fun beat:

Switch is blocked until the player attracts pressure inside.

### 5. Title Moment

Goal:

Combine pressure, concept scoring, and dynamic press.

Fun beat:

The player must survive rising pressure and execute the intended concept before collapse.

## What To Stop Doing

- Stop adding levels until the new loop is proven.
- Stop judging levels only by solver pass count.
- Stop making target zones the main fantasy.
- Stop relying on tactical terminology as the source of fun.
- Stop treating 11v11 visuals as the answer to engagement.

## Success Criteria

The reform works if:

- a non-tactics player understands "pressure is rising" instantly,
- failed attempts feel like "I nearly escaped",
- the best route feels more satisfying than a shortcut,
- players retry because they want a cleaner escape,
- the result screen makes them proud of the concept used, not only the grade.
