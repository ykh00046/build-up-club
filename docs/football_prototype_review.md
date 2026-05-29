# Football Folder Prototype Review

## Context

The `football/` folder was added by another contributor. It is a React + SVG design prototype for Build-Up Lab, separate from the current single-file canvas game in `index.html`.

This review identifies what should be reused, adapted, or avoided.

## Files Reviewed

- `football/Build-Up Lab.html`
- `football/bul.css`
- `football/bul-scenario.jsx`
- `football/bul-pitch.jsx`
- `football/bul-hud.jsx`
- `football/bul-variants.jsx`
- `football/tweaks-panel.jsx`
- `football/design-canvas.jsx`

## High-Level Assessment

This prototype is valuable. It is not production-ready for the current app architecture, but it has a stronger product identity than the current canvas build.

The main contribution is not the React implementation itself. The main contribution is the product framing:

> Build-Up Lab as a broadcast tactical board, not an arcade puzzle.

That direction fits our goal better than the current retro canvas look.

## Best Ideas To Reuse

### 1. Broadcast Tactical Board Visual Language

The prototype uses:

- realistic dark pitch,
- off-white/black broadcast chrome,
- amber accent,
- compact data typography,
- position labels like `LCB`, `PIV`, `8R`,
- scenario scoreboard with shape vs press.

This is more aligned with football tactics than our current player-circle arcade look.

Recommendation:

- Move our UI gradually toward this broadcast-board language.
- Keep the existing canvas runtime, but adopt the visual hierarchy:
  - top scoreboard,
  - central pitch,
  - scenario briefing,
  - action/log feedback.

### 2. Scenario Briefing Rail

`bul-hud.jsx` has a strong right-rail briefing model:

- Scenario.
- Press read.
- Input explanation.
- Live ticker.

This directly solves our current weakness: the player sees a puzzle but does not yet understand the football idea.

Recommendation:

- Add a compact briefing panel before each scenario in the current app.
- Later, add a side rail only if screen size allows.
- For mobile/landscape, show a skippable overlay instead of permanent rail.

### 3. Three Input Models

`bul-variants.jsx` explores:

- Card Deck: choose tactical action, then target.
- Direct Drag: drag from ball holder to teammate, live lane preview.
- Timeline Plan: plan sequence then execute.

This is strategically important.

Current game uses the Card Deck model, although visually it is still a toolbar. The prototype suggests we should not assume that is the final input model.

Recommendation:

- Keep Card Deck for MVP and tutorials.
- Prototype Direct Drag as an optional input mode.
- Save Timeline Plan for advanced/challenge mode because it matches "coach board" thinking.

### 4. Pure Tactical Helpers

`bul-scenario.jsx` contains reusable conceptual logic:

- `evaluateLane(holder, receiver, defenders, opts)`
- `receiverState(receiver, defenders)`
- `shiftPress(defenders, newBall)`
- `inCoverShadow(defender, ballHolder, target)`

Our current implementation has similar pieces spread through the `Game` object. The prototype's pure functions are cleaner and easier to test.

Recommendation:

- Introduce pure helpers in current `index.html` before expanding Phase C.
- Use `evaluateLane` as the single source for preview, solver, and runtime pass validation.
- This is the highest-value code architecture improvement.

### 5. Action Card Vocabulary

The action definitions in `bul-scenario.jsx` include:

- label,
- sublabel,
- cost,
- description,
- icon type.

This is stronger than the current implicit toolbar.

Recommendation:

- Convert our tactical action config into data objects.
- Render action name + short football explanation.
- Use locked/available states per scenario.

### 6. Live Tactical Ticker

The ticker gives each action a narrative:

```text
01 PASS to RCB
02 BOUNCE through PIV
03 WIN - reached PIVOT BAND
```

This helps players learn football logic and makes sharing more meaningful.

Recommendation:

- Add an action log array to current game state.
- Show the last 2-3 tactical events in HUD or result screen.
- Use the same log to produce share text.

### 7. Tweaks Panel For Internal Design Testing

The tweaks panel is not product UI, but it is useful for development:

- pressure radius toggle,
- cover shadow toggle,
- target zone toggle,
- pitch stripe toggle.

Recommendation:

- Do not ship this to players.
- Consider adding debug toggles behind `?debug=1`.

## Ideas To Avoid Or Delay

### 1. Full React Migration

Do not migrate the current app to React now.

Reasons:

- The existing single-file canvas game already works.
- A rewrite would delay tactical depth work.
- The React prototype uses external CDN dependencies and Babel in-browser, which is not ideal for production.

Use it as a design/spec reference first.

### 2. Permanent Desktop Side Rail

The side rail works well in the 1180x760 artboard, but our actual game targets small canvas/mobile landscape.

Adopt the briefing content, not necessarily the layout.

### 3. Timeline Plan As Default Input

Timeline planning is conceptually strong, but it increases cognitive load. It should be introduced later for advanced users.

Default input should remain:

1. choose action,
2. choose target,
3. see press reaction.

## Concrete Integration Plan

### Phase C.1: Tactical Helper Refactor

Add pure helpers:

- `evaluateLane(from, to, defenders, options)`
- `receiverState(receiver, defenders)`
- `shiftPress(defenders, holder, context)`
- `lineBreakValue(from, to, defenders)`

Use `evaluateLane` in:

- pass preview,
- pass execution,
- soft-lock detection,
- solver.

### Phase C.2: Scenario Metadata And Briefing

Add to every level:

```js
ourShape
opponentShape
pressingIdea
buildUpAnswer
intendedConcept
```

Render as:

- intro overlay before scenario,
- level card details,
- result/share summary.

### Phase C.3: Action Cards

Replace simple toolbar labels with data-driven tactical action cards:

```js
{
  id: "bounce",
  label: "BOUNCE",
  sub: "one-two via connector",
  desc: "Beats a single presser if both legs are safe."
}
```

The UI can still be compact, but the concept should be visible.

### Phase C.4: Tactical Ticker

Add a small tactical log:

- action chosen,
- lane status,
- press shift,
- trap triggered,
- target reached.

Use it for:

- result route,
- copy summary,
- debugging.

### Phase D: Input Model Test

After Phase C stabilizes, test:

- Card Deck default.
- Direct Drag alternate.
- Timeline Plan advanced.

Do not implement all three in production immediately. Use one scenario to compare comprehension.

## Visual Direction Recommendation

Adopt the prototype's visual direction gradually:

- Move from neon-retro to broadcast tactical board.
- Use position labels more prominently.
- Use amber as the main attention accent.
- Keep cyan for successful routes and red/orange for danger.
- Add a top scoreboard with scenario ID, our shape, opponent press, and action count.

This will make the project feel less like a generic browser game and more like a football tactics product.

## Immediate Next Step

The best next implementation step is not styling. It is:

> Refactor lane evaluation into a pure `evaluateLane` function, then use it everywhere.

That unlocks trap zones, lane quality, better scoring, and more reliable solver behavior.

