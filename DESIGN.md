# Hamster Note Dictionary Design System

## 0. Research Log

- Embedded refs: shortlisted Notion, Linear, Mintlify → picked Taste Skill + Notion because a dictionary popover benefits from quiet, reading-first warmth and familiar productivity-tool structure.
- Lazyweb: skipped because this initialization task defines tooling and a compact component demo rather than a marketing surface.
- Imagen drafts: skipped because the component is functional UI and does not require image-led art direction.

## 1. Atmosphere & Identity

A quiet reading companion that feels like a small sheet of reference paper floating above the current task. Restrained accents are reserved for actions and focus, keeping the word, pronunciation, and definition readable without turning the popover into a modal. The Demo offers violet, blue, teal, orange, and pink accents without changing the component's reading-first character.

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
| Accent text     | `--dictionary-accent-text`    | `#0c5799`                | `#91c9f7`               | High-contrast small text |
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

Accent is reserved for interactive controls and focus. The Demo derives accent, soft, strong, focus, and high-contrast text roles from the selected components theme preset. `--dictionary-accent-text` mixes the selected accent toward primary text and must retain at least 4.5:1 contrast wherever accent appears as small text, a focus indicator, a selected border, or a solid action surface paired with `--demo-on-accent`. Decorative swatches alone retain the unmodified preset color. New colors must be added here before use.

## 3. Typography

| Level      | Size      | Weight | Line height | Tracking   | Usage                   |
| ---------- | --------- | ------ | ----------- | ---------- | ----------------------- |
| Display    | `40px`    | 700    | 1.1         | `-0.03em`  | Demo heading            |
| Hero       | `40–58px` | 700    | 1.06        | `-0.045em` | Responsive Demo heading |
| Word       | `28px`    | 700    | 1.2         | `-0.02em`  | Dictionary headword     |
| Body       | `16px`    | 400    | 1.6         | normal     | Definition              |
| Body small | `14px`    | 400    | 1.5         | normal     | Demo guidance           |
| Caption    | `12px`    | 600    | 1.4         | `0.04em`   | Labels and badges       |
| Eyebrow    | `12px`    | 700    | 1.4         | `0.08em`   | Demo section labels     |

- Primary: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Phonetic: `ui-monospace, "SFMono-Regular", Consolas, monospace`

## 4. Spacing & Layout

The base unit is `4px`. Component spacing uses `4, 8, 12, 16, 20, 24, 32, 48, 64px`.

- Demo max width: `1120px`.
- Informational panel max width: `--demo-panel-max-width` (`470px`).
- License explanation max width: `--demo-license-popover-max-width` (`320px`).
- Panel radius: `--demo-panel-radius` (`12px`); compact control radius: `--demo-control-radius` (`10px`).
- Popover width: fluid from the viewport edge up to `380px`.
- Breakpoints: compact layout below `900px`, with tighter mobile sizing below `560px`.
- The Demo uses one editorial text column and one live component stage; it collapses to one column on mobile. At every breakpoint, the stage reserves the viewport-height popover plus its anchor offset so the popover's bottom edge remains inside the stage and its internal scroll area stays reachable.

## 5. Components

### DictionaryPopover

- **Structure**: semantic `aside` with a dedicated drag handle, search field, header, pronunciation, definition list or empty result, content-bound source groups, and close button. It has no footer or decorative edge tab.
- **Variants**: controlled open state; light and dark color schemes via media query.
- **Spacing**: `12–24px` from the spacing scale.
- **States**: open, closed, uncommitted input, committed result, no result, word preview, pronunciation busy, pronunciation error, hover, active, focus-visible, and dragging.
- **Accessibility**: labelled complementary landmark, labelled search field, polite result-count announcements, real close button, visible focus rings, and 44px primary controls. Compact title-bar navigation and close buttons use the components `small` size at 36px. The drag handle supports pointer dragging, arrow-key movement, and Home/Escape reset; positioning must never be required to search, read, or close the popover.
- **Motion**: entry and drag use composited transforms; entry motion is disabled under reduced motion while direct manipulation remains available without easing.
- **Drag contract**: only the 44px-high region above the search field starts a pointer drag. The input, close button, definitions, and source remain fully selectable and interactive.
- **Navigation**: the title area exposes independent 36px back and forward buttons using the components `small` size when those destinations exist, while the title-bar row remains 44px high. History is session-only, stores committed headwords rather than draft input, truncates the forward branch after a new search, and is never persisted.
- **Blank state**: before any headword is committed, the content area shows “仓鼠词典” plus a short three-step guide for typing, confirming a candidate, and opening inline word previews. It is guidance rather than a failed-lookup message.
- **Inline vocabulary**: definitions and examples may render only exact, currently resolvable dictionary words as quiet text buttons. Their pointer target is confined to the rendered line box so it never obscures adjacent lines. Activating one opens a Portal-backed anchored mini preview with headword, phonetic or pinyin, and a basic meaning; an explicit expand button commits it to the main window. Plain text remains selectable and must never look interactive when no entry can be resolved.

### Dictionary Search

- **Structure**: a controlled combobox inside the popover; consumers own the draft query, structured suggestions, and local or remote resolution.
- **Interaction**: typing updates only the draft query and candidate list; it never replaces the committed definition. Pointer selection or Arrow Up/Down followed by Enter commits that candidate, while Enter with no active candidate commits the typed query. Escape dismisses suggestions. A trailing clear button resets only the draft query without moving focus.
- **Candidate detail**: each candidate has a primary headword, a compact phonetic (English) or pinyin (Chinese) line, and one basic meaning. Detail is derived from the already loaded dictionary entry, truncates rather than expanding the menu width, and remains part of the option’s accessible name.
- **Empty state**: a concise message replaces the ordered definition list when the lookup has no exact result.
- **Data provenance**: every visible source label is attached directly to the definition or example content it supplied, links to the source's official site or repository, and is repeated as a separate group when multiple sources contribute content. Demos must not attribute generated or bundled content to an unrelated publisher.
- **Bundled data**: the default synchronous lookup indexes a generated 5,000-entry ECDICT core. Selection uses the best available `frq` or `bnc` rank, then the other rank and normalized headword for deterministic ordering.
- **Chinese dictionaries**: Chinese lookup is a parallel typed data path rather than an extension of the English tuple. It normalizes queries with NFKC, searches enabled packs in UI order, shows the actual matching source, and supports exact Han-character and idiom headwords plus prefix suggestions.
- **Vocabulary packs**: 中考、高考、CET-4、CET-6、考研、IELTS、TOEFL、GRE and BNC are separate package entry points. Exam packs contain words carrying the matching upstream-native ECDICT tag; BNC contains entries with a positive British National Corpus rank ordered from most frequent to least frequent. Every pack excludes the core, packs may overlap one another, and runtime lookup deduplicates by normalized headword.
- **Size boundary**: the root library budgets about 211 kB gzip and contains no Chinese snapshot. The 40,470-entry BNC complement, 3,500-entry common-character dictionary, and 45,705-headword Xinhua/idiom dictionary are isolated package entries. Optional packs are loaded only after explicit import, and the Demo reports an approximate gzip total for the root entry and enabled data snapshots rather than a built JavaScript chunk size.
- **Positioning**: the demo anchors the popover from its top edge so definition-height changes move the bottom edge instead of shifting the search controls.

### Pronunciation Control

- **Structure**: an optional 44px speaker button sits immediately after the phonetic text. It uses a restrained inline SVG rather than an emoji or a new icon dependency.
- **Visibility contract**: `DictionaryPopover` renders the control only when both a phonetic value and a `pronounce` handler are present. Consumers therefore own the opt-in setting; the default component surface remains silent and icon-free.
- **States**: idle, busy while preparing or playing audio, recoverable error, hover, active, and focus-visible. Repeated activation while busy is disabled to prevent overlapping requests.
- **Accessibility**: the button names the current word, exposes `aria-busy`, retains a 44px target, and announces recoverable failures through a polite live region without displacing the header.
- **Loading boundary**: the root package never imports Kokoro. The optional `./kokoro` entry creates a module Worker, and that Worker imports `kokoro-js` and downloads the English model only after the first pronunciation request.

### Dictionary Pack Picker

- **Structure**: a native-checkbox fieldset below the Demo metadata. Nested labelled fieldsets divide resources into 中文词典、基础学段、国内英语考试、留学考试、语料词频和英文全局补充, while each option retains its label, entry count, gzip estimate, loading state, total estimate, and explanatory note. 英语例句与 WordNet 近义词各使用一个全局勾选项；启用后，受影响英文词包用高对比 `--dictionary-accent-text` 标记补充内容，并在原大小上累加对应 gzip 估算。
- **States**: available, checked, loading-busy, load error, focus-visible, light, and dark.
- **Typography and spacing**: `12px` caption text on the 4px spacing scale; option rows use `8px 12px` padding.
- **Accessibility**: native checkbox semantics, 44px option rows, visible focus outline, preserved keyboard focus while loading, polite loading and size updates, and an alert only when loading fails.
- **License disclosure**: every option row shows a compact license badge beside the dictionary name and an independent 44px info trigger on the right. The anchored explanation popover names the data source, summarizes the applicable retention or review obligation, and preserves upstream-rights uncertainty rather than implying that repository-level licensing removes it.
- **License interaction**: the explanation opens on pointer hover, keyboard focus, or click/tap; remains open while the pointer crosses into the popover; closes after pointer exit, focus exit, outside interaction, or `Escape`; and returns focus to the trigger when closed with `Escape`. The trigger uses native button semantics and the non-interactive explanation uses tooltip semantics.
- **Loading contract**: each visible dictionary option maps to a statically analyzable dynamic import. Each global supplement option fans out only to the core and currently enabled English-pack chunks; enabling another English pack while a supplement is active loads that pack's matching supplement chunk. Unchecked packs must not enter the initial Demo chunk. Switching the query language never triggers a pack request by itself.

### Demo Feature Options

- **Structure**: a compact native-checkbox fieldset follows the optional dictionary packs and describes pronunciation separately from data resources.
- **States**: unchecked, checked, focus-visible, light, and dark. Unchecking immediately hides the pronunciation control and disposes its Worker and active audio.
- **Loading contract**: checking the option only exposes the speaker button. The Demo imports the optional Kokoro entry on the first button activation and clearly warns that the first use downloads an approximately 92 MB model.

### Dictionary Copyright Notice

- **Structure**: a bordered informational panel follows the dictionary and feature controls. It contains a concise commercial-use boundary, the number of deduplicated upstream data sources represented by the current selection, a primary download button, and a secondary link to the repository's complete third-party notice.
- **Selection contract**: the always-bundled ECDICT core is always represented. Optional English packs reuse that same ECDICT notice, the global example supplement adds one OANC notice, the global synonym supplement adds one WordNet notice, and each selected Chinese dictionary adds its own notice. The downloaded text lists enabled resources before the deduplicated source notices.
- **States**: default, loading-disabled, button hover, active, focus-visible, light, and dark. While any selected pack is loading, downloading is disabled so the file cannot silently omit a visibly checked resource. The panel does not claim that repository-level licenses eliminate upstream data-rights risk.
- **Typography**: the eyebrow uses the `12px` Eyebrow level, body and button copy use the `14px` Body small level, and the source count/link use the `12px` Caption level.
- **Accessibility**: the panel is an explicitly labelled region, the native download button and explanatory link both have a 44px target and visible focus ring, and the link remains distinguishable without relying on color alone.
- **Copy contract**: state that the included sources are provided under licenses or open-use statements that permit commercial use, while making retention of applicable copyright and permission notices, review of source-specific conditions, and independent legal review explicit. Do not describe the datasets as “commercial-use risk free.”

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
- Primary and content controls retain at least `44px` in either dimension. The user-requested compact title-bar back, forward, and close controls are the components `small` size at `36px`, centered within an unchanged `44px` title-bar row.
- Reduced-motion and system dark mode are supported.

| Item                            | Location                    | Why accepted                                                                                   | Owner / Exit                                      |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Compact 36px title-bar controls | DictionaryPopover title bar | Explicit product requirement to reduce the components size enum while preserving the 44px row. | Revisit if mobile usability testing finds misses. |
