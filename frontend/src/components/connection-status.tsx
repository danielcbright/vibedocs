import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function ConnectionStatus({ connected }: { connected: boolean }) {
  // Keep the dot small visually, but give the tooltip trigger a 44×44
  // hit area on touch devices via `.tap-target`. Wrapping <span> stays
  // inline-flex so the dot remains centered. Both the wrapper and dot
  // get aria-hidden / role so SR users get the tooltip content.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={connected ? "Live reload connected" : "Disconnected"}
          className="inline-flex items-center justify-center tap-target"
        >
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              connected ? "bg-green-500" : "bg-red-500"
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {connected ? "Live reload connected" : "Disconnected – reconnecting..."}
      </TooltipContent>
    </Tooltip>
  )
}
