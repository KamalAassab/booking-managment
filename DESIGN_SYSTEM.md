# L'Atelier Groupe — Design System & Brand Identity

> **Version:** 2.0.0  
> **Brand:** L'Atelier Groupe (Beauty Lounge & Spa — Casablanca)  
> **Aesthetic Philosophy:** *Anti-Slop Luxury Editorial* — Parisian Haute Coiffure meets contemporary Moroccan hospitality. Refined, functional, tactile, and strictly mobile-responsive.

---

## 1. Brand Essence & Design Direction

### Positioning
L'Atelier Groupe operates three flagship locations in Casablanca:
1. **L'Atelier VIP** — High-end women's beauty lounge & bespoke styling.
2. **L'Atelier Gold** — Prestige hair care, coloring, and aesthetics.
3. **L'Atelier Barber Shop & Spa** — Luxury gentlemen's grooming and spa therapy.

### Aesthetic Dials
- **`DESIGN_VARIANCE: 6`** — Classical geometric alignment punctuated by luxury editorial typography.
- **`MOTION_INTENSITY: 4`** — Swift, purposeful micro-transitions (120ms – 200ms ease-out) with zero cognitive friction.
- **`VISUAL_DENSITY: 4`** — Clean breathing room designed for fast front-desk operation during peak phone and reception hours.

---

## 2. Color Palette & Design Tokens

### Core Neutral Surfaces
```css
--paper: #F7F4EF;          /* Warm French Alabaster / Champagne Linen background */
--surface: #FFFFFF;        /* Pure Crisp Surface for Cards & Modals */
--surface-sunk: #EFE9DF;   /* Tactile inset backgrounds for pills & rails */
--line: #E5DDD2;           /* Hairline borders between cells and sections */
--line-strong: #C8BEB2;    /* High-contrast field borders & dividers */
```

### Typography Ink Scale
```css
--ink: #171412;            /* Deep Espresso Noir — Primary text & headings */
--ink-soft: #6E6258;       /* Warm Taupe Slate — Secondary labels, dates, details */
--ink-faint: #9E9187;      /* Muted Sand — Placeholders, icons, micro-captions */
```

### Signature Brand Accents (Haute Coiffure Gold & Noir)
```css
--accent: #C59B27;         /* Imperial Casablanca Gold — Primary action & brand highlight */
--accent-hover: #A0781D;   /* Burnished Bronze — Hover & active states */
--accent-tint: #FAF4E8;    /* Soft Champagne Silk — Selected slots, active badges */
--accent-glow: rgba(197, 155, 39, 0.18); /* Ambient golden warmth */

--noir-sidebar: #09090B;   /* Pure Obsidian Noir — Desktop sidebar background */
--noir-border: rgba(255, 255, 255, 0.10); /* Subtle glass dividers on dark */
```

### Semantic Status Colors
```css
--status-done: #059669;       /* Emerald — Completed appointments */
--status-done-bg: #ECFDF5;
--status-confirmed: #C59B27;  /* Imperial Gold — Upcoming confirmed */
--status-confirmed-bg: #FAF4E8;
--status-cancelled: #E11D48;  /* Rose Madder — Cancelled */
--status-cancelled-bg: #FFF1F2;
```

### Salon Signature Identifiers
```css
--salon-vip: #8E44AD;      /* Amethyst Purple */
--salon-gold: #C59B27;     /* Pure Gold */
--salon-barber: #0E7490;   /* Deep Aegean Teal */
```

---

## 3. Typography & Hierarchy

### Font Families
- **Display Headings:** `"Bricolage Grotesque"`, `Georgia`, ui-serif, sans-serif.
- **Interface & Body:** `"Instrument Sans"`, `-apple-system`, `"Segoe UI"`, Roboto, sans-serif.
- **Tabular Numerals:** `font-variant-numeric: tabular-nums` (applied to all times, dates, durations, and prices for instant optical alignment).

### Type Scale
| Token | Size | Line Height | Weight | Letter Spacing | Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `t-display` | 26px / 30px | 32px / 36px | 600 | `-0.02em` | Page titles, Primary hero banners |
| `t-title` | 18px / 20px | 24px / 26px | 600 | `-0.01em` | Modal titles, Section headers |
| `t-heading` | 15px / 16px | 20px / 22px | 600 | `0` | Card titles, Client names |
| `body` | 14px / 15px | 20px / 22px | 400 / 500 | `0` | General text, form entries |
| `t-small` | 12px / 13px | 16px / 18px | 400 / 500 | `0` | Subtitles, meta information |
| `t-micro` | 10.5px / 11px | 14px | 600 | `0.08em` | Uppercase category tags, badges |

---

## 4. Elevation, Radius & Shadows

### Border Radius
```css
--radius-sm: 8px;   /* Small pills, tooltips, sub-controls */
--radius-md: 12px;  /* Inputs, buttons, dropdown popovers */
--radius-lg: 16px;  /* Main cards, table containers */
--radius-xl: 22px;  /* Modals, bottom sheets */
--radius-full: 9999px; /* Pill buttons, status tags */
```

### Layered Shadows
```css
--shadow-card: 0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.03);
--shadow-dropdown: 0 10px 30px -5px rgba(0, 0, 0, 0.15), 0 4px 12px -2px rgba(0, 0, 0, 0.08);
--shadow-sheet: 0 -8px 32px rgba(0, 0, 0, 0.16);
```

---

## 5. UI Component Specifications

### 1. Buttons
- **Primary:** Warm Imperial Gold background (`#C59B27`), white text, crisp 12px radius, subtle active scale `active:scale-[0.98]`.
- **Secondary / Sunk:** Translucent surface tint (`--surface-sunk`), warm taupe border, smooth hover lightening.
- **Quiet / Ghost:** Minimal border, transparent background, ideal for secondary table actions.
- **Danger:** Rose tint background with deep red label for cancellation/deletion.

### 2. Form Fields & Inputs
- Minimum height: `44px` (prevents iOS auto-zoom on focus by enforcing ≥16px font on mobile).
- Border: `1px solid var(--line-strong)`.
- Focus State: Gold highlight `border-color: var(--accent)` + `box-shadow: 0 0 0 3px var(--accent-tint)`.

### 3. Autocomplete Client Combobox
- **Desktop:** Floating shadow popover, keyboard navigation (`↑`/`↓`/`Enter`), highlight match, frequency badge (`X rdv`), direct phone auto-fill.
- **Mobile:** Native device `<datalist>` connected directly to OS keyboard suggestion accessory bar.

### 4. Day Calendar Split Table
- **Stacked Architecture:** 2 independent synchronized tables:
  1. *Matinée & Début d'après-midi* (Solar badge `09:00 — 14:30`)
  2. *Après-midi & Soirée* (Lunar badge `14:30 — 20:00 / 21:00`)
- **Booking Blocks:** 12px radius, gold accent top stripe, client initials, service name, duration badge, one-tap WhatsApp launcher.

### 5. Obsidian Sidebar
- Black `#09090B` background with metallic gold brand logo.
- High-contrast zinc navigation icons and vertical salon indicators.
- Smooth collapse toggle (220px expanded ↔ 72px compact).

---

## 6. Strict Mobile & Touch UX Guidelines

1. **44px Minimum Touch Targets** across all interactive elements (buttons, slots, tabs).
2. **Horizontal Overflow Isolation** using CSS `.no-scrollbar` with smooth touch momentum (`-webkit-overflow-scrolling: touch`).
3. **Safe-Area Insets** on iPhone home-indicators (`env(safe-area-inset-bottom)`).
4. **Bottom Sheet Pattern on Mobile** transitioning to centered dialog on desktop screens.
