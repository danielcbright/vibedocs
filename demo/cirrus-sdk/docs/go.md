# Go SDK

`github.com/cirrus/sdk-go` requires Go 1.21+.

## Install

```bash
go get github.com/cirrus/sdk-go
```

## Client

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/cirrus/sdk-go/cirrus"
)

func main() {
    client := cirrus.NewClient(cirrus.Config{
        APIKey: "stratus-key-DEMO-12345",
        Units:  cirrus.UnitsMetric,
    })

    ctx := context.Background()

    current, err := client.Current(ctx, cirrus.CurrentParams{
        Lat: 64.1466,
        Lon: -21.9426,
    })
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("%.1fC, %s\n", current.TemperatureC, current.Conditions)
}
```

## Forecast

```go
forecast, err := client.Forecast(ctx, cirrus.ForecastParams{
    Lat:   51.5074,
    Lon:   -0.1278,
    Hours: 24,
    Days:  7,
})
if err != nil {
    return err
}

for _, h := range forecast.Hourly {
    fmt.Printf("%s: %.1fC\n", h.Time.Format(time.RFC3339), h.TemperatureC)
}
```

## Historical

```go
history, err := client.Historical(ctx, cirrus.HistoricalParams{
    Lat:        40.7128,
    Lon:        -74.0060,
    From:       time.Date(2025, 12, 25, 0, 0, 0, 0, time.UTC),
    To:         time.Date(2025, 12, 26, 0, 0, 0, 0, time.UTC),
    Resolution: cirrus.ResolutionDaily,
})
```

## Errors

```go
import "errors"

current, err := client.Current(ctx, params)
if err != nil {
    var rate *cirrus.RateLimitError
    if errors.As(err, &rate) {
        log.Printf("wait %ds", rate.RetryAfterSeconds)
        return nil
    }

    var cerr *cirrus.Error
    if errors.As(err, &cerr) {
        log.Printf("cirrus %s: %s (req %s)", cerr.Code, cerr.Message, cerr.RequestID)
    }
    return err
}
```

## Context cancellation

Every method takes `context.Context`. Cancel a context to abort an in-flight request; the SDK respects the deadline.

## See also

- [TypeScript SDK](./typescript.md)
- [Python SDK](./python.md)
- [Quickstart](./quickstart.md)
