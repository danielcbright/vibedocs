import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TimelineRow } from "@/agent-runs/TimelineRow"
import type { AgentEvent } from "@shared/agent-run-types"

const ev = (over: Partial<AgentEvent>): AgentEvent => ({ seq: 1, ts: 1_700_000_000_000, kind: "other", ...over })

describe("TimelineRow", () => {
  it("renders assistant markdown as html, not raw markdown", () => {
    const { container } = render(
      <TimelineRow event={ev({ kind: "assistant", text: "## Plan", textHtml: "<h2>Plan</h2>" })} />,
    )
    expect(container.querySelector("h2")).not.toBeNull()
    expect(container.textContent).not.toContain("## Plan")
  })

  it("falls back to plain text when the server sent no html", () => {
    render(<TimelineRow event={ev({ kind: "assistant", text: "plain body" })} />)
    expect(screen.getByText("plain body")).toBeTruthy()
  })

  it("shows a tool label, its summary and its status", () => {
    render(<TimelineRow event={ev({
      kind: "tool",
      tool: { name: "shell", callId: "c1", label: "npm test", args: {}, status: "error", exitCode: 1 },
    })} />)
    expect(screen.getByText("npm test")).toBeTruthy()
    expect(screen.getByText("exit 1")).toBeTruthy()
    expect(screen.getByLabelText("error")).toBeTruthy()
  })

  it("shows a running tool as running", () => {
    render(<TimelineRow event={ev({
      kind: "tool",
      tool: { name: "shell", callId: "c1", label: "sleep 5", args: {}, status: "running" },
    })} />)
    expect(screen.getByText("running")).toBeTruthy()
    expect(screen.getByLabelText("running")).toBeTruthy()
  })

  it("shortens a tool path against the run workdir", () => {
    render(<TimelineRow
      workdir="/home/dev/app"
      event={ev({
        kind: "tool",
        tool: { name: "read", callId: "c1", label: "/home/dev/app/src/router.ts", args: { path: "/home/dev/app/src/router.ts" }, status: "success" },
      })}
    />)
    expect(screen.getByText("src/router.ts")).toBeTruthy()
  })

  it("renders an event with neither text nor tool without throwing", () => {
    expect(() => render(<TimelineRow event={ev({ kind: "other", meta: { vendorType: "connection", vendorSubtype: "reconnecting" } })} />)).not.toThrow()
  })

  it("does not show an absurd duration when a result has no durationMs", () => {
    // The bake-off rendered "29774740m" from a missing timestamp.
    const { container } = render(<TimelineRow event={ev({ kind: "result", meta: { isError: false } })} />)
    expect(container.textContent).not.toMatch(/\d{4,}m/)
  })
})
