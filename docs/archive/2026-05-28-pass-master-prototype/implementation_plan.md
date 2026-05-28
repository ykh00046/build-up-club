# ⚽ Soccer Pass Puzzle (Pass Master) — Expansion Plan (Milestone 4 & 5)

This plan outlines the implementation of the remaining game modes and polish items in `index.html`.

## User Review Required
> [!IMPORTANT]
> - **Replay System**: Replay records the path of a successful level completion, then plays it back step-by-step at a normal game pace when triggered from the Result screen.
> - **Infinite Random Mode**: Procedurally generates player and defender layouts based on a chosen difficulty (Easy, Medium, Hard) and a seed.
> - **BFS Solver Integration**: Random layouts will be verified using an upgraded BFS solver that accounts for turn-based dynamic defender movements, ensuring all generated maps are 100% solvable.
> - **Mobile Hitboxes**: Dynamic touch snap radius to ensure hit targets are always at least 44px wide regardless of screen scaling.

## Proposed Changes

### [soccer-pass-game](file:///C:/Users/interojo/soccer-pass-game)

#### [MODIFY] [index.html](file:///C:/Users/interojo/soccer-pass-game/index.html)

##### 1. Replay System
- **Record Path**: In `tryPass` and `tryPassToGoal`, record the pass coordinates, target indices, and active items into `this.replayPath = []`.
- **Replay State**: Introduce `States.REPLAY`.
- **Playback Loop**:
  - Reset player/defender positions to level start.
  - Automatically fire passes one by one with a delay between them.
  - End replay on goal completion or when the user interrupts by clicking the screen or pressing `Space` / `ESC` to return to the result screen.
- **Replay UI**: Show a flashing "REPLAYING" indicator in the HUD.

##### 2. Infinite Random Mode
- **Random Mode Scenes**: Add `States.RANDOM_MENU` and random mode game handlers.
- **Difficulty Settings**:
  - **Easy**: 4 players, 1-2 static defenders. Pass limit = 3. Optimal passes = 2.
  - **Medium**: 5-6 players, 2-3 static/patrol defenders. Pass limit = 4-5. Optimal passes = 3.
  - **Hard**: 6-7 players, 3-4 defenders (including 1 chase defender). Pass limit = 5-6. Optimal passes = 4.
- **Procedural Layout Generation**:
  - Distribute player coordinates ensuring min distance of 50px between each other.
  - Distribute defender coordinates avoiding overlap with players and goal area.
- **BFS Solver Verification**:
  - Expand the built-in BFS solver `solveLevel` to simulate turn-based patrol/chase movements.
  - Validate that the generated layout has a solution matching the target optimal passes.
  - Re-generate with a new seed if validation fails (up to 200 attempts).

##### 3. Inputs & UI Polish
- **Dynamic Snap Target**: Calculate hit-test snap radius in real screen pixels. If `22px / displayScale` is larger than the default `HIT_RADIUS (14)`, use it so the physical hit area is always $\ge 44px$ in diameter.
- **Keyboard Shortcut Additions**:
  - Bind `Space` in the result screen to trigger Replay.
  - Bind `Space` during replay to skip/exit.
- **Random Menu View**: Add a sleek setup UI with Outfit font for difficulty select, seed viewing, and play triggers.

---

## Verification Plan

### Automated Verification
- Run `window._test.solveLevel(levelId)` in the browser console for all predefined stages to confirm solver correctness.
- Test the random level generator programmatically in the console by calling a generation helper and checking if it yields solvable layouts.

### Manual Verification
- Test playing through a level and clicking "Replay" / pressing `Space` to verify the ball flies correctly.
- Test resizing the window to mobile width and checking that touch selections feel easy and responsive (using the updated hit snap radius).
- Play random mode on Easy, Medium, and Hard, checking if the layouts match the desired difficulty profile.
