# Cirrus Dashboard

Component library for the Cirrus weather dashboard. React + Tailwind. Visualizations are SVG-first so they print and embed cleanly.

## Install

```bash
npm install @cirrus/dashboard
```

```typescript
import { ForecastCard, TemperatureGraph, WindRose } from "@cirrus/dashboard";

export function Page({ forecast }) {
  return (
    <>
      <ForecastCard forecast={forecast} />
      <TemperatureGraph data={forecast.hourly} />
      <WindRose data={forecast.hourly} />
    </>
  );
}
```

## What's in the box

- A small, opinionated set of weather-specific components (no chart-library generics)
- Design tokens that map cleanly to Tailwind utilities
- All components render on the server — no client-only hooks in the public API

## Design system

- [Colors](./docs/colors.md) — five-step ramps for primary, neutral, danger, success
- [Typography](./docs/typography.md) — type scale and font stacks

## Components

- [`<ForecastCard>`](./docs/components/forecast-card.md)
- [`<TemperatureGraph>`](./docs/components/temperature-graph.md)
- [`<WindRose>`](./docs/components/wind-rose.md)

## Versioning

Components follow semver. Prop changes that aren't backward-compatible bump the major version. Token changes bump the minor version.
