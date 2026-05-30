# TypeScript SDK

`@cirrus/sdk` is the official TypeScript client. Works in Node 18+ and modern browsers (with a proxied API key — never ship a raw key to the browser).

## Install

```bash
npm install @cirrus/sdk
```

## Client

```typescript
import { CirrusClient, type CurrentResponse } from "@cirrus/sdk";

const client = new CirrusClient({
  apiKey: process.env.CIRRUS_KEY!,
  units: "metric",                        // default
  timeoutMs: 10_000,                      // default
  retry: { attempts: 3, baseDelayMs: 500 },
});
```

## Current conditions

```typescript
const current: CurrentResponse = await client.current({
  lat: 64.1466,
  lon: -21.9426,
});

console.log(current.temperatureC);        // 8.4
console.log(current.conditions);          // "overcast"
console.log(current.wind.kph);            // 23.1
```

## Forecast

```typescript
const forecast = await client.forecast({
  lat: 51.5074,
  lon: -0.1278,
  hours: 24,
  days: 7,
});

for (const hour of forecast.hourly) {
  console.log(`${hour.time.toISOString()}: ${hour.temperatureC}C`);
}
```

`hour.time` is a real `Date`, not a string. All ISO 8601 timestamps in API responses are parsed for you.

## Historical

```typescript
const history = await client.historical({
  lat: 40.7128,
  lon: -74.0060,
  from: new Date("2025-12-25"),
  to: new Date("2025-12-26"),
  resolution: "daily",
});
```

## Errors

Every error thrown by the SDK is a `CirrusError` subclass:

```typescript
import { CirrusError, RateLimitError } from "@cirrus/sdk";

try {
  await client.current({ lat: 0, lon: 0 });
} catch (err) {
  if (err instanceof RateLimitError) {
    console.log(`Wait ${err.retryAfterSeconds}s before retrying`);
  } else if (err instanceof CirrusError) {
    console.log(`Cirrus ${err.code}: ${err.message} (req ${err.requestId})`);
  } else {
    throw err;
  }
}
```

## Type exports

Every response shape is exported. Use them in your own types:

```typescript
import type {
  CurrentResponse,
  ForecastResponse,
  HistoricalResponse,
  WeatherAlert,
} from "@cirrus/sdk";
```

## See also

- [Python SDK](./python.md)
- [Go SDK](./go.md)
- [Quickstart](./quickstart.md)
