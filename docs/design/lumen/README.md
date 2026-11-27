# Lumen

The design system for JSON Workbench. Calm colors for people who read JSON all day.

Lumen is built for long sessions, in the spirit of Postman and jsondiff.com: a bright, clean workspace with a left rail, a document tab strip and one orange accent. Surfaces are near-white (or a warm dark), syntax colors are muted and sit at similar brightness so no single color shouts, and there is exactly one interactive color. The data is the loudest thing on screen.

## Principles

1. **Data first.** Keys, values and structure get the contrast. Chrome (toolbars, panels, borders) recedes.
2. **One accent.** `accent` marks what you can click and where focus is. Nothing else uses it. Status uses `ok`, `warn` and `danger`, always with a word or icon, never color alone.
3. **Quiet syntax.** Syntax colors (`syn-key`, `syn-string`, `syn-number`, `syn-bool`, `syn-null`) are desaturated and similar in lightness. Meaning comes from hue and position, not brightness.
4. **Hairlines, not boxes.** Regions are separated by a single 1px `line`. No shadows, no nested cards.
5. **Few words.** One toolbar row. Buttons say a verb. Help appears when asked for (`?`, Ctrl K), not by default.

## Content fundamentals

- Sentence case everywhere ("Copy path", not "Copy Path").
- Buttons are verbs: Open file, Format, Export, Apply fix.
- Errors state where and why, then offer a fix: "Line 7, column 24. Expected ',' or '}' after property value."
- Say what stays private once, in the status bar: "Local only".

## Visual foundations

- **Color:** two themes, Light (default) and Dark. Text on its surface is 4.5:1 or better in both. Backgrounds `ok-bg`, `warn-bg` and `danger-bg` tint whole rows for compare and errors; pair them with `ok`, `warn`, `danger` text. Dialogs sit on `scrim`, which darkens the page behind them in both themes.
- **Type:** Inter for UI, JetBrains Mono for data. UI body is 14/20; code is 13/24 so rows are easy to scan.
- **Spacing:** a 4px grid. Tree and code rows are `row` (28px). Panels use `space-4` padding.
- **Radius:** `radius-md` for controls, `radius-sm` for badges, `radius-lg` for the drop zone.
- **Focus:** a 2px `accent` ring with 2px offset on every interactive element.
- **Motion:** none beyond 120ms fades; respect reduced motion.

## Syntax color map

| Value                | Token        |
| -------------------- | ------------ |
| key                  | `syn-key`    |
| string               | `syn-string` |
| number               | `syn-number` |
| true, false          | `syn-bool`   |
| null, braces, counts | `syn-null`   |

## Patterns

- **Layout:** a 208px left rail (modes: View, Compare, Transform, Types, JWT; recent files), a tab strip of open documents with a 2px `accent` top edge on the active one, then a toolbar, content and a details panel.
- **Sub-tabs** (Tree, Raw, Table) are text with a 2px `accent` underline when active. No filled pills.
- **Badges** (JWT, JSON inside, type warnings) are small `radius-sm` chips: `info-bg` for actions, `warn-bg` and `danger-bg` for problems.
- **Selected row:** `selected` background, no border.
- **Primary button:** one per screen, `accent` fill with `on-accent` text. Everything else is a text button with a `line` border on hover.

## Iconography

None needed yet. Use plain text labels and the characters ▾ ▸ for tree expansion. Add a single-weight stroke icon set only when an action cannot be named in a word.
