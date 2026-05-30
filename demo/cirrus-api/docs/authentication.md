# Authentication

Cirrus uses bearer tokens. Every request must include an `Authorization: Bearer <key>` header. Keys are scoped to a single workspace and can be rotated from the dashboard at any time.

## Getting a key

1. Sign up at `https://app.cirrus.example.com/signup`
2. Verify your email
3. Open **Settings → API Keys** and click **Generate new key**
4. Copy the key immediately — we hash it on save and cannot show it again

Demo keys (for trying the docs in this repo) begin with `stratus-key-DEMO-`. They are rate-limited to 10 req/min and only return data for a fixed set of demo cities.

## Using a key

### bash / curl

```bash
export CIRRUS_KEY="stratus-key-DEMO-12345"

curl -H "Authorization: Bearer $CIRRUS_KEY" \
  "https://api.cirrus.example.com/v1/current?lat=64.1466&lon=-21.9426"
```

### JavaScript / TypeScript

```javascript
const CIRRUS_KEY = process.env.CIRRUS_KEY;

async function getCurrent(lat, lon) {
  const url = new URL("https://api.cirrus.example.com/v1/current");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${CIRRUS_KEY}` },
  });

  if (!res.ok) {
    throw new Error(`Cirrus ${res.status}: ${await res.text()}`);
  }
  return res.json();
}
```

### Python

```python
import os
import requests

CIRRUS_KEY = os.environ["CIRRUS_KEY"]
BASE_URL = "https://api.cirrus.example.com"

def get_current(lat: float, lon: float) -> dict:
    res = requests.get(
        f"{BASE_URL}/v1/current",
        params={"lat": lat, "lon": lon},
        headers={"Authorization": f"Bearer {CIRRUS_KEY}"},
        timeout=10,
    )
    res.raise_for_status()
    return res.json()
```

## Rotating keys

Rotate by generating a new key first, deploying it, then deleting the old key. There is no overlap window — once deleted, a key is immediately invalid.

## Key tiers

| Tier | Daily quota | Per-minute cap | Concurrent connections |
|---|---|---|---|
| Demo | 10 / min | 10 | 1 |
| Free | 1,000 | 60 | 4 |
| Indie | 50,000 | 600 | 16 |
| Business | 1,000,000 | 5,000 | 64 |
| Enterprise | unlimited | unlimited | negotiated |

## Storing keys safely

- Never commit keys to source control. Add `CIRRUS_KEY` to your `.env.local` and gitignore it.
- For browser apps, proxy through your backend — exposing a key client-side leaks your quota.
- Rotate keys whenever someone leaves the team. The dashboard logs every key creation and deletion.

## See also

- [Error reference](../docs/errors.md) — what to do when auth fails
- [Endpoints overview](./endpoints/current.md)
