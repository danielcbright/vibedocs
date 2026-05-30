# Quickstart

A hello-world in each of our three languages. All three print the current temperature in Reykjavik.

## TypeScript

```typescript
import { CirrusClient } from "@cirrus/sdk";

const client = new CirrusClient({ apiKey: "stratus-key-DEMO-12345" });

async function main() {
  const current = await client.current({ lat: 64.1466, lon: -21.9426 });
  console.log(`Reykjavik: ${current.temperatureC}C, ${current.conditions}`);
}

main();
```

Run it:

```bash
npm install @cirrus/sdk
npx tsx hello.ts
```

## Python

```python
from cirrus import CirrusClient

client = CirrusClient(api_key="stratus-key-DEMO-12345")
current = client.current(lat=64.1466, lon=-21.9426)
print(f"Reykjavik: {current.temperature_c}C, {current.conditions}")
```

Run it:

```bash
pip install cirrus-sdk
python hello.py
```

## Go

```go
package main

import (
    "context"
    "fmt"

    "github.com/cirrus/sdk-go/cirrus"
)

func main() {
    client := cirrus.NewClient(cirrus.Config{
        APIKey: "stratus-key-DEMO-12345",
    })

    current, _ := client.Current(context.Background(), cirrus.CurrentParams{
        Lat: 64.1466,
        Lon: -21.9426,
    })
    fmt.Printf("Reykjavik: %.1fC, %s\n", current.TemperatureC, current.Conditions)
}
```

Run it:

```bash
go run hello.go
```

## Next steps

- Read the [language-specific reference](./typescript.md) for your stack
- Sign up for a real key at `https://app.cirrus.example.com` (the demo key only resolves a few cities)
- Browse the [API endpoints](../../cirrus-api/docs/endpoints/current.md) the SDK wraps
