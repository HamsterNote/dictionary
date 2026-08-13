# Hamster Note Dictionary Design System

## 0. Research Log

- Embedded refs: shortlisted Notion, Linear, Mintlify → picked Taste Skill + Notion because a dictionary popover benefits from quiet, reading-first warmth and familiar productivity-tool structure.
- Lazyweb: skipped because this initialization task defines tooling and a compact component demo rather than a marketing surface.
- Imagen drafts: skipped because the component is functional UI and does not require image-led art direction.

## 1. Atmosphere & Identity

A quiet reading companion that feels like a small sheet of reference paper floating above the current task. The signature is the blue index tab: a restrained accent that anchors the word, pronunciation, and definition without turning the popover into a modal.

## 2. Color

| Role            | Token                         | Light                    | Dark                    | Usage                    |
| --------------- | ----------------------------- | ------------------------ | ----------------------- | ------------------------ |
| Surface         | `--dictionary-surface`        | `#ffffff`                | `#292927`               | Popover                  |
| Surface muted   | `--dictionary-surface-muted`  | `#f3f2ef`                | `#343432`               | Part-of-speech badge     |
| Text primary    | `--dictionary-text-primary`   | `#242320`                | `#f4f3ef`               | Word and definition      |
| Text secondary  | `--dictionary-text-secondary` | `#66635f`                | `#b8b5ae`               | Pronunciation and labels |
| Border          | `--dictionary-border`         | `#dedcd7`                | `#454541`               | Quiet structure          |
| Accent          | `--dictionary-accent`         | `#146ebe`                | `#62aef0`               | Actions and focus        |
| Accent strong   | `--dictionary-accent-strong`  | `#0c5799`                | `#91c9f7`               | Hover state              |
| Focus           | `--dictionary-focus`          | `#097fe8`                | `#91c9f7`               | Keyboard focus           |
| Popover shadow  | `--dictionary-shadow-high`    | `rgb(68 62 50 / 14%)`    | `rgb(0 0 0 / 28%)`      | Ambient floating depth   |
| Popover contact | `--dictionary-shadow-low`     | `rgb(68 62 50 / 8%)`     | `rgb(0 0 0 / 18%)`      | Contact shadow           |
| Demo canvas     | `--demo-canvas`               | `#f7f6f3`                | `#1f1f1d`               | Demo page                |
| Demo stage top  | `--demo-stage-from`           | `#f0eee9`                | `#292927`               | Stage gradient           |
| Demo stage base | `--demo-stage-to`             | `#ebe8e1`                | `#242422`               | Stage gradient           |
| Demo stage edge | `--demo-stage-border`         | `#e2dfd8`                | `#3c3c39`               | Stage boundary           |
| Demo document   | `--demo-document`             | `rgb(255 255 255 / 80%)` | `rgb(41 41 39 / 82%)`   | Context sheet            |
| Document edge   | `--demo-document-border`      | `rgb(222 220 215 / 88%)` | `#454541`               | Context sheet boundary   |
| Document text   | `--demo-document-text`        | `#55524d`                | `#d6d3cc`               | Context prose            |
| Demo label      | `--demo-label`                | `#8a8781`                | `#8a8781`               | Context sheet label      |
| Demo highlight  | `--demo-highlight`            | `#dcebf7`                | `#29465d`               | Selected source word     |
| Accent glow     | `--demo-popover-glow`         | `rgb(20 110 190 / 10%)`  | `rgb(98 174 240 / 14%)` | Stage emphasis           |
| Document shadow | `--demo-document-shadow`      | `rgb(68 62 50 / 7%)`     | `rgb(0 0 0 / 18%)`      | Context sheet depth      |
| Trigger shadow  | `--demo-trigger-shadow`       | `rgb(20 110 190 / 22%)`  | `rgb(0 0 0 / 28%)`      | Primary action depth     |
| On accent       | `--demo-on-accent`            | `#ffffff`                | `#242320`               | Primary button text      |

Accent is reserved for interactive controls and the index tab. New colors must be added here before use.

## 3. Typography

| Level      | Size      | Weight | Line height | Tracking   | Usage                   |
| ---------- | --------- | ------ | ----------- | ---------- | ----------------------- |
| Display    | `40px`    | 700    | 1.1         | `-0.03em`  | Demo heading            |
| Hero       | `40–58px` | 700    | 1.06        | `-0.045em` | Responsive Demo heading |
| Word       | `28px`    | 700    | 1.2         | `-0.02em`  | Dictionary headword     |
| Body       | `16px`    | 400    | 1.6         | normal     | Definition              |
| Body small | `14px`    | 400    | 1.5         | normal     | Demo guidance           |
| Caption    | `12px`    | 600    | 1.4         | `0.04em`   | Labels and badges       |

- Primary: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Phonetic: `ui-monospace, "SFMono-Regular", Consolas, monospace`

## 4. Spacing & Layout

The base unit is `4px`. Component spacing uses `4, 8, 12, 16, 20, 24, 32, 48, 64px`.

- Demo max width: `1120px`.
- Popover width: fluid from the viewport edge up to `380px`.
- Breakpoints: mobile below `640px`, tablet `640–1023px`, desktop from `1024px`.
- The Demo uses one editorial text column and one live component stage; it collapses to one column on mobile.

## 5. Components

### DictionaryPopover

- **Structure**: semantic `aside` with header, pronunciation, definition list, optional source, and close button.
- **Variants**: controlled open state; light and dark color schemes via media query.
- **Spacing**: `12–24px` from the spacing scale.
- **States**: open, closed, hover, active, focus-visible; empty meanings are prevented by the public type.
- **Accessibility**: labelled complementary landmark, real button, inset visible focus ring that cannot clip at viewport edges, minimum 44px close target.
- **Motion**: opacity and translate only; disabled under reduced motion.

### Demo Trigger

- **Structure**: button that reopens the popover.
- **States**: mounted while the popover is closed; default, hover, active, focus-visible.
- **Typography**: `16px / 650` to balance the compact primary action.
- **Accessibility**: visible label and native button semantics.

## 6. Motion & Interaction

| Type     | Duration | Easing                          | Usage           |
| -------- | -------- | ------------------------------- | --------------- |
| Micro    | `120ms`  | `ease-out`                      | Button feedback |
| Standard | `220ms`  | `cubic-bezier(0.16, 1, 0.3, 1)` | Popover entry   |

Entry motion only animates `transform` and `opacity`. Interactive controls may use short color and background-color transitions to communicate hover state. `prefers-reduced-motion: reduce` removes transitions and entry animation.

## 7. Depth & Surface

Strategy: mixed, with a whisper border and role-specific, low-opacity shadows.

- Border: `1px solid var(--dictionary-border)`.
- Popover shadow: layered warm-neutral shadow, never pure black.
- Demo stage uses tonal shifts; its rotated context sheet receives a soft document shadow to separate it from the stage.
- The primary trigger receives a compact action shadow. Other Demo sections remain shadow-free.

## 8. Accessibility Constraints & Accepted Debt

- Target WCAG 2.2 AA, with 4.5:1 body-text contrast and 3:1 large-text contrast.
- Every control is keyboard reachable and has a visible focus state.
- Touch targets are at least `44px` in either dimension.
- Reduced-motion and system dark mode are supported.

| Item | Location | Why accepted                                               | Owner / Exit |
| ---- | -------- | ---------------------------------------------------------- | ------------ |
| None | —        | No accepted accessibility or design debt at initialization | —            |
