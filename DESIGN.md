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
| Accent soft     | `--dictionary-accent-soft`    | `#e8f2fb`                | `#223c52`               | Selected option surface  |
| Accent strong   | `--dictionary-accent-strong`  | `#0c5799`                | `#91c9f7`               | Hover state              |
| Error           | `--dictionary-error`          | `#b42318`                | `#ffb4ab`               | Recoverable load errors  |
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
- Breakpoints: compact layout below `900px`, with tighter mobile sizing below `560px`.
- The Demo uses one editorial text column and one live component stage; it collapses to one column on mobile.

## 5. Components

### DictionaryPopover

- **Structure**: semantic `aside` with a dedicated drag handle, search field, header, pronunciation, definition list or empty result, optional source, and close button.
- **Variants**: controlled open state; light and dark color schemes via media query.
- **Spacing**: `12–24px` from the spacing scale.
- **States**: open, closed, searching, result, no result, hover, active, focus-visible, and dragging.
- **Accessibility**: labelled complementary landmark, labelled search field, polite result-count announcements, real close button, visible focus rings, and minimum 44px controls. The drag handle supports pointer dragging, arrow-key movement, and Home/Escape reset; positioning must never be required to search, read, or close the popover.
- **Motion**: entry and drag use composited transforms; entry motion is disabled under reduced motion while direct manipulation remains available without easing.
- **Drag contract**: only the 44px-high region above the search field starts a pointer drag. The input, close button, definitions, and source remain fully selectable and interactive.

### Dictionary Search

- **Structure**: a controlled combobox inside the popover; consumers own the query, suggestions, and local or remote resolution.
- **Interaction**: typing updates results and opens a frequency-ranked suggestion list. Pointer selection or Arrow Up/Down followed by Enter jumps directly to that entry; Escape dismisses suggestions. A trailing clear button resets the controlled query without moving focus.
- **Empty state**: a concise message replaces the ordered definition list when the lookup has no exact result.
- **Data provenance**: the visible source must identify the dictionary data actually used; demos must not attribute generated or bundled content to an unrelated publisher.
- **Bundled data**: the default synchronous lookup indexes a generated 5,000-entry ECDICT core. Selection uses the best available `frq` or `bnc` rank, then the other rank and normalized headword for deterministic ordering.
- **Vocabulary packs**: 中考、高考、CET-4、CET-6、考研、IELTS、TOEFL、GRE and BNC are separate package entry points. Exam packs contain words carrying the matching upstream-native ECDICT tag; BNC contains entries with a positive British National Corpus rank ordered from most frequent to least frequent. Every pack excludes the core, packs may overlap one another, and runtime lookup deduplicates by normalized headword.
- **Size boundary**: the root library budgets about 211 kB gzip. The 40,470-entry BNC complement is intentionally isolated at about 1.32 MiB gzip as a JS entry. Optional packs are loaded only after explicit import, and the Demo reports a conservative sum of the root and selected pack chunks.
- **Positioning**: the demo anchors the popover from its top edge so definition-height changes move the bottom edge instead of shifting the search controls.

### Vocabulary Pack Picker

- **Structure**: a native-checkbox fieldset below the Demo metadata. Nested labelled fieldsets divide the nine packs into 基础学段（中考、高考）、国内英语考试（CET-4、CET-6、考研）、留学考试（IELTS、TOEFL、GRE）和语料词频（BNC）, while each option retains its label, entry count, gzip estimate, loading state, total estimate, and explanatory note.
- **States**: available, checked, loading-busy, load error, focus-visible, light, and dark.
- **Typography and spacing**: `12px` caption text on the 4px spacing scale; option rows use `8px 12px` padding.
- **Accessibility**: native checkbox semantics, 44px option rows, visible focus outline, preserved keyboard focus while loading, polite loading and size updates, and an alert only when loading fails.
- **Loading contract**: each option maps to a statically analyzable dynamic import. Unchecked packs must not enter the initial Demo chunk.

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

Entry motion only animates `transform` and `opacity`. Dragging follows the pointer one-to-one through `translate3d` with no decorative inertia. Interactive controls may use short color and background-color transitions to communicate hover state. `prefers-reduced-motion: reduce` removes transitions and entry animation.

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
