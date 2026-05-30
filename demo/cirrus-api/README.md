# Cirrus Weather API

> Fast, accurate weather data for builders. Hourly forecasts, 40-year history, sub-100ms p95.

The Cirrus API is a RESTful weather data service. Point it at a location, get back current conditions, hourly forecasts up to 14 days out, and historical observations going back to 1984.

## Quickstart

Get the current conditions for Reykjavik in one curl:

```bash
curl -H "Authorization: Bearer stratus-key-DEMO-12345" \
  "https://api.cirrus.example.com/v1/current?lat=64.1466&lon=-21.9426"
```

Response:

```json
{
  "location": { "lat": 64.1466, "lon": -21.9426, "name": "Reykjavik, IS" },
  "observed_at": "2026-05-30T14:00:00Z",
  "temperature_c": 8.4,
  "wind_kph": 23.1,
  "wind_direction": "WSW",
  "humidity_pct": 78,
  "conditions": "overcast",
  "pressure_hpa": 1009.3
}
```

Same call from JavaScript:

```javascript
const res = await fetch(
  "https://api.cirrus.example.com/v1/current?lat=64.1466&lon=-21.9426",
  { headers: { Authorization: "Bearer stratus-key-DEMO-12345" } }
);
const current = await res.json();
console.log(`${current.temperature_c}C, ${current.conditions}`);
```

## Where to go next

- [Authentication](./docs/authentication.md) — get your API key and learn the auth flow
- [Endpoints overview](./docs/endpoints/current.md) — the three core endpoints
- [Architecture](./docs/architecture.md) — how requests flow through the system
- [Error reference](./docs/errors.md) — every error code, what it means, and how to recover

## Rate limits

The free tier allows **1,000 requests per day** with a soft cap of **60 requests per minute**. Production keys lift both caps; see the [authentication docs](./docs/authentication.md) for the upgrade path.

## Status

The service status page lives at `https://status.cirrus.example.com`. Subscribe to incident webhooks via the dashboard.
