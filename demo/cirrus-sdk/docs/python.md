# Python SDK

`cirrus-sdk` works in Python 3.9+. Sync and async clients are both available.

## Install

```bash
pip install cirrus-sdk
```

## Sync client

```python
from cirrus import CirrusClient

client = CirrusClient(api_key="stratus-key-DEMO-12345")

current = client.current(lat=64.1466, lon=-21.9426)
print(f"{current.temperature_c}C, {current.conditions}")
```

## Async client

```python
import asyncio
from cirrus import AsyncCirrusClient

async def main():
    async with AsyncCirrusClient(api_key="stratus-key-DEMO-12345") as client:
        current = await client.current(lat=64.1466, lon=-21.9426)
        print(current.conditions)

asyncio.run(main())
```

## Forecast

```python
forecast = client.forecast(
    lat=51.5074,
    lon=-0.1278,
    hours=24,
    days=7,
)

for hour in forecast.hourly:
    print(f"{hour.time.isoformat()}: {hour.temperature_c}C")
```

## Historical

```python
from datetime import date

history = client.historical(
    lat=40.7128,
    lon=-74.0060,
    from_=date(2025, 12, 25),
    to=date(2025, 12, 26),
    resolution="daily",
)

for day in history.data:
    print(f"{day.date}: high {day.temp_max_c}C, low {day.temp_min_c}C")
```

## Errors

```python
from cirrus import CirrusError, RateLimitError

try:
    client.current(lat=0, lon=0)
except RateLimitError as e:
    print(f"Wait {e.retry_after_seconds}s before retrying")
except CirrusError as e:
    print(f"{e.code}: {e.message} (req {e.request_id})")
```

## Typing

All response models are `pydantic.BaseModel` instances:

```python
from cirrus.models import CurrentResponse, ForecastResponse

def describe(c: CurrentResponse) -> str:
    return f"{c.location.name}: {c.temperature_c}C"
```

## See also

- [TypeScript SDK](./typescript.md)
- [Go SDK](./go.md)
- [Quickstart](./quickstart.md)
