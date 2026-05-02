# House Track Design System

A minimalistic operator console design language optimized for density, scannability, and operational clarity.

## Design Principles

- **Dense over decorative** — Maximize information density for power users
- **Monochrome with accent** — Neutral foundation (grays, blacks, whites) with one accent color for interactive state
- **Typography for hierarchy** — Consistent scale guides the eye through content
- **Spacing for breathing room** — Geometric scale (0.5, 1, 1.5, 2, 3 rem) keeps layouts clean
- **Status at a glance** — Color and badges communicate state quickly
- **Mono numerals** — Tabular numbers align columns for easy scanning

## Typography

| Level | Font Size | Line Height | Usage                        |
| ----- | --------- | ----------- | ---------------------------- |
| XS    | 0.75rem   | 1rem        | UI labels, badges, hints     |
| SM    | 0.875rem  | 1.25rem     | Body text, table cells       |
| Base  | 1rem      | 1.5rem      | Form inputs, default text    |
| LG    | 1.125rem  | 1.75rem     | Card titles, section headers |
| XL    | 1.5rem    | 2rem        | Page titles                  |

All text uses the system font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

## Color Palette

### Neutral Scale

- `neutral-50`: #f9fafb (lightest background)
- `neutral-100`: #f3f4f6 (light bg, hover)
- `neutral-200`: #e5e7eb (borders, dividers)
- `neutral-400`: #9ca3af (secondary text)
- `neutral-600`: #4b5563 (primary text)
- `neutral-900`: #111827 (text, buttons)
- `white`: #ffffff (cards, primary bg)
- `black`: #000000 (nav active, strong emphasis)

### Accent Color

- `accent`: #059669 (teal-600) — interactive elements, success states
- `accent-light`: #d1fae5 (teal-100) — subtle backgrounds, hover
- `accent-dark`: #047857 (teal-700) — active, focus

### Semantic Colors

- `error`: #dc2626 (red-600) — errors, destructive actions, failed states
- `warning`: #f59e0b (amber-500) — warnings, running/pending states
- `success`: #16a34a (green-600) — success, healthy states

## Spacing Scale

Consistent geometric scale for margins, padding, and gaps:

- `spacing-0.5`: 0.125rem (2px)
- `spacing-1`: 0.25rem (4px)
- `spacing-2`: 0.5rem (8px)
- `spacing-3`: 0.75rem (12px)
- `spacing-4`: 1rem (16px)
- `spacing-6`: 1.5rem (24px)
- `spacing-8`: 2rem (32px)
- `spacing-12`: 3rem (48px)

**Usage:**

- Gaps between major sections: `spacing-6` or `spacing-8`
- Card padding: `spacing-6`
- Form field margin-bottom: `spacing-4`
- Table row height: `spacing-8` (compact density)
- Navigation item padding: `spacing-3`

## Component Density

### Tables

- Row height: 2.5rem (40px) including padding
- Cell padding: 0.75rem (12px) vertical, 1rem (16px) horizontal
- Header row uses black text on neutral-100 background
- Zebra striping omitted in favor of row separators

### Forms

- Input height: 2.5rem (40px)
- Input padding: 0.5rem (8px) horizontal, 0.625rem (10px) vertical
- Label margin-bottom: 0.5rem (8px)
- Section gap: 1.5rem (24px)

### Cards

- Padding: 1.5rem (24px)
- Border: 1px solid neutral-200
- Border-radius: 0.5rem (8px)
- Background: white with subtle shadow

### Navigation

- Sidebar width: 16rem (256px)
- Item padding: 0.75rem (12px) × 1rem (16px)
- Active item: black background, white text
- Inactive item: transparent background, neutral-700 text
- Hover state: neutral-100 background

## Status Indicators

Status is communicated via **inline badges** and **colors**:

| State   | Foreground  | Background  | Badge Example |
| ------- | ----------- | ----------- | ------------- |
| Success | green-600   | green-50    | ✓ Success     |
| Error   | red-600     | red-50      | ✗ Error       |
| Warning | amber-600   | amber-50    | ⚠ Running     |
| Default | neutral-600 | neutral-100 | Info          |

Badges use:

- `padding: 0.25rem 0.75rem` (4px × 12px)
- `border-radius: 9999px` (pill shape)
- `font-size: 0.75rem`
- `font-weight: 600`

## Interactive Elements

### Buttons

- **Primary (default)**: black background, white text, minimal shadows
- **Secondary**: neutral-200 background, black text, for less-critical actions
- **Destructive**: red-600 background, white text, with confirmation UI
- **Ghost**: transparent background, neutral-700 text, minimal visual weight
- Padding: `0.5rem 1rem` (sm), `0.75rem 1.5rem` (md), `1rem 2rem` (lg)
- Hover: slight background shift, no scale transform (respects operator focus)
- Focus: `ring-2 ring-offset-2` for keyboard accessibility

### Inputs

- Border: 1px solid neutral-200
- Background: white
- Focus: accent color ring (ring-2 with offset)
- Placeholder text: neutral-400
- Padding: `0.5rem 0.75rem` (8px × 12px)

## States & Responsive

### Empty States

- Center-aligned icon (if any) above message
- Message in neutral-600, size base
- Subtext in neutral-400, size sm

### Error States

- Red-tinted background or border
- Clear error message in red-600
- Optional recovery action in a button

### Loading States

- Spinner icon (can be SVG or CSS animation)
- "Loading..." text in neutral-600, size sm
- Placed in content area where data will appear

## Implementation

CSS variables are defined in `:root` for easy theming:

```css
:root {
  --neutral-50: #f9fafb;
  --neutral-100: #f3f4f6;
  --neutral-200: #e5e7eb;
  --neutral-400: #9ca3af;
  --neutral-600: #4b5563;
  --neutral-900: #111827;
  --accent-light: #d1fae5;
  --accent: #059669;
  --accent-dark: #047857;
  --error: #dc2626;
  --warning: #f59e0b;
  --success: #16a34a;
}
```

Tailwind config extends these variables for use in classes like `bg-[--accent]`, `text-[--neutral-900]`.

## Examples

**Page Title + Section**

```tsx
<h1 className="text-xl font-bold text-neutral-900">Listings</h1>
<Card className="mt-6">
  <h2 className="text-lg font-semibold text-neutral-900 mb-4">Active Listings</h2>
  ...
</Card>
```

**Form Field**

```tsx
<div className="mb-4">
  <label className="block text-sm font-medium text-neutral-900 mb-2">Max Price (EUR)</label>
  <Input placeholder="Enter max price..." />
</div>
```

**Status Badge**

```tsx
<Badge variant="success" className="text-xs font-semibold">
  ✓ Healthy
</Badge>
```

**Table with Density**

```tsx
<Table>
  <TableHead>
    <TableRow className="bg-neutral-100 border-b border-neutral-200">
      <TableHeader className="text-left text-sm font-semibold text-neutral-900">Title</TableHeader>
      <TableHeader className="text-right text-sm font-semibold text-neutral-900">Price</TableHeader>
    </TableRow>
  </TableHead>
  <TableBody>
    {data.map((row) => (
      <TableRow className="border-b border-neutral-200 hover:bg-neutral-50">
        <TableCell className="py-3 px-4 text-sm">{row.title}</TableCell>
        <TableCell className="py-3 px-4 text-sm text-right">{row.price}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```
