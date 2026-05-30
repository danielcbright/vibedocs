# Error reference

Every Cirrus error returns a JSON body with a stable `code` field and a human-readable `message`. Some errors include a `Retry-After` header (in seconds) — when present, treat it as authoritative.

## Error envelope

```json
{
  "error": {
    "code": "quota_exceeded",
    "message": "You have exceeded your per-minute cap of 60 requests.",
    "request_id": "req_01HQYZ8R7K"
  }
}
```

Include `request_id` in any support ticket; it lets us pull the full log line.

## All error codes

| Code | HTTP | Meaning | Retry-After? |
|---|---|---|---|
| `missing_token` | 401 | No `Authorization` header | — |
| `invalid_token` | 401 | Token is malformed or revoked | — |
| `expired_token` | 401 | Demo key past expiration | — |
| `forbidden_origin` | 403 | Origin not in your CORS allowlist | — |
| `tier_restricted` | 403 | Your tier cannot access this endpoint or window | — |
| `invalid_coordinates` | 400 | `lat`/`lon` outside valid range | — |
| `invalid_date_range` | 400 | `from` after `to`, or `to` in the future | — |
| `range_too_large` | 400 | Historical span > 366 days | — |
| `invalid_range` | 400 | Forecast `hours` > 168 or `days` > 14 | — |
| `unsupported_units` | 400 | `units` not in `metric`/`imperial` | — |
| `unsupported_language` | 400 | `lang` not in supported set | — |
| `no_data` | 404 | No archive data for this location/date | — |
| `quota_exceeded` | 429 | Per-minute or daily quota hit | yes (seconds) |
| `concurrent_limit` | 429 | Too many concurrent connections | yes (seconds) |
| `station_offline` | 503 | All nearest stations stale; serving model fallback | — |
| `model_unavailable` | 503 | Forecast model is updating | yes (seconds) |
| `internal_error` | 500 | Unexpected server error; please report `request_id` | — |

## Retry guidance

- **401, 403, 4xx** (except 429): do not retry. Fix the request.
- **404 `no_data`**: do not retry. The data does not exist.
- **429**: wait for `Retry-After`, then retry with exponential backoff.
- **5xx**: retry with exponential backoff starting at 1 second, max 3 attempts.

## See also

- [Authentication](./authentication.md)
- [`/v1/current`](./endpoints/current.md)
