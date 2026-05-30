# Build-Up Lab Master Plan

## Product North Star

Build-Up Lab is a compact world-stage football tactics puzzle about escaping pressure during decisive build-up moments.

The player should not feel like they are solving an abstract line puzzle. They should feel like they are reading a press, creating a free man, and breaking into the right channel.

Core promise:

> Can you solve the match-defining build-up moment before the press closes?

## Current State

Implemented in `index.html`:

- Single-file canvas game.
- 20 validated scenarios.
- Target zones.
- Cover shadows.
- Tactical actions: Bounce, Third Man, Switch, Drop Pivot.
- Tactical training board tabs.
- Five pitch channels and half-space overlays.
- S/A/B rating.
- Lines-broken and target-channel result stats.
- Share summary.

External reference prototype:

- `football/` contains a React/SVG broadcast tactical board prototype.
- It should be used as a design and logic reference, not as a direct replacement.

## Document Map

Use documents this way:

- `docs/master_plan.md`: current step-by-step roadmap. Start here.
- `docs/product_direction.md`: product positioning and target audience.
- `docs/game_design.md`: stable gameplay rules and UX principles.
- `docs/gameplay_reform_plan.md`: reform plan for making the game more fun and less worksheet-like.
- `docs/tactical_research.md`: football theory and research notes.
- `docs/phase_c_spec.md`: implementation spec for next tactical depth phase.
- `docs/football_prototype_review.md`: what to reuse from the contributor prototype.
- `docs/world_stage_strategy.md`: tournament-style attention strategy and 11v11 expansion guardrails.
- `docs/implementation_plan.md`: historical implementation plan and broader phases.
- `docs/task.md`: checklist status.

## World Stage Direction

Goal:

Make the project attractive to a broader football audience without turning it into a full 11v11 simulator too early.

Decision:

- Keep the playable core as short tactical scenarios.
- Present scenarios as big-match highlight problems.
- Use an 11v11 match wrapper for context, not full simulation.
- Avoid official World Cup, FIFA, national team, and player branding unless licensed.

Near-term product language:

- World Stage Challenge.
- International Matchday.
- Knockout Drill.
- Match-Defining Moment.
- Formation vs Formation.

Near-term implementation:

- Added match minute, score state, tournament-style stage label, and team palette metadata to each scenario.
- Render tournament-style labels in scenario cards and briefing.
- Include match context in share summaries so results read like a challenge moment.
- Added faded, non-interactive 11v11 off-ball context around the active puzzle zone.

Result packaging:

- Show match context on the solved result modal.
- Summarize the solved moment in one shareable sentence.
- Keep the result screen focused on grade, actions, lines broken, outlet, and concept.
- Promote one featured match moment from the scenario sidebar so new players see a high-stakes entry point before the level directory.
- Add a compact share-card preview inside the result modal as the basis for later image export.

## Gameplay Reform Direction

Problem:

The current game is tactically coherent, but it can feel like a static tactics worksheet.

Decision:

- Stop adding more ordinary levels for now.
- Reform the core loop around pressure escalation, manipulation, and escape.
- Add a visible pressure meter.
- Animate our support shape and opponent press shift around each pass so the board feels alive.
- Add intent-based scoring so the best route must use the intended tactical concept, not only the shortest pass count.
- Add named press schemes with readable reactions.
- Add a simple carry action to let the player create passing angles.
- Rebuild five flagship levels as a Reform Test Pack before expanding content.

## Step 0: Preserve The Current Prototype

Goal:

Keep the current playable game stable while we deepen the system.

Status:

- Done.
- Already pushed initial prototype to GitHub.

Rules:

- Do not rewrite to React now.
- Do not replace the canvas runtime yet.
- Do not add more levels before the tactical model deepens.

## Step 1: Unify Tactical Logic

Goal:

Make preview, runtime pass resolution, soft-lock detection, and solver use the same lane evaluation logic.

Why:

The game will become unreliable if preview says one thing, runtime does another, and solver validates a third thing.

Tasks:

- Add pure `evaluateLane(from, to, defenders, options)` helper.
- Return lane state:
  - `safe`
  - `risky`
  - `baited`
  - `blocked`
  - `lineBreaking`
- Include reason:
  - `pressureRadius`
  - `coverShadow`
  - `trapZone`
  - `outOfRange`
  - `receiverPressure`
- Use it in:
  - hover preview,
  - `tryPass`,
  - `tryPassToTargetZone`,
  - `checkSoftLock`,
  - `_test.solveLevel`.

Acceptance criteria:

- Done: one helper determines lane status everywhere.
- Done: existing 20 levels remain solvable.
- Done: pass preview and actual pass result now share the same multi-leg lane options.

## Step 2: Add Receiver State

Goal:

Make a completed pass evaluate the receiver's tactical situation, not just whether the ball arrived.

Tasks:

- Add `receiverState(receiver, defenders, context)` helper.
- States:
  - `free`
  - `underPressure`
  - `backToGoal`
  - `trapped`
- Use receiver state after defender shift.
- Fail with a precise reason if trapped.
- Show receiver state in result/ticker.

Acceptance criteria:

- Done: a receiver can complete a pass but still be trapped after the press shifts.
- Done: fail message distinguishes interception from trapped receiver.
- Done: HUD/result can surface the latest receiver state.

## Step 3: Add Level Metadata

Goal:

Turn every scenario into a football problem with an explicit pressing idea and build-up answer.

Add to each level:

```js
ourShape: "2-3 build-up",
opponentShape: "4-4-2 high press",
pressingIdea: "Two forwards screen the pivot and force the ball wide.",
buildUpAnswer: "Drop the pivot, then bounce into the right half-space.",
intendedConcept: "dropPivotBounce"
```

Use metadata in:

- training board cards,
- intro overlay,
- share summary,
- future scoring.

Acceptance criteria:

- Done: every level can be described as "opponent tries X, you solve with Y."
- Done: advanced levels now have explicit pressing ideas and build-up answers.
- Done: metadata appears in level cards, scenario intro, and share summary.

## Step 4: Scenario Briefing

Goal:

Before each scenario, teach the tactical problem without a long tutorial.

Briefing format:

```text
CHALLENGE 01: Beat the 4-4-2 High Press
Our Shape: 2-3 build-up
Opponent: 4-4-2 high press
Pressing Idea: Pivot is screened by the first presser.
Build-Up Answer: Create a back three, then find the half-space.
```

Tasks:

- Replace or upgrade current intro overlay.
- Keep it skippable.
- Keep it compact for landscape mobile.

Acceptance criteria:

- Done: a new player can read the opponent's pressing idea before the drill.
- Done: football-aware players see the shape, press, concept, and build-up answer.
- Done: briefing remains skippable and compact for landscape mobile.

## Step 5: Action Cards

Goal:

Make tactical actions feel like football instructions, not power-up buttons.

Add action metadata:

```js
{
  id: "bounce",
  label: "BOUNCE",
  sub: "one-two via connector",
  desc: "Beats a single presser if both legs are safe.",
  concept: "thirdPlayerSupport"
}
```

Tasks:

- Define `TACTICAL_ACTIONS`.
- Render compact card/chip UI from data.
- Show available uses.
- Show short description on selection or hover.

Acceptance criteria:

- Done: Bounce, Third Man, Switch, and Drop Pivot are defined from action metadata.
- Done: action cards render label, sublabel, use count, and selected-action coaching text.
- Done: UI vocabulary now follows football coaching language.

## Step 6: Tactical Ticker

Goal:

Show the route as a readable tactical sequence.

Example:

```text
01 DROP PIVOT - back three created
02 PASS RCB - press shifted
03 BOUNCE PIV -> 8R - line broken
04 PRESS ESCAPED - right half-space
```

Tasks:

- Add `actionLog` to game state.
- Log action, target, lane quality, press response, trap response.
- Use log in result and share summary.

Acceptance criteria:

- Done: share text communicates the route solution, not just the grade.
- Done: runtime stores action, target, lane status, and reason in `actionLog`.
- Done: HUD and result screen render recent route feedback from the same log.

## Step 7: Trap Zones

Goal:

Model the most important pressing behavior missing today: baiting a pass into a trap.

Data:

```js
trapZones: [
  {
    x, y, w, h,
    label: "Wide Trap",
    trigger: "receiverInside",
    defenderBoost: 1.5,
    penalty: 20
  }
]
```

Tasks:

- Draw trap zones subtly.
- Detect when receiver lands inside trap.
- Trigger extra defender shift.
- Mark lanes into trap as `baited`, not `blocked`.

Acceptance criteria:

- Done: levels 11, 13, and 19 use trap zones.
- Done: lanes into trap zones are legal but marked `baited`.
- Done: entering a trap triggers an extra defensive shift and logs the press collapse.

## Step 8: Pressing Schemes And Defender Roles

Goal:

Make different opponent shapes behave differently.

Add defender roles:

- `firstPresser`
- `screenPivot`
- `trapWide`
- `farSideLock`
- `backLineSqueeze`

Add named schemes:

- `4-4-2 high press`
- `4-3-3 press`
- `man-oriented press`
- `wide trap`
- `mid-block screen`

Acceptance criteria:

- A 4-4-2 press does not feel like a 4-3-3 press.
- Man-oriented levels reward rotation/decoy/third-man behavior.
- Wide trap levels reward reset, bounce, or early switch.

## Step 9: Tactical Scoring

Goal:

S/A/B should reward tactical quality, not only action count.

Scoring inputs:

- action efficiency,
- lines broken,
- intended concept used,
- trap risk avoided,
- unnecessary reset penalty,
- target channel value.

Possible formula:

```js
score = 100
score -= actionOverage * 20
score += linesBroken * 8
score += intendedConceptUsed ? 20 : 0
score -= trapRiskPenalty
score -= invalidResetPenalty
```

Acceptance criteria:

- S requires either the intended concept or an equivalent high-quality route.
- A route can clear the level but receive A/B if it walks into a trap or wastes actions.

## Step 10: Input Model Experiments

Goal:

Test whether the current card-click input is the best way to read pressure.

Options from `football/`:

- Card Deck: current default.
- Direct Drag: drag from holder to receiver with live lane preview.
- Timeline Plan: plan a sequence, then execute.

Recommendation:

- Keep Card Deck as default.
- Prototype Direct Drag on one scenario after Phase C is stable.
- Save Timeline Plan for advanced/coach mode.

Acceptance criteria:

- We know which input model makes cover shadow and pressing trap most understandable.

## Step 11: Visual Upgrade

Goal:

Shift from neon-retro game to broadcast tactical board.

Borrow from `football/`:

- realistic dark pitch,
- off-white/black chrome,
- amber primary accent,
- position labels,
- top scoreboard,
- compact mono data.

Do not:

- rewrite to React,
- ship Babel/CDN prototype code,
- force desktop-only side rails.

Acceptance criteria:

- The game looks like a football tactics product within 3 seconds.
- The visual design supports tactical readability.

## Step 12: Public Test Build

Goal:

Validate the product before adding more content.

Test group:

- 10 football-aware users.
- 10 casual football fans.

Measure:

- first-level comprehension,
- completion of first 5 scenarios,
- whether they understand cover shadow,
- whether trap zones feel fair,
- whether they play 5+ scenarios voluntarily,
- which input model they prefer.

Acceptance criteria:

- 30%+ play 5 or more scenarios.
- Football-aware testers can describe the intended build-up answer.
- Casual testers can still understand the basic objective.

## Immediate Next Commit Scope

Recommended next commit:

```text
Refactor lane evaluation into pure helper
```

Include:

- `evaluateLane`
- `receiverState`
- preview integration
- runtime pass integration
- solver integration
- validation of all 20 scenarios

Do not include:

- trap zones,
- visual redesign,
- new levels.

That keeps the next change small enough to verify rigorously.
