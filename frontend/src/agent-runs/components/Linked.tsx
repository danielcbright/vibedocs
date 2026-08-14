import { linkify, type CompiledRule } from "../lib/linkify"

/**
 * Renders text with configured patterns turned into links.
 *
 * Segments are produced by a pure function and rendered as React children, so
 * nothing here is dangerouslySetInnerHTML — agent text stays escaped by React.
 */
export function Linked({ text, rules, className }: {
  text: string
  rules: readonly CompiledRule[]
  className?: string
}) {
  return (
    <span className={className}>
      {linkify(text, rules).map((s, i) =>
        s.href ? (
          <a
            key={i}
            href={s.href}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
          >
            {s.text}
          </a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  )
}
