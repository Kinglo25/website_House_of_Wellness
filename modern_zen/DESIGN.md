---
name: Modern Zen
colors:
  surface: '#fff8f5'
  surface-dim: '#e1d8d4'
  surface-bright: '#fff8f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fbf2ed'
  surface-container: '#f5ece7'
  surface-container-high: '#efe6e2'
  surface-container-highest: '#e9e1dc'
  on-surface: '#1e1b18'
  on-surface-variant: '#434843'
  inverse-surface: '#34302c'
  inverse-on-surface: '#f8efea'
  outline: '#747873'
  outline-variant: '#c4c8c1'
  surface-tint: '#546256'
  primary: '#525f54'
  on-primary: '#ffffff'
  primary-container: '#6a786c'
  on-primary-container: '#f6fff4'
  inverse-primary: '#bccabc'
  secondary: '#5f5e5b'
  on-secondary: '#ffffff'
  secondary-container: '#e5e2dd'
  on-secondary-container: '#656461'
  tertiary: '#755717'
  on-tertiary: '#ffffff'
  tertiary-container: '#90702e'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e6d7'
  primary-fixed-dim: '#bccabc'
  on-primary-fixed: '#121e15'
  on-primary-fixed-variant: '#3d4a3f'
  secondary-fixed: '#e5e2dd'
  secondary-fixed-dim: '#c9c6c2'
  on-secondary-fixed: '#1c1c19'
  on-secondary-fixed-variant: '#474743'
  tertiary-fixed: '#ffdea5'
  tertiary-fixed-dim: '#e9c176'
  on-tertiary-fixed: '#261900'
  on-tertiary-fixed-variant: '#5d4201'
  background: '#fff8f5'
  on-background: '#1e1b18'
  surface-variant: '#e9e1dc'
  sage-deep: '#385539'
  sand-darker: '#E8E2D7'
  charcoal-muted: '#3C3924'
typography:
  display-lg:
    fontFamily: Playfair Display
    fontSize: 64px
    fontWeight: '500'
    lineHeight: 72px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Playfair Display
    fontSize: 48px
    fontWeight: '400'
    lineHeight: 56px
  headline-lg-mobile:
    fontFamily: Playfair Display
    fontSize: 32px
    fontWeight: '400'
    lineHeight: 40px
  headline-md:
    fontFamily: Playfair Display
    fontSize: 32px
    fontWeight: '400'
    lineHeight: 40px
  body-lg:
    fontFamily: Montserrat
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: 0.01em
  body-md:
    fontFamily: Montserrat
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Montserrat
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Montserrat
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.03em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1280px
  gutter: 32px
  margin-mobile: 20px
  margin-desktop: 64px
  section-gap: 120px
---

## Brand & Style

The brand personality is grounded, restorative, and sophisticated. It targets a discerning clientele in Brussels seeking an escape from urban stressors. The UI evokes a "Deep Breath" through a **Minimalist** and **Tactile** design style. 

Key visual principles:
- **Quiet Luxury:** High-end appeal through restraint rather than excess.
- **Organic Precision:** A blend of natural colors and precise, structured layouts.
- **Atmospheric Clarity:** Utilizing generous whitespace to simulate the physical openness of a high-end spa.
- **Sensory Focus:** Imagery should feature macro photography of natural textures (linen, stone, botanical elements) and soft-focus wellness environments.

## Colors

The palette is derived from natural, earthy elements found in traditional wellness retreats. 

- **Sage Green (Primary):** Used for key actions and brand markers to signify growth and tranquility.
- **Soft Sand (Secondary/Background):** The primary canvas color, replacing pure white to reduce eye strain and provide a warmer, premium feel.
- **Warm Charcoal (Neutral):** Used for typography and deep structural elements to ensure readability without the harshness of true black.
- **Muted Gold (Accent):** Reserved for subtle highlights, such as active states or high-end service indicators, conveying prestige.

## Typography

The typography system creates a rhythmic contrast between traditional elegance and modern clarity. 

**Playfair Display** is used for headlines to establish a sense of history and craftsmanship. Use "Medium" weights for large display text to maintain presence against photography.

**Montserrat** provides a functional, airy companion for body text. To maintain the "Zen" aesthetic, utilize increased line-height (1.5x - 1.6x) and subtle letter spacing for labels to prevent the UI from feeling cramped.

## Layout & Spacing

This design system uses a **Fixed Grid** approach for desktop to control the composition tightly, transitioning to a fluid model for mobile.

- **Rhythm:** An 8px base unit drives all spacing.
- **Breathability:** Section vertical spacing is intentionally oversized (120px+) to ensure the user never feels overwhelmed by information density.
- **Composition:** Align text content to a 12-column grid. For editorial layouts, use offset columns (e.g., text occupying columns 2-7) to create a sophisticated, asymmetrical balance.

## Elevation & Depth

Hierarchy is achieved through **Tonal Layers** and **Ambient Shadows** rather than stark borders.

- **Surfaces:** Use the Secondary color (Sand) as the base, with white (#FFFFFF) elevated surfaces for cards or modal content.
- **Shadows:** Shadows are extremely soft and tinted with the Primary color (Sage) or Neutral color (Charcoal) at very low opacity (5-8%). They should feel like "natural light" casting a soft glow rather than a digital effect.
- **Glassmorphism:** Use sparingly for navigation overlays or floating action panels, with a high blur (20px+) and a Sand-tinted background.

## Shapes

The shape language is organic yet controlled. 

- **Corners:** Components utilize a consistent 8px (standard) to 16px (large cards) radius. This "Soft" to "Rounded" approach mimics smoothed river stones.
- **Images:** Photography should use the `rounded-xl` (24px) token or, in specific editorial sections, a "leaf" radius where two opposite corners are rounded and two remain sharp.

## Components

### Buttons
- **Primary:** Sage Green background with white text. Pill-shaped or Rounded (8px). No heavy gradients; use a subtle 1px inset highlight for a tactile feel.
- **Secondary:** Outlined in Charcoal with a 1px stroke. Transparent background.
- **Ghost:** Charcoal text with the Gold accent color used only for the hover state underline.

### Cards
- Cards use a white background against the Sand page background.
- Padding should be generous (min 32px).
- Incorporate a subtle 1px border in `sand-darker` to define edges without adding visual weight.

### Input Fields
- Underline-style inputs or softly rounded containers (4px).
- Focus state uses a Sage Green border and a soft glow.
- Labels use the `label-md` token for high legibility and a professional tone.

### Chips & Tags
- Used for massage types (e.g., "Deep Tissue", "Swedish").
- Low-saturation Sage background with deep Sage text.
- Full pill-shape (32px radius).

### Lists
- Use custom iconography (minimalist botanical line art) instead of standard bullets.
- Vertical spacing between list items should be at least 16px.