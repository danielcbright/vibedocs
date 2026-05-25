import { useId } from "react"

/**
 * VibeDocs animated logomark — bold "VD" with a scrolling sine-wave underline.
 * Palette is locked (ocean: sky → cyan → teal) so it reads as brand colour
 * regardless of the surrounding theme.
 *
 * Pass `className` to control size (defaults to 28×28 — sized for top bars
 * and sidebar headers). Animations are pure CSS and pause when off-screen
 * thanks to the inline <style> being scoped per-instance via useId().
 */
export function VibedocsLogo({
  className = "h-7 w-7 shrink-0",
  "aria-label": ariaLabel = "VibeDocs",
}: {
  className?: string
  "aria-label"?: string
}) {
  // Unique per-instance IDs so multiple <VibedocsLogo /> on one page don't
  // collide on gradient / animation-name references.
  const rawId = useId()
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "")
  const gradId = `vd-ocean-${id}`
  const sineGradId = `vd-ocean-sine-${id}`
  const animName = `vd-sine-${id}`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      role="img"
      aria-label={ariaLabel}
      className={className}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="55%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#14b8a6" />
        </linearGradient>
        <linearGradient id={sineGradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.9" />
        </linearGradient>
        <style>{`
          @keyframes ${animName} { to { stroke-dashoffset: -20; } }
        `}</style>
      </defs>
      {/* V */}
      <path
        d="M 8 14 L 18 42 L 28 14"
        stroke={`url(#${gradId})`}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* D */}
      <path
        d="M 36 14 L 36 42 L 46 42 Q 56 42 56 28 Q 56 14 46 14 Z"
        stroke={`url(#${gradId})`}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Scrolling sine underline */}
      <path
        d="M 6 54 C 10 50, 14 58, 18 54 S 26 50, 30 54 S 38 58, 42 54 S 50 50, 54 54 S 62 58, 66 54"
        stroke={`url(#${sineGradId})`}
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="6 4"
        style={{ animation: `${animName} 2.4s linear infinite` }}
      />
    </svg>
  )
}
