import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface PanelToggleProps {
  /** Which edge the panel sits on; picks the icon pair. */
  side: "left" | "right"
  collapsed: boolean
  onToggle: () => void
  /** Human name of the panel for the tooltip and accessible label, e.g. "sidebar". */
  label: string
  /** Optional shortcut hint appended to the tooltip, e.g. "⌘B". */
  shortcut?: string
  className?: string
}

/**
 * Collapse / expand button for one side panel of the desktop layout. The
 * icon shows the action, not the state: a panel that is open shows the
 * "close" glyph, a collapsed one shows the "open" glyph.
 */
export function PanelToggle({ side, collapsed, onToggle, label, shortcut, className }: PanelToggleProps) {
  const Icon = side === "left"
    ? (collapsed ? PanelLeftOpen : PanelLeftClose)
    : (collapsed ? PanelRightOpen : PanelRightClose)
  const action = collapsed ? `Show ${label}` : `Hide ${label}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground ${className ?? ""}`}
          aria-label={action}
          aria-pressed={!collapsed}
          data-testid={`panel-toggle-${side}`}
          onClick={onToggle}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {action}
        {shortcut ? <span className="ml-2 text-muted-foreground">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}
