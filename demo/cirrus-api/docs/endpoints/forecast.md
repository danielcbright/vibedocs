# `GET /v1/forecast`

Returns hourly and daily forecasts for a single point. Hourly resolution goes out to 168 hours (7 days). Daily resolution goes out to 14 days. Confidence intervals widen with time horizon.

## Path Parameters

The endpoint takes no path parameters. Pass everything as query string.

## Query Parameters

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `lat` | float | yes | — | Latitude in decimal degrees |
| `lon` | float | yes | — | Longitude in decimal degrees |
| `hours` | int | no | `48` | Hours of hourly forecast to return (1-168) |
| `days` | int | no | `7` | Days of daily forecast to return (1-14) |
| `units` | string | no | `metric` | `metric` or `imperial` |
| `include` | string | no | `hourly,daily` | Comma-separated: `hourly`, `daily`, `alerts` |
| `lang` | string | no | `en` | ISO 639-1 code for condition labels |

## Response Schema

| Field | Type | Description |
|---|---|---|
| `location` | object | Resolved location metadata |
| `generated_at` | string (ISO 8601) | When this forecast was computed |
| `model` | string | Forecast model identifier (e.g. `cirrus-mesh-v3`) |
| `hourly` | array | Hourly entries, length = `hours` parameter |
| `hourly[].time` | string (ISO 8601) | Start of the hour |
| `hourly[].temperature_c` | number | Temperature at hour start |
| `hourly[].precip_mm` | number | Total precipitation for the hour |
| `hourly[].precip_probability` | number | 0.0 to 1.0 |
| `hourly[].wind_kph` | number | Sustained wind |
| `hourly[].conditions` | string | Short label, e.g. `light_rain` |
| `daily` | array | Daily entries, length = `days` parameter |
| `daily[].date` | string (YYYY-MM-DD) | Local date |
| `daily[].temp_min_c` | number | Daily minimum |
| `daily[].temp_max_c` | number | Daily maximum |
| `daily[].sunrise` | string (ISO 8601) | Local sunrise |
| `daily[].sunset` | string (ISO 8601) | Local sunset |
| `daily[].precip_mm` | number | Total daily precipitation |
| `alerts` | array | Optional active weather alerts (severe weather, frost, etc.) |

## Example Responses

### Minimal request

```bash
curl -H "Authorization: Bearer stratus-key-DEMO-12345" \
  "https://api.cirrus.example.com/v1/forecast?lat=51.5074&lon=-0.1278&hours=3&days=2"
```

```json
{
  "location": { "lat": 51.5074, "lon": -0.1278, "name": "London, UK" },
  "generated_at": "2026-05-30T14:00:00Z",
  "model": "cirrus-mesh-v3",
  "hourly": [
    {
      "time": "2026-05-30T14:00:00Z",
      "temperature_c": 17.2,
      "precip_mm": 0.0,
      "precip_probability": 0.05,
      "wind_kph": 14.3,
      "conditions": "partly_cloudy"
    },
    {
      "time": "2026-05-30T15:00:00Z",
      "temperature_c": 17.6,
      "precip_mm": 0.2,
      "precip_probability": 0.18,
      "wind_kph": 15.9,
      "conditions": "light_rain"
    },
    {
      "time": "2026-05-30T16:00:00Z",
      "temperature_c": 17.1,
      "precip_mm": 0.4,
      "precip_probability": 0.32,
      "wind_kph": 16.8,
      "conditions": "light_rain"
    }
  ],
  "daily": [
    {
      "date": "2026-05-30",
      "temp_min_c": 12.4,
      "temp_max_c": 19.1,
      "sunrise": "2026-05-30T03:51:00Z",
      "sunset": "2026-05-30T20:13:00Z",
      "precip_mm": 2.8
    },
    {
      "date": "2026-05-31",
      "temp_min_c": 11.9,
      "temp_max_c": 18.0,
      "sunrise": "2026-05-31T03:50:00Z",
      "sunset": "2026-05-31T20:14:00Z",
      "precip_mm": 0.0
    }
  ]
}
```

### With alerts

```bash
curl -H "Authorization: Bearer stratus-key-DEMO-12345" \
  "https://api.cirrus.example.com/v1/forecast?lat=29.7604&lon=-95.3698&include=hourly,daily,alerts"
```

```json
{
  "alerts": [
    {
      "id": "alert-92831",
      "severity": "moderate",
      "type": "wind_advisory",
      "headline": "Wind Advisory until 2026-05-30 22:00 UTC",
      "starts_at": "2026-05-30T18:00:00Z",
      "ends_at": "2026-05-30T22:00:00Z"
    }
  ]
}
```

## Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `invalid_coordinates` | `lat`/`lon` outside valid range |
| 400 | `invalid_range` | `hours` > 168 or `days` > 14 |
| 401 | `missing_token` | Authorization header missing |
| 403 | `tier_restricted` | Free tier requested > 24 hours |
| 429 | `quota_exceeded` | Daily or per-minute cap exceeded |
| 503 | `model_unavailable` | Forecast model is updating; retry in 30s |

See [Error reference](../errors.md) for the full table.

## See also

- [`/v1/current`](./current.md) — single observation
- [`/v1/historical`](./historical.md) — past observations
- [Authentication](../authentication.md)
