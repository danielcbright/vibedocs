# `<WindRose>`

Polar wind-rose diagram. Aggregates wind direction and speed into 16 cardinal bins.

## Import

```typescript
import { WindRose } from "@cirrus/dashboard";
```

## Example

```typescript
<WindRose
  data={hourly}
  bins={16}
  size={240}
  legend
/>
```

## Props

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `data` | `WindEntry[]` | yes | — | Wind observations to aggregate |
| `bins` | `8 \| 16 \| 32` | no | `16` | Number of cardinal bins |
| `size` | `number` | no | `240` | Diameter in pixels |
| `legend` | `boolean` | no | `true` | Show wind-speed legend |
| `units` | `"metric" \| "imperial"` | no | `"metric"` | Display units |
| `palette` | `"primary" \| "neutral"` | no | `"primary"` | Color ramp for speed buckets |

## Data shape

```typescript
type WindEntry = {
  time: string;             // ISO 8601
  windKph: number;          // sustained speed
  windDirection: string;    // "N", "NNE", ..., "NNW"
};
```

## Aggregation

Direction is binned to the nearest of `bins` cardinal directions. Within each direction bin, speed is bucketed (calm < 5, light 5-15, moderate 15-30, strong 30-50, gale 50+ kph). Bin radius scales with the count; bucket color scales with speed.

## Accessibility

- Renders an `<svg role="img" aria-label="...">` with a generated label naming the dominant direction
- Below the SVG, an `<table>` summarizes the same data for screen readers (toggleable via `tableSummary={false}`)

## See also

- [`<ForecastCard>`](./forecast-card.md)
- [`<TemperatureGraph>`](./temperature-graph.md)
