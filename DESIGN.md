# Build-Up Club Design System

## 1. Product Feel
Build-Up Club is a tactical football game, not a marketing site. The interface should feel like a broadcast tactics desk: dark, focused, data-rich, and playable under pressure.

## 2. Color Tokens
- `--bg`: off-black match background.
- `--panel`: primary raised surface.
- `--panel-2`: nested control surface.
- `--line`: low-contrast separator.
- `--text`: primary readable text.
- `--text-muted`: secondary context.
- `--accent`: tactical action and progress.
- `--warn`: timed pressure and shot opportunity.
- `--danger`: turnover, risk, and failed defensive state.

## 3. Typography
- Headings and numeric broadcast labels use Saira Condensed.
- Body and controls use the existing sans-serif stack.
- Numbers use tabular figures where possible.
- Compact panels use small, high-contrast labels. Avoid hero-sized type inside match tools.

## 4. Layout
- Match play keeps the pitch as the dominant surface.
- Action controls must remain reachable and visible on desktop and mobile.
- Pre-match briefing starts with one recommended plan. Detailed scouting and setup controls live behind progressive disclosure.
- Result screens put the next recommended action close to the metrics.

## 5. Components
- Action buttons: compact rectangular buttons with 5-8px radius, clear disabled state, visible focus state.
- Situation actions: warn/danger treatment, larger than routine actions, duplicated near the actionbar when they block normal play.
- Briefing plan: single highlighted strip containing opponent type, intended edge, and recommended action chain.
- Report CTA: prominent "what to do next" block immediately after metrics.

## 6. Motion
- Use transform, opacity, and filter only.
- Respect reduced motion by disabling decorative infinite animation.
- Timed tactical states may pulse only when they require immediate action.

## 7. Accessibility
- Keyboard play must remain complete.
- Visible controls must not be hidden behind canvas or decorative surfaces.
- Dialogs should keep focus on the primary next action.
- Mobile layouts must avoid horizontal scrolling and keep tap targets at least 44px.
