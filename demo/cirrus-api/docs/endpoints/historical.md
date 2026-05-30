# `GET /v1/historical`

Returns observed weather data from any date between **1984-01-01** and **yesterday**. Data is back-filled from station archives and reanalysis models.

## Path

```
GET https://api.cirrus.example.com/v1/historical
```

## Query parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `lat` | float | yes | Latitude in decimal degrees |
| `lon` | float | yes | Longitude in decimal degrees |
| `from` | string (YYYY-MM-DD) | yes | Start date, inclusive |
| `to` | string (YYYY-MM-DD) | yes | End date, inclusive. Max span 366 days per request. |
| `resolution` | string | no | `hourly` (default) or `daily` |
| `units` | string | no | `metric` (default) or `imperial` |

## Example

```bash
curl -H "Authorization: Bearer stratus-key-DEMO-12345" \
  "https://api.cirrus.example.com/v1/historical?lat=40.7128&lon=-74.0060&from=2025-12-25&to=2025-12-26&resolution=daily"
```

```json
{
  "location": { "lat": 40.7128, "lon": -74.0060, "name": "New York, US" },
  "resolution": "daily",
  "data": [
    {
      "date": "2025-12-25",
      "temp_min_c": -3.2,
      "temp_max_c": 4.1,
      "precip_mm": 0.0,
      "snowfall_cm": 0.0,
      "wind_max_kph": 27.8,
      "source": "station-KNYC"
    },
    {
      "date": "2025-12-26",
      "temp_min_c": -1.0,
      "temp_max_c": 6.4,
      "precip_mm": 3.2,
      "snowfall_cm": 0.0,
      "wind_max_kph": 18.4,
      "source": "station-KNYC"
    }
  ]
}
```

## Pagination

For spans > 366 days, paginate with multiple requests. The API does not chunk on its own.

## Errors

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `invalid_date_range` | `from` after `to`, or `to` in the future |
| 400 | `range_too_large` | Span exceeds 366 days |
| 404 | `no_data` | No archive data for this location at this date |
| 429 | `quota_exceeded` | Daily or per-minute cap exceeded |

See [Error reference](../errors.md).

## See also

- [`/v1/current`](./current.md)
- [`/v1/forecast`](./forecast.md)
