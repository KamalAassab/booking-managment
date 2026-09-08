# Atelier Planning — design system

The interface for a staff-only booking tool used by four call-centre agents,
three front-desk people and one owner, across three salons in El Jadida.

Everything here is derived from one observation: **the phone is the primary
device.** Not the desktop. The owner checks the day from a phone on 3G; the
front desk works standing up; an agent is holding a handset in the other hand.
Desktop is the comfortable case, and it is designed second.

---

## 1. The one idea

**A salon day is a column that fills up. The whole job is reading the gaps.**

Every layout decision serves that. Height is strictly proportional to
duration, so a 90-minute coloration is three times the height of a 30-minute
cut and the shape of the day is legible before a single word is read. The
grid is the product; everything else gets out of its way.

This is also why there are no status badges. A pill saying "Confirmé" on
every card is a word where a shape would do, and eleven of them stacked down
a column is noise that hides the thing you came to see.

---

## 2. Principles

**Read the day, don't parse it.** Information that can be carried by
position, size or weight is never carried by a label.

**One accent, spent once.** Brass marks the live edge of the day and the
primary action. Nothing else competes. The live-edge rule is drawn at 45%
opacity: it crosses whatever booking is running, and at full weight it read
as a strikethrough through that client's name.

**Status is a surface, not a sticker.** Confirmed is solid. Done recedes.
Cancelled is not drawn — the slot genuinely is free again, which is exactly
what the database constraint believes too.

**Nothing decorative survives.** No avatar stacks, no notification counts, no
prices, no gradient. If it does not help someone place or find a booking, it
is not in the interface.

**Fast beats rich.** Two variable fonts, no icon library, no chart runtime.
The connection is the constraint.

---

## 3. Colour

The substrate is a cool near-white; the only warm thing in the interface is
the accent. That tension — cool paper, warm metal — is the identity.
Deliberately not a cream-and-terracotta scheme, and deliberately not the
gold-on-black that "salon" invites; *atelier* means workshop, and the
reference points are brass hardware and paper, not luxury packaging.

### Neutrals

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#FBFBFA` | `#101315` | Page ground |
| `--surface` | `#FFFFFF` | `#181C1F` | Cards, sheets, header |
| `--surface-sunk` | `#F4F5F4` | `#0B0D0F` | Past hours, inset wells |
| `--line` | `#E4E7E5` | `#282D31` | Hairlines, dividers |
| `--line-strong` | `#CFD4D1` | `#39403F` | Input borders, focus edges |
| `--ink` | `#14181A` | `#F2F4F3` | Primary text |
| `--ink-soft` | `#5A6570` | `#98A3A8` | Secondary text |
| `--ink-faint` | `#8B959B` | `#6B7478` | Tertiary, disabled |

Neutrals carry a slight green-grey cast rather than blue. Against brass a
blue-grey reads cold and corporate; the green-grey reads as paper.

### Accent

| Token | Value | Use |
|---|---|---|
| `--brass` | `#A87F2E` | Primary action, current time, selected day |
| `--brass-hover` | `#8E6B25` | Hover / active |
| `--brass-tint` | `#FAF5E9` | Selected backgrounds, hover on free slots |
| `--brass-tint-dark` | `#2A2317` | Same, in dark mode |

Brass appears at most twice per screen. If a third use appears, one of them
is wrong.

### Salon identity

Only used where salons are compared — the switcher and the owner's
three-column view. Never inside a single-salon grid, where the colour would
be constant and therefore meaningless.

| Salon | Light | Dark |
|---|---|---|
| VIP | `#6B4E71` plum | `#B99CC0` |
| Gold | `#A87F2E` brass | `#D6B26B` |
| Barber | `#3E6B70` slate teal | `#8FBDC1` |

All three are ink-mixed and equally muted, so none dominates when the owner
sees them side by side.

### State

Semantic colour is reserved for things that are genuinely exceptional.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--danger` | `#A93B33` | `#E8908A` | Cancel, destructive confirm |
| `--danger-tint` | `#FCF2F1` | `#2B1917` | Error message ground |

There is no success green. A booking that saved shows up in the grid; that is
the confirmation.

### Contrast

Every text/ground pair meets WCAG AA (4.5:1 body, 3:1 for text ≥ 18.66px
bold). `--ink-faint` on `--surface` is 4.6:1 and is never used below 13px.

---

## 4. Typography

Two variable faces, both self-hosted, subset to Latin + Latin-Extended-A for
French diacritics. A third face was cut for load time.

**Bricolage Grotesque** — display. Slightly industrial, mechanical width, a
real point of view. Used only for screen titles, salon names and the login
wordmark. Its optical-size axis is set low at small sizes so it stays a
workshop face rather than a fashion one.

**Instrument Sans** — everything else. Warm-neutral, generous x-height,
excellent at 13–15px on a phone, and its tabular figures are what the time
rail is built on.

```
--font-display: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
--font-sans:    "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
```

Both load with `font-display: swap` against a metric-similar system fallback,
so a slow connection shows readable text immediately and never a blank grid.

### Scale

A 1.2 minor third, rounded to whole pixels. Small by dashboard standards,
because density is what lets a whole day fit on a phone.

| Step | Size / line | Weight | Face | Use |
|---|---|---|---|---|
| `display` | 28 / 32 | 600 | Display | Login wordmark |
| `title` | 20 / 26 | 600 | Display | Screen title, salon name |
| `heading` | 16 / 22 | 600 | Sans | Section heading, sheet title |
| `body` | 15 / 22 | 400 | Sans | Default, form values |
| `body-strong` | 15 / 22 | 600 | Sans | Client name on a card |
| `small` | 13 / 18 | 400 | Sans | Service, phone, helper text |
| `micro` | 11 / 14 | 600 | Sans | Field labels, day-strip weekday |

`micro` is the only step that is uppercased, with `0.08em` tracking. Nothing
else in the interface is uppercase — it is a labelling device, not a
decorative one.

### Numerals

Times, durations and dates use `font-variant-numeric: tabular-nums`
everywhere without exception, so a column of times aligns on the colon and
the eye can scan it as a rail rather than reading each one.

---

## 5. Space, radius, elevation

### Space

A 4px base. Only these values are used; anything between them is a mistake.

```
4  8  12  16  20  24  32  40  56
```

Screen gutters: 16px on mobile, 24px from `md`, 32px from `lg`.

### Radius

Generously soft, consistently applied — this is where the reference's warmth
comes from and it is worth keeping.

| Token | Value | Applies to |
|---|---|---|
| `--r-sm` | 8px | Inline marks, day-strip cells |
| `--r-md` | 12px | Buttons, inputs, booking cards |
| `--r-lg` | 16px | Cards, panels |
| `--r-xl` | 20px | Sheets, dialogs |
| `--r-full` | 999px | Only the salon switcher's thumb |

Nested corners step down one level, so a 12px control inside a 16px card
never looks pinched.

### Elevation

Two levels. A tool used all day should feel flat and calm.

```
--shadow-card:  0 1px 2px rgb(20 24 26 / .04), 0 1px 1px rgb(20 24 26 / .03);
--shadow-sheet: 0 -8px 32px rgb(20 24 26 / .12);
```

In dark mode both are replaced by a `--line` border; shadows do not read on a
dark ground and a hairline does the same job honestly.

---

## 6. Icons

Inline SVG, 20×20, `stroke-width: 1.5`, `currentColor`, round caps and joins.

**No container.** No circle, no rounded square, no border, no tinted plate
behind any icon. An icon sits directly on the surface next to its label.

Fewer than a dozen exist in the whole interface: chevron, plus, check, close,
calendar, clock, phone, user, arrow-left, arrow-right. They are written by
hand into the components that need them rather than pulled from a library —
one dependency avoided, and it keeps the set from growing.

An icon never appears alone unless the control also carries an `aria-label`
and the meaning is unambiguous in context (day navigation arrows, sheet
close).

---

## 7. Components

### Button

One shape, three intents, two sizes. Radius `--r-md`. Height 44px default,
36px compact — never below 44px for anything a thumb hits on mobile.

| Intent | Fill | Text | Border |
|---|---|---|---|
| Primary | `--brass` | white | none |
| Quiet | transparent | `--ink` | `--line-strong` |
| Danger | transparent | `--danger` | `--danger` at 40% |

There is no tertiary or link-button intent; a text link is a link. Disabled
is 45% opacity with `cursor: not-allowed`. Focus is a 2px `--brass` ring at
2px offset, always visible, never removed.

### Field

Full width, 44px min height, radius `--r-md`, 1px `--line-strong` border,
`--surface` fill. Label above in `micro`. Focus swaps the border to `--brass`
and adds a 3px tint ring.

`font-size` is never below 16px on inputs, because iOS zooms the viewport on
focus for anything smaller and that zoom does not undo itself.

Errors: border to `--danger`, message below in `small` `--danger`. The
message says what to do, not that something is invalid.

### Card

`--surface` on `--paper`, radius `--r-lg`, `--shadow-card`, 16px padding
(20px from `md`). No border in light mode — the shadow separates it. A 1px
`--line` border in dark mode instead.

### Booking card — the signature

Placed on the grid by CSS Grid row arithmetic, not absolute positioning:

```
grid-row: <slot index + 1> / span <ceil(durationMin / slotMin)>
```

Height is therefore proportional to duration by construction, and a booking
cannot be rendered overlapping another one even if the data were wrong.

Content adapts to the card's height, because a 30-minute card is 56px tall
and cannot stack four lines — the service used to be clipped mid-word:

| Span | Shows |
|---|---|
| 1 (≤ 30 min) | `Name · Service` on one line, duration right-aligned |
| 2 (≤ 60 min) | Name + duration, service, phone |
| 3+ (≥ 90 min) | The above plus notes, clamped to two lines |

Anything that does not fit is one tap away in the sheet.

Status is surface, not sticker:

- **Confirmed** — `--surface` fill, 1px `--line`, full contrast, and a 3px
  brass rule down the leading edge.
- **Done** — same geometry, `--surface-sunk` fill, no leading rule, text at
  `--ink-soft`, and a 14px check glyph inline before the name. The day
  receding behind you.
- **Cancelled** — not rendered. The slot returns to free.

### Free slot

A full-width button, not a decorated div, so it is keyboard-reachable and
announces itself. Transparent until hover/focus, then `--brass-tint` with a
`+` and the word. Minimum height 44px.

Under `@media (hover: none)` the `+` sits at 35% opacity permanently. A touch
screen has no hover, so a hover-only affordance means a free slot advertises
nothing at all — which is most of this app's real usage.

Past slots take `--surface-sunk` and drop to 55% opacity but stay clickable —
back-dating a booking someone forgot to enter is a real thing a front desk
does at 6pm.

### Day strip

Seven days, horizontally scrollable, snapping. Each cell: weekday in `micro`
above, date numeral in `body-strong` below, 44×56px, radius `--r-sm`.
Selected fills `--brass`; today is marked by a 3px brass dot under the
numeral, not a ring, so today and selected can be true at once without
fighting.

On mobile the strip is the *only* day control: the ‹ › arrows are hidden
below `lg` because they duplicate it, and keeping them was what squeezed the
date heading into "mardi 8 septem…". "Aujourd'hui" appears only when the
selected day is not today — a permanently disabled control is furniture.

### Salon switcher

A segmented control on a `--surface-sunk` track, radius `--r-full`, with the
active thumb in `--surface` carrying `--shadow-card` and a 6px salon-colour
dot. Three items fit a 375px screen at 13px; the salon names are shortened
("VIP", "Gold", "Barber") because the "L'Atelier" prefix is constant and
therefore carries nothing.

### Sheet / dialog

**Below `md`:** a bottom sheet. Full width, radius `--r-xl` on the top
corners only, `--shadow-sheet`, max-height 92vh, its own scroll, a 36×4px
grab handle, and a safe-area bottom inset. It enters by translating up 100%
over 220ms on `cubic-bezier(.32,.72,0,1)`.

**From `md`:** a centred panel, 480px, radius `--r-xl`, fading and rising 8px
over 160ms.

Both trap focus, return focus to the trigger on close, close on Escape and on
backdrop press, and set `aria-modal`. The backdrop is `rgb(20 24 26 / .32)`
with a 2px blur.

### Toast

Bottom centre on mobile (above the action bar), bottom right from `md`.
`--surface`, radius `--r-md`, `--shadow-card`, one line of `small` plus an
optional single action link. Auto-dismisses at 6s except when it carries the
WhatsApp link, which stays until dismissed — losing that link silently is
the failure the toast exists to prevent.

---

## 8. Layout

### Breakpoints

```
base   0–639    phone, one hand
md     640      large phone landscape, small tablet
lg     1024     desktop — front desk
xl     1280     owner's three-salon view
```

### Mobile (base)

```
┌──────────────────────────────┐
│ Atelier          ● live   ⏻  │  sticky, 52px
│ [ VIP ][ Gold ][ Barber ]    │  switcher
│ ‹ lun 8 septembre ›          │  title + nav
│ [7][8][9][10][11][12][13]    │  day strip, snaps
├──────────────────────────────┤
│ 09:00 │                      │
│ 09:30 │ ▌Salma Bennani   90m │  height ∝ duration
│ 10:00 │  Coloration          │
│ 10:30 │                      │
│ 11:00 │ +                    │  free, 44px
│ ────── ── now ────────────── │  brass rule
└──────────────────────────────┘
│      [ Nouveau rendez-vous ] │  fixed, safe-area
```

Time rail 56px. Grid scrolls under the sticky header. The action bar is
fixed so the primary action is always under the thumb.

### Desktop (lg)

```
┌────────┬──────────────────────────────────────────┐
│ Atelier│  mardi 8 septembre 2026                  │
│Planning│  VIP · 6 rendez-vous · aujourd'hui       │
│        │  [D][L][M][M][J][V][S]      [+ Nouveau]  │
│ ● VIP  ├──────────────────────────────────────────┤
│ ○ Gold │        09:00 │ ✓ Salma · Coupe    30 min │
│ ○ Barb.│        09:30 │                           │
│        │        10:00 │ ▌Nadia Alami       90 min │
│ POSTE  │              │  Coloration               │
│ ●Récep.│        11:00 │ ──●───────────── now ──── │
│ ○Centre│        11:30 │                           │
│ ⏻ Déco.│        12:00 │ + Réserver                │
└────────┴──────────────────────────────────────────┘
  200px                    720px, centred
```

The sidebar is `position: sticky; height: 100dvh` with its own scroll — it
stretched to the full height of the day otherwise, which pushed the poste
switch and the sign-out control a thousand pixels below the fold.

The day column is capped at 720px and centred. A 1600px-wide day is harder
to read, not easier.

**A right rail was specified here and cut.** The month calendar it would have
held duplicates the day strip, and an "arriving next" list restates the top
of the grid. Both are the kind of dashboard furniture §12 rules out.

### Owner (xl)

Three day columns side by side, each headed by its salon name and colour.
Below `xl` they become a swipeable single column with the salon switcher —
the same component the staff view uses.

---

## 9. Motion

Short, few, purposeful.

| Transition | Duration | Easing |
|---|---|---|
| Hover / focus | 120ms | `ease-out` |
| Sheet in | 220ms | `cubic-bezier(.32,.72,0,1)` |
| Sheet out | 160ms | `ease-in` |
| Toast | 180ms | `ease-out` |

Nothing animates on page load. There are no scroll-triggered reveals — this
is a tool someone opens forty times a day, and an entrance animation on the
fortieth is an obstacle.

`prefers-reduced-motion: reduce` collapses every duration to 0.01ms. The
sheet still moves position instantly; it just does not travel.

---

## 10. Accessibility floor

- Every interactive element is a real `button`, `a` or input — never a
  `div` with a handler.
- Focus is always visible: 2px `--brass` at 2px offset, never `outline: none`
  without a replacement.
- Touch targets are 44×44px minimum everywhere.
- The grid is a `role="grid"` with an accessible name naming the date; each
  free slot announces "Réserver le créneau de 14:00".
- Status, which is carried visually by surface treatment, is also carried in
  text for screen readers via a visually-hidden span on each card.
- Live updates announce through an `aria-live="polite"` region so a change
  arriving from another device is not silent.
- Colour is never the sole carrier of meaning: salon colour is always
  accompanied by the salon's name, and booking status by its glyph and
  contrast.
- The interface is French throughout, `lang="fr"`, including error copy.

---

## 11. Writing

Sentence case. Plain verbs. The name of an action does not change between
the button and its result: "Enregistrer" produces "Rendez-vous enregistré."

Errors say what to do next. Not *"Numéro invalide"* alone but *"Numéro
invalide. Format attendu : 06 12 34 56 78 ou +212…"*. An empty day says
*"Aucun rendez-vous. Touchez un créneau pour en ajouter un."* — an
invitation, not a mood.

Nothing is labelled by how it is built. Staff choose **Réception** or
**Centre d'appels**, not `front_desk` / `call_center`.

---

## 12. What was deliberately left out

- **Status badges.** Section 1.
- **Avatar stacks and per-agent attribution.** Bookings are anonymous by
  design (brief §3); there is no one to show.
- **Prices.** Not in the data model and not the front desk's job.
- **A week grid.** Seven columns of half-hours is unreadable below 1024px,
  and the question staff actually ask is always about one day.
- **An icon library.** Ten hand-written SVGs weigh less than the smallest
  package and cannot drift.
- **A success colour.** The booking appearing in the grid is the success
  state.
