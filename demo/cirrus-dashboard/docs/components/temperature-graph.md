# `<TemperatureGraph>`

SVG line chart for hourly temperature. No client-side chart library — renders to SVG on the server.

## Import

```typescript
import { TemperatureGraph } from "@cirrus/dashboard";
```

## Example

```typescript
<TemperatureGraph
  data={forecast.hourly}
  width={480}
  height={160}
  showFeelsLike
/>
```

## Props

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `data` | `HourlyEntry[]` | yes | — | Array of hourly observations or forecasts |
| `width` | `number` | no | `480` | SVG width in pixels |
| `height` | `number` | no | `160` | SVG height in pixels |
| `showFeelsLike` | `boolean` | no | `false` | Render a secondary dashed line for feels-like |
| `showGrid` | `boolean` | no | `true` | Show horizontal gridlines |
| `units` | `"metric" \| "imperial"` | no | `"metric"` | Display units |
| `tooltip` | `boolean` | no | `true` | Enable hover tooltips |

## Data shape

```typescript
type HourlyEntry = {
  time: string;             // ISO 8601
  temperatureC: number;
  feelsLikeC?: number;
};
```

## Styling

The graph reads color tokens from CSS variables:

- `--primary-500` for the main line
- `--neutral-300` for grid
- `--neutral-500` for axis labels

Override per-instance via the `style` prop:

```typescript
<TemperatureGraph
  data={data}
  style={{ "--primary-500": "#f97316" } as React.CSSProperties}
/>
```

## Accessibility

- Renders an `<svg role="img" aria-label="...">` with a generated label describing min/max
- Per-point markers have `<title>` children so screen readers can announce values
- Falls back to a `<table>` summary when `prefers-reduced-motion` is set

## See also

- [`<ForecastCard>`](./forecast-card.md)
- [`<WindRose>`](./wind-rose.md)
