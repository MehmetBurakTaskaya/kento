# Kento design system

The default theme of Kento: a brushed-steel safe combination dial. This document is the source of truth for the app's tokens, components, motion and sound.

Other themes (SPEC 5.20) implement the same component contract with their own tokens, wheel renderer, motion and sounds; the name, the app icon and the rules in sections 1, 8 and 9 hold for every theme.

## 1. Principles

- **Calm steel.** Grey steel, white enamel, black engraving and one accent: tempered-steel blue. Nothing brown, no gloss for its own sake.
- **A safe, not security.** The wheel is a combination dial; applying a slice turns the vault handle and throws the bolts. That is the feeling of a job done. Copy never says that files are secure, locked or protected, because Kento does not encrypt or protect anything.
- **Precise pointing.** Only the outer dial, the handle and the bolts move. The enamel face, the slices, their labels and the hub text never move under the pointer.
- **Native first.** Windows follows the Fluent structure (navigation rail, plain surfaces, Mica where available, native window controls); macOS uses traffic lights and vibrancy. Steel appears in the wheel, the toast, the shelf and a few small touches, not across every surface.
- **Fast.** The wheel is on screen within 100 ms of the key press; its first frame is already readable.

## 2. Brand

- **Name:** Kento, written with a capital K in running text. Lowercase `kento` for the app id (`com.mehmetburaktaskaya.kento`), executables and asset names (`Kento-Windows-x64-Setup.exe`).
- **App icon:** the dial seen from the front with its eight bolts thrown: a polished ring with the index notch over the knurled combination dial, a white enamel face, one tempered-blue slice and index. No handle in the icon (with spokes it reads as a ship's wheel). At 16 and 24 px: four short bolts on the diagonals, a steel ring with a dark edge, the white face and one blue wedge. On macOS the mark sits on the standard rounded-square plate. Final production (ICO with 16, 20, 24, 32, 40, 48, 64, 256 px; ICNS) happens in Phase 9.
- No fruit motifs in the brand or the default theme.

## 3. Typography

- **Brand face:** IBM Plex Sans (SIL Open Font License 1.1), variable weight, embedded in the app. Latin and Cyrillic come from the brand face.
- **Fallbacks** for the other scripts (never bundled): Chinese `Microsoft YaHei UI` / `PingFang SC`; Japanese `Yu Gothic UI` / `Hiragino Sans`; Korean `Malgun Gothic` / `Apple SD Gothic Neo`; Arabic `Segoe UI` / `SF Arabic`, `Geeza Pro`.
- **Scale** (px / line height / weight):

| Token | Size | Line | Weight | Use |
| --- | --- | --- | --- | --- |
| `type-caption` | 12 | 16 | 400 | metadata, timestamps, keycaps |
| `type-body` | 14 | 20 | 400 | default text |
| `type-body-strong` | 14 | 20 | 600 | file names, row titles |
| `type-subtitle` | 18 | 24 | 600 | drop zone title, dialog titles |
| `type-title` | 24 | 32 | 600 | page titles |
| `type-display` | 40 | 48 | 600 | first-run welcome only |

- **Wheel labels** are drawn in the wheel's 400 × 400 coordinate space and scale with the wheel: format label 20.5 (sub-label 10.8), tool and action labels 12.8 under a 22-unit icon, hub title 11.5, file name 11; labels shrink to fit their slice and wrap to two lines before shrinking below 8.
- Numbers use the user's locale (`Intl.NumberFormat`), also on the dial scale.

## 4. Color tokens

All pairs below pass WCAG 2.2 AA (text 4.5:1, UI parts and large text 3:1); the theme tests check them on every change.

### Core

| Token | Light | Dark |
| --- | --- | --- |
| `bg` | `#f2f3f5` | `#16181b` |
| `surface` | `#ffffff` | `#1f2226` |
| `surface-2` | `#f5f6f8` | `#272b30` |
| `border` | `#dcdfe4` | `#32373e` |
| `border-strong` | `#aab1ba` | `#58606a` |
| `text` | `#15181c` | `#eef0f3` |
| `text-muted` | `#555c67` | `#a3abb6` |
| `accent` (tempered blue) | `#2a4ea6` | `#89a7f5` |
| `accent-hi` | `#3a62c2` | `#a3bbff` |
| `on-accent` | `#ffffff` | `#0a1530` |
| `focus` | `#2a4ea6` | `#a3bbff` |
| `success` / `on-success` / `success-text` | `#1c7a4b` / `#ffffff` / `#186a41` | `#4fc28c` / `#05231a` / `#71d3a4` |
| `warning` / `warning-text` | `#d97706` / `#15181c` | `#e3a640` / `#f0bd66` |
| `danger` | `#c2372d` | `#ff7b70` |

### Wheel

| Token | Light | Dark |
| --- | --- | --- |
| `wheel-face` | `#f7f8f9` | `#1d2024` |
| `wheel-slice-hover` | `#dbe2ec` | `#2d333b` |
| `wheel-slice-selected` | `#28499c` | `#3a5fc0` |
| `wheel-text` | `#111317` | `#f0f2f5` |
| `wheel-text-selected` | `#ffffff` | `#ffffff` |
| `wheel-text-muted` | `#4f5661` | `#b0b8c3` |
| `wheel-num` (slice numerals) | `#2b3036` | `#c9cfd7` |
| `wheel-line` | `#d0d5db` | `#30353c` |
| `index` / `on-index` | `#2a4ea6` / `#ffffff` | `#8fb0ff` / `#0a1530` |

### Steel materials and wheel details

The ring, dial, knurl, handle and bolts, and the finer parts of the wheel. Light steel is bright and cool; dark steel is smoked, never black.

| Token | Light | Dark |
| --- | --- | --- |
| `desk` | `radial-gradient(120% 100% at 18% 0%, #f8f9fa 0%, #e7eaee 52%, #d4d9df 100%)` | `radial-gradient(120% 100% at 18% 0%, #353a40 0%, #1f2226 52%, #121417 100%)` |
| `wheel-slice` | `#f7f8f9` | `#1d2024` |
| `wheel-tick` | `#22262b` | `#d3d8de` |
| `wheel-shadow` | `rgba(26, 34, 48, 0.3)` | `rgba(0, 0, 0, 0.62)` |
| `wheel-shadow-near` | `rgba(26, 34, 48, 0.24)` | `rgba(0, 0, 0, 0.45)` |
| `chapter-hover` | `#e9edf3` | `#272c33` |
| `off-hover` | `#eceef1` | `#24282d` |
| `enamel-hi` | `#ffffff` | `#2a2e34` |
| `enamel-lo` | `#e9ecef` | `#17191c` |
| `blue-hi` | `#3d66c9` | `#5a7fdc` |
| `blue-lo` | `#1b3478` | `#28448f` |
| `index-idle` | `#646b75` | `#8a929c` |
| `pointer-edge` | `rgba(12, 22, 48, 0.55)` | `rgba(0, 0, 0, 0.55)` |
| `bezel-ring` | `conic-gradient(from 0deg, #c7ccd2 0deg, #a8aeb6 35deg, #91979f 70deg, #b4bac1 108deg, #eef1f3 135deg, #c3c8ce 165deg, #a0a6ae 205deg, #8a9098 245deg, #aeb4bb 282deg, #f7f8fa 315deg, #d6dade 345deg, #c7ccd2 360deg)` | `conic-gradient(from 0deg, #6b7179 0deg, #555b63 35deg, #454b53 70deg, #5d646c 108deg, #9ba2aa 135deg, #676e76 165deg, #4d535b 205deg, #3f454c 245deg, #585e66 282deg, #a9b0b8 315deg, #7c838b 345deg, #6b7179 360deg)` |
| `bezel-lines` | `repeating-radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.07) 0 1px, rgba(20, 26, 34, 0.045) 1px 2px)` | `repeating-radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.045) 0 1px, rgba(0, 0, 0, 0.06) 1px 2px)` |
| `dial-tick` | `rgba(20, 24, 30, 0.62)` | `rgba(232, 237, 242, 0.62)` |
| `dial-num` | `#23282e` | `#e3e8ed` |
| `knurl-dark` | `rgba(26, 31, 38, 0.46)` | `rgba(8, 10, 12, 0.55)` |
| `knurl-light` | `rgba(255, 255, 255, 0.72)` | `rgba(255, 255, 255, 0.3)` |
| `ring-hi` | `#fdfdfe` | `#b9c0c7` |
| `ring-mid` | `#cdd2d8` | `#727980` |
| `ring-lo` | `#848b94` | `#363b41` |
| `ring-opacity` | `0.9` | `0.92` |
| `notch` | `#1d2126` | `#0b0d0f` |
| `channel` | `rgba(30, 36, 44, 0.38)` | `rgba(0, 0, 0, 0.5)` |
| `edge-dark` | `rgba(28, 34, 42, 0.5)` | `rgba(0, 0, 0, 0.6)` |
| `face-shade` | `rgba(28, 34, 42, 0.1)` | `rgba(0, 0, 0, 0.35)` |
| `steel-hi` | `#ffffff` | `#c6ccd3` |
| `steel-mid` | `#c3c8ce` | `#6b727b` |
| `steel-lo` | `#7c838c` | `#2f343a` |
| `hub-face` | `#f3f5f7` | `#1b1e22` |
| `dome` | `0.85` | `0.1` |
| `spoke` | `#9ba2aa` | `#7a8189` |
| `spoke-edge` | `rgba(40, 46, 54, 0.55)` | `rgba(0, 0, 0, 0.6)` |
| `spoke-hi` | `rgba(255, 255, 255, 0.85)` | `rgba(255, 255, 255, 0.45)` |
| `knob-hi` | `#ffffff` | `#d3d8dd` |
| `knob-lo` | `#8a919a` | `#4a5158` |
| `bolt-hi` | `#ffffff` | `#eef1f4` |
| `bolt-mid` | `#c5cad0` | `#a1a8b0` |
| `bolt-lo` | `#80878f` | `#5a6169` |
| `bolt-edge` | `#596069` | `#30363c` |
| `cap-hi` | `#ffffff` | `#f4f6f8` |
| `cap-lo` | `#c9ced4` | `#9ea5ad` |
| `bolt-line` | `rgba(30, 36, 44, 0.6)` | `rgba(0, 0, 0, 0.65)` |
| `bolt-shadow` | `rgba(18, 26, 38, 0.38)` | `rgba(0, 0, 0, 0.6)` |
| `keycap` | `#e8ebef` | `#30353c` |
| `keycap-text` | `#2b3036` | `#dfe4ea` |
| `scale-tick` | `rgba(85, 92, 103, 0.42)` | `rgba(163, 171, 182, 0.35)` |
| `slot` | `#1a1e23` | `#08090b` |

## 5. Components

### The wheel

Anatomy, outside in (radii in the 400-unit space):

| Part | Radius | Moves? |
| --- | --- | --- |
| Fixed polished ring with the index notch at twelve o'clock | 187–197 | no |
| Combination dial: knurled grip, 100-step scale, numbers every 10 | 164–187 | turns to the hovered slice |
| Enamel face: chapter ring with slice numerals 1–8 | 141–164 | no |
| Slices with icon, label and sub-label (labels centred near 103.5) | 66–141 | no |
| Vault handle (four spokes) round the hub cap | 56–74 | turns an eighth on apply |
| Hub cap: wheel title, file name, modifier keycap | 0–56 | no |
| Eight bolts on the slice boundaries, hidden under the steel | thrown to 195 | out on apply |

- **Size:** 360 px on screen at 100 % scale by default; Settings offers 300–440 px. Below 300 px the dial numbers and fine ticks drop out.
- **Slices:** at most 8 per ring; the eighth is "More…" when more exist. Order is clockwise from twelve o'clock; in right-to-left languages it runs counterclockwise and the arrow keys follow the visual direction.
- **States:**
  - Idle: the dial parks on the boundary before slice 1, so the index never seems to choose a slice.
  - Hover: the dial turns the shortest way so its index sits over the slice (170 ms, with a detent overshoot); the slice takes `wheel-slice-hover`; the tooltip shows (for example "PNG: lossless, keeps transparency").
  - Selected (applied): the slice fills with `wheel-slice-selected`, the latch ring and index disc sit on its numeral, the handle stays turned and the bolts stay out until the wheel closes.
  - Off (tool not installed): hatched, labels at reduced contrast, the tooltip says which tool group is needed; applying it shakes the wheel (260 ms) instead.
  - Focus: a 2 px `focus` ring outside the fixed ring; the keyboard hover is the same as the pointer hover.
- **Tooltip:** a small card under the wheel, `surface` on `border`, `type-caption` to `type-body`.

### Main window (Home, Library)

- Fluent structure: 32 px title bar with native controls, 72 px navigation rail (Home, Library, Settings at the bottom), content on `bg`, cards on `surface` with a 1 px `border`.
- Corners: `radius` 6 px for cards, buttons and inputs; `radius-sm` 4 px for keycaps and chips.
- **Drop zone:** a dashed `border-strong` outline with a steel deposit slot and a blue arrow; title in `type-subtitle`; the primary button "Choose files" and the paste hint (`Ctrl`+`V` as keycaps).
- **Recently done:** four cards in a row (thumbnail with the target type, result name, source name with an arrow, time).
- **Tool setup card:** one row per group with a status dot (ready = `success`, missing = `warning`, optional = outline) and its size; the secondary button "Complete setup".
- **Progress:** a graduated scale (fine ticks) with a blue index at the current value, the percentage and the time left.

### Success card (toast)

- Borderless card on `surface` with a soft two-layer shadow, in a screen corner. A small dial with its bolts out as the icon, the title "Ready", the body "photo.heic → photo.jpg" (file names bidi-isolated), a "Show" action.
- Clicking the card shows the file; the card can be dragged. It stays about 4 s and stays while the pointer is over it.

### Shelf

- A steel tray with a pull at the screen edge, 272 px wide, always on top: header (title, count, pin), search field, item rows (thumbnail, name, folder and size), a flagged row for a moved or deleted file, and the hint "Drag out to drop anywhere".

### Icons

- Our own 24 × 24 stroke icons, stroke 1.6, round caps and joins, `currentColor`. Directional icons (arrows, back and forward) mirror in right-to-left layouts; the logo and media playback controls never do.

## 6. Motion

| Moment | Duration | What happens |
| --- | --- | --- |
| Open | 180 ms (+7 ms per slice for the labels) | On screen at frame 0 from 92 % scale and 40 % opacity; the dial spins in from almost a full turn back (−300°) and settles with a detent overshoot; labels fade in one after another |
| Hover | 170 ms | The dial turns the shortest way to the slice and clicks into place |
| Apply | 640 ms | 0–34 %: the dial snaps past the slice and back. 8–60 %: the handle turns an eighth (overshoot to 47°, rest at 45°). 16–57 %: the bolts are thrown in two stages (9 units, then 19.5 with a recoil to 18). 52–72 %: the latch drops and a ring closes on the numeral. 54–100 %: one glint runs round the steel |
| Close | 120 ms | The bolts pull back in the first 70 ms; the wheel fades to 95 % scale |
| Denied | 260 ms | A short sideways shake |

- **Easing:** entrances `cubic-bezier(0.12, 0.75, 0.3, 1.06)` (detent overshoot); exits `cubic-bezier(0.4, 0, 1, 1)`; the handle `cubic-bezier(0.45, 0, 0.35, 1)`; the bolt throw `cubic-bezier(0.3, 0, 0.2, 1)`.
- **The wheel closes** about 450 ms after an apply ends, so the bolts are seen out.
- **Reduced motion:** open and close become 90 ms and 80 ms fades; the dial does not spin or turn on hover (the index jumps); on apply the bolts and the latch appear without travel.

## 7. Sound

Every sound is synthesized (WebAudio in the wheel window); nothing is recorded or downloaded.

| Event | Sound | Length |
| --- | --- | --- |
| Wheel opens | a fast run of about ten fine dial ticks, slowing into a last click | about 150 ms |
| Slice changes | one crisp combination click: a dry tick, a thin ring of steel, a small body | about 30 ms |
| Job done (apply) | the handle ratchet (five ticks), a heavy bolt throw (a low thud with a ring of steel), a small latch click | about 450 ms |

- On by default at a low level (master gain 30 %); Settings has an on/off switch and a level slider.
- Slice clicks are limited to one per 30 ms, so a fast sweep does not buzz.
- A denied apply makes no sound; the shake is enough.
- Sound never replaces a visual state; everything works muted.
- **Haptics (macOS):** `NSHapticFeedbackManager` alignment feedback on slice change and level-change feedback on apply, when the setting is on.

## 8. Accessibility

- WCAG 2.2 AA contrast for every token pair, in both themes.
- Every slice has a screen-reader label ("PNG, lossless"); the wheel is a menu, slices are menu items, disabled slices say why.
- Keyboard: arrows, Home, End, Enter or Space to apply, Esc or Tab to close; a visible 2 px focus ring.
- Windows High Contrast: system colors, no steel textures, no shadows; the wheel keeps its structure with plain outlines.
- Reduced motion as in section 6; sound and haptics follow their own settings.

## 9. Performance rules

- The static parts of the wheel (fixed ring, dial with knurl and scale, enamel face) are rendered once per theme and scale and cached; only the dial rotation, the index, the handle, the bolts and the slice states are drawn live.
- No SVG filters or per-frame noise in the wheel; brushing and knurl are pre-rendered.
- Thrown bolts reach past the dial's edge, so the wheel window is larger than the dial and the shadow of a thrown bolt is never cut.

## 10. Copy

- Short and plain: "Ready", "Show", "Complete setup", "Moved or deleted".
- Never "secure", "locked", "protected", "safe" or a padlock about files.
- File names and paths are bidi-isolated wherever they appear.
