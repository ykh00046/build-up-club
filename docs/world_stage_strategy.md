# World Stage Attention Strategy

## Positioning

Build-Up Lab should feel like an interactive tournament highlight board.

The hook is not full 11v11 simulation. The hook is:

> Can you solve the match-defining tactical moment before the press closes?

This gives the project a broader, more marketable frame while preserving the current puzzle engine.

## Why Not Full 11v11 Yet

Full 11v11 sounds attractive, but it changes the product into a different class of game:

- full-team AI,
- off-ball runs for 22 players,
- match clock and phases,
- stamina and player attributes,
- attacking, defending, transitions, and set pieces,
- camera and input complexity.

That scope weakens the current advantage: short tactical puzzles that can be understood, played, and shared quickly.

## Recommended Direction

Use an 11v11 match wrapper, but keep the playable unit as a compact tactical moment.

The product should present each scenario as if it came from a big international match:

- match minute,
- score state,
- national-style team colors without licensed names,
- formation vs formation,
- pressure trigger,
- three-to-five action challenge,
- shareable route summary.

## Product Language

Use:

- World Stage Challenge
- International Matchday
- Knockout Drill
- Group Stage Pattern
- Final Third Puzzle
- Match-Defining Moment

Avoid unless licensed:

- FIFA
- World Cup
- real national team names,
- real player names,
- official tournament marks.

## 11v11 Roadmap

Phase 1: Current Engine, Better Framing

- Keep current scenario puzzle engine.
- Reframe levels as match moments.
- Add match minute, score, and tournament-style scenario labels.
- Improve share summaries around challenge identity.

Phase 2: Full-Pitch Visual Context

- Show inactive teammates/opponents as faded off-ball context.
- Keep only 6-8 attackers and 4-6 pressers interactive.
- Use a wider tactical board feel without adding full simulation.

Phase 3: Team Identity Without Licensing

- Add generic team palettes.
- Add archetypes such as "South American 4-3-3" or "European mid-block".
- Add packs by tactical style, not real countries.

Phase 4: Advanced Mode

- Add 11v11 planning view.
- Let the user inspect the full shape before the puzzle zooms into the active zone.
- Keep the actual solve loop short.

## Success Test

The direction is working if a casual football fan understands this within five seconds:

> This is a big-match tactical challenge. I need to find the pass that beats the press.

The direction is failing if the user expects a full match simulator.
