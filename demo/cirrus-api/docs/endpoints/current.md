# `GET /v1/current`

Returns current observed conditions at a single point. Data is aggregated from the nearest three weather stations and refreshed every 5 minutes.

## Path

```
GET https://api.cirrus.example.com/v1/current
```

## Query parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `lat` | float | yes | Latitude in decimal degrees, range -90 to 90 |
| `lon` | float | yes | Longitude in decimal degrees, range -180 to 180 |
| `units` | string | no | `metric` (default) or `imperial` |
| `lang` | string | no | ISO 639-1 code for `conditions` label; defaults to `en` |

## Response

```json
{
  "location": {
    "lat": 64.1466,
    "lon": -21.9426,
    "name": "Reykjavik, IS",
    "elevation_m": 12
  },
  "observed_at": "2026-05-30T14:00:00Z",
  "temperature_c": 8.4,
  "feels_like_c": 5.1,
  "wind_kph": 23.1,
  "wind_direction": "WSW",
  "wind_gust_kph": 41.7,
  "humidity_pct": 78,
  "conditions": "overcast",
  "conditions_code": 803,
  "pressure_hpa": 1009.3,
  "visibility_km": 14.0,
  "uv_index": 2,
  "stations": ["BIRK", "BIKF", "BIIS"]
}
```

## Examples

### bash

```bash
curl -H "Authorization: Bearer stratus-key-DEMO-12345" \
  "https://api.cirrus.example.com/v1/current?lat=37.7749&lon=-122.4194&units=imperial"
```

### JavaScript

```javascript
const res = await fetch(
  "https://api.cirrus.example.com/v1/current?lat=37.7749&lon=-122.4194",
  { headers: { Authorization: "Bearer stratus-key-DEMO-12345" } }
);
const { temperature_c, conditions } = await res.json();
console.log(`San Francisco: ${temperature_c}C, ${conditions}`);
```

### Python

```python
import requests

res = requests.get(
    "https://api.cirrus.example.com/v1/current",
    params={"lat": 37.7749, "lon": -122.4194},
    headers={"Authorization": "Bearer stratus-key-DEMO-12345"},
)
print(res.json()["temperature_c"])
```

## Errors

See [errors](../errors.md). Most common for this endpoint:

- `400 invalid_coordinates` — `lat` or `lon` outside valid range
- `429 quota_exceeded` — you hit your per-minute cap; retry after the `Retry-After` header
- `503 station_offline` — all three nearest stations are reporting stale; we fall back to model data and set `degraded: true`

## See also

- [`/v1/forecast`](./forecast.md)
- [`/v1/historical`](./historical.md)
