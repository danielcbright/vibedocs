import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-block h-2 w-2 rounded-full",
            connected ? "bg-green-500" : "bg-red-500"
          )}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {connected ? "Live reload connected" : "Disconnected – reconnecting..."}
      </TooltipContent>
    </Tooltip>
  )
}
