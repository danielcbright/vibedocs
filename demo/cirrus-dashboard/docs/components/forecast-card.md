# `<ForecastCard>`

Compact daily-forecast card. Shows high/low, an icon, and a precipitation bar.

## Import

```typescript
import { ForecastCard } from "@cirrus/dashboard";
```

## Example

```typescript
<ForecastCard
  date="2026-05-30"
  tempMinC={12.4}
  tempMaxC={19.1}
  conditions="partly_cloudy"
  precipMm={2.8}
  precipProbability={0.4}
/>
```

## Props

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `date` | `string` (YYYY-MM-DD) | yes | — | Date for the forecast |
| `tempMinC` | `number` | yes | — | Daily minimum, Celsius |
| `tempMaxC` | `number` | yes | — | Daily maximum, Celsius |
| `conditions` | `ConditionsCode` | yes | — | One of the canonical condition labels |
| `precipMm` | `number` | no | `0` | Expected precipitation in mm |
| `precipProbability` | `number` | no | `0` | 0-1, drives the bar opacity |
| `units` | `"metric" \| "imperial"` | no | `"metric"` | Display units; conversion is internal |
| `compact` | `boolean` | no | `false` | Half-height variant for sidebar |
| `onClick` | `() => void` | no | — | Optional click handler |

## Variants

```typescript
<ForecastCard compact date="2026-05-30" tempMinC={12} tempMaxC={19} conditions="rain" />
```

The compact variant is half-height and drops the precipitation bar. Use it in sidebars.

## Accessibility

- Renders as a `<button>` when `onClick` is set, otherwise a `<div>`
- Icon has `aria-label` mirroring `conditions`
- Temperature numbers use `font-variant-numeric: tabular-nums` so columns align

## See also

- [`<TemperatureGraph>`](./temperature-graph.md)
- [`<WindRose>`](./wind-rose.md)
