# Cirrus SDK

Official client libraries for the Cirrus Weather API. One ergonomic surface, three languages, typed responses, automatic retries.

## Install

### TypeScript / JavaScript

```bash
npm install @cirrus/sdk
```

### Python

```bash
pip install cirrus-sdk
```

### Go

```bash
go get github.com/cirrus/sdk-go
```

## Five-second example

```typescript
import { CirrusClient } from "@cirrus/sdk";

const client = new CirrusClient({ apiKey: "stratus-key-DEMO-12345" });
const current = await client.current({ lat: 64.1466, lon: -21.9426 });
console.log(`Reykjavik: ${current.temperatureC}C, ${current.conditions}`);
```

## What the SDKs give you

- **Typed responses** — full type definitions in every language
- **Automatic retries** — exponential backoff for 5xx and 429 with `Retry-After`
- **Request IDs in errors** — every thrown error carries `request_id` for support
- **Native units** — set once at the client, every response honors it
- **No surprises** — no telemetry, no auto-updates, no global mutation

## Where to go next

- [TypeScript SDK](./docs/typescript.md)
- [Python SDK](./docs/python.md)
- [Go SDK](./docs/go.md)
- [Quickstart for each language](./docs/quickstart.md)

## Versioning

All three SDKs follow semver. Major versions track API major versions (`v1`). Minor versions add endpoints or options; patch versions are bug fixes only.

## Source

The SDKs are open source. See [github.com/cirrus/sdk-ts](https://github.com/cirrus/sdk-ts) (and the language-specific repos linked from each doc page).
