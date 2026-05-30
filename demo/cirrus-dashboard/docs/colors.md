# Colors

Five-step ramps. Each ramp has a base shade (500) and four steps around it. Use `-100` for backgrounds, `-500` for borders and text, `-700` for emphasis.

## Primary (sky blue)

| Token | Hex | Use |
|---|---|---|
| `primary-100` | `#e0f2fe` | Subtle background tint |
| `primary-300` | `#7dd3fc` | Hover background |
| `primary-500` | `#0ea5e9` | Primary border, icons |
| `primary-700` | `#0369a1` | Primary text on light bg |
| `primary-900` | `#0c4a6e` | Headings on tinted bg |

## Neutral (slate)

| Token | Hex | Use |
|---|---|---|
| `neutral-100` | `#f1f5f9` | Page background (light) |
| `neutral-300` | `#cbd5e1` | Borders, dividers |
| `neutral-500` | `#64748b` | Secondary text |
| `neutral-700` | `#334155` | Body text |
| `neutral-900` | `#0f172a` | Headings, page background (dark) |

## Danger (red)

| Token | Hex | Use |
|---|---|---|
| `danger-100` | `#fee2e2` | Alert background |
| `danger-300` | `#fca5a5` | Alert border |
| `danger-500` | `#ef4444` | Error icons, destructive actions |
| `danger-700` | `#b91c1c` | Error text |
| `danger-900` | `#7f1d1d` | Severe-alert emphasis |

## Success (emerald)

| Token | Hex | Use |
|---|---|---|
| `success-100` | `#d1fae5` | Confirmation background |
| `success-300` | `#6ee7b7` | Confirmation border |
| `success-500` | `#10b981` | Success icons |
| `success-700` | `#047857` | Success text |
| `success-900` | `#064e3b` | Emphasis on confirmation |

## Tailwind config

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          100: "#e0f2fe",
          300: "#7dd3fc",
          500: "#0ea5e9",
          700: "#0369a1",
          900: "#0c4a6e",
        },
        // ...
      },
    },
  },
};
```

## See also

- [Typography](./typography.md)
