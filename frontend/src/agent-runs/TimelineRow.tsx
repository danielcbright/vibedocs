import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { AgentEvent } from "@shared/agent-run-types"
import { KindIcon, ToolIcon, ToolStatusIcon } from "./components/icons"
import { CopyButton } from "./components/CopyButton"
import { CodeBlock } from "./components/CodeBlock"
import { eventTitle, fmtDuration, fmtTime, isExpandable, toolCopyText, toolSummary } from "./lib/tool-display"
import { Linked } from "./components/Linked"
import type { CompiledRule } from "./lib/linkify"

/**
 * One node on the timeline spine.
 *
 * Markdown-bearing kinds render `textHtml`, which the server produced through
 * the project's unified pipeline and already sanitized. Thinking stays plain
 * text — it is raw reasoning, not markdown.
 */
export function TimelineRow({ event, workdir, rules = [], runId }: { event: AgentEvent; workdir?: string; rules?: readonly CompiledRule[]; runId?: string }) {
  const [open, setOpen] = useState(false)
  const expandable = isExpandable(event)
  const title = eventTitle(event, workdir)
  const tool = event.tool

  // A `result` is the turn's outcome and the thing you scroll to find, so the
  // whole node carries the colour rather than a badge on the end of it.
  const isResult = event.kind === "result"
  const resultFailed = isResult && event.meta?.isError === true
  const resultOk = isResult && !resultFailed

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "group relative flex gap-3 py-[3px]",
          isResult && "my-1 rounded-md py-1.5 pr-2",
          resultOk && "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/25",
          resultFailed && "bg-red-500/10 ring-1 ring-inset ring-red-500/25",
        )}
        data-kind={event.kind}
        data-result={isResult ? (resultFailed ? "failed" : "complete") : undefined}
      >
        <div className="w-[70px] shrink-0 pt-[3px] text-right font-mono text-[11px] text-muted-foreground">
          {fmtTime(event.ts)}
        </div>
        <div className={cn(
          "relative z-10 mt-[2px] flex size-[22px] shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground",
          resultOk && "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
          resultFailed && "border-red-500/50 text-red-600 dark:text-red-400",
        )}>
          {tool ? <ToolIcon tool={tool.name} /> : <KindIcon kind={event.kind} />}
        </div>

        <div className="min-w-0 flex-1 pb-1">
          <div className="flex items-center gap-2">
            {expandable ? (
              <CollapsibleTrigger className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left">
                <ChevronDown className={cn("h-3 w-3 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
                <span className={cn(
                  "min-w-0 flex-1 truncate text-[13px]",
                  tool && "font-mono text-[12.5px]",
                  event.kind === "thinking" && "italic text-muted-foreground",
                )}>
                  {title}
                </span>
              </CollapsibleTrigger>
            ) : (
              // Assistant bodies render below as markdown, so the header line
              // would just repeat them; give it the spine and nothing else.
              <div className={cn(
                "min-w-0 flex-1 text-[13px] leading-relaxed",
                resultOk && "font-medium text-emerald-700 dark:text-emerald-400",
                resultFailed && "font-medium text-red-700 dark:text-red-400",
              )}>
                {event.kind === "assistant" ? null : <Linked text={title} rules={rules} />}
              </div>
            )}

            {tool && (
              <>
                <span className="shrink-0 text-[11px] text-muted-foreground">{toolSummary(tool)}</span>
                <ToolStatusIcon status={tool.status} />
              </>
            )}
            {event.kind === "result" && (
              <span className={cn(
                "shrink-0 rounded-full border px-2 py-[1px] text-[11px] font-medium",
                event.meta?.isError ? "border-red-500/35 bg-red-500/10 text-red-500" : "border-emerald-500/35 bg-emerald-500/10 text-emerald-500",
              )}>
                {fmtDuration(event.meta?.durationMs as number | undefined)}
                {event.meta?.outputTokens != null ? ` · ${event.meta.outputTokens} out` : ""}
              </span>
            )}
            <CopyButton
              value={() => toolCopyText(event)}
              className="shrink-0 opacity-0 group-hover:opacity-100"
              title="Copy"
            />
          </div>

          {/* Narrative bodies render inline — they are the story of the run. */}
          {(event.kind === "assistant" || event.kind === "result") && (
            event.textHtml ? (
              <div
                className="prose prose-sm dark:prose-invert mt-1 max-w-none prose-pre:my-2 prose-p:my-1.5"
                dangerouslySetInnerHTML={{ __html: event.textHtml }}
              />
            ) : event.text ? (
              <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{event.text}</div>
            ) : null
          )}

          <CollapsibleContent>
            <div className="mt-2 space-y-2">
              {event.kind === "thinking" && (
                <div className="whitespace-pre-wrap border-l-2 pl-3 text-[12.5px] italic leading-relaxed text-muted-foreground">
                  {event.text}
                </div>
              )}
              {event.kind === "user" && (
                event.textHtml ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none rounded border bg-muted/40 p-3"
                       dangerouslySetInnerHTML={{ __html: event.textHtml }} />
                ) : (
                  <div className="whitespace-pre-wrap rounded border bg-muted/40 p-3 text-[12.5px] leading-relaxed">{event.text}</div>
                )
              )}
              {tool && (
                <>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full border px-2 py-[1px]">{tool.name}</span>
                    {tool.endTs && <span>{fmtDuration(tool.endTs - event.ts)}</span>}
                    <div className="ml-auto flex gap-1">
                      <CopyButton value={tool.label} label="Copy command" />
                    </div>
                  </div>
                  {tool.output ? (
                    <>
                      <CodeBlock
                        code={tool.output}
                        // Only mounted when the row is expanded, so the
                        // highlight fetch is genuinely lazy.
                        highlightUrl={runId ? `/api/runs/${encodeURIComponent(runId)}/events/${event.seq}/output` : undefined}
                      />
                      {tool.outputTruncated && (
                        <div className="text-[11px] text-muted-foreground">output truncated</div>
                      )}
                    </>
                  ) : (
                    <div className="text-[12px] text-muted-foreground">no output captured</div>
                  )}
                </>
              )}
            </div>
          </CollapsibleContent>
        </div>
      </div>
    </Collapsible>
  )
}
