/**
 * Who may use `/api/settings/*` — this machine only.
 *
 * Changing roots escalates access: a root of ~ exposes every non-dot file under it
 * through `/api/file`. Listing folders discloses the shape of a home directory. So
 * the feature is off unless asked for, and when on, three checks each stop a
 * different caller:
 *
 *   peer address is loopback   → another machine, whatever headers it sends
 *   Host names loopback        → a DNS-rebinding page, which IS same-origin to
 *                                the browser but still sends its own hostname
 *   Origin is ours (writes)    → a cross-site page posting to localhost (CSRF)
 *
 * Read-only mode forces the feature off, like uploads. A reverse proxy on this
 * machine that forwards remote requests with a loopback Host header defeats the
 * first two; that is documented rather than detected.
 */
import { isTruthy } from '../upload-auth.js'
import { isOriginAllowed } from '../ws-auth.js'

export interface SettingsConfig {
  /** `VIBEDOCS_SETTINGS_ENABLED`, forced off by `VIBEDOCS_READ_ONLY`. */
  enabled: boolean
  /** `VIBEDOCS_SUPERVISED`: a supervisor restarts this process when it exits. */
  supervised: boolean
}

export function parseSettingsConfig(
  env: Record<string, string | undefined>,
  readOnly: boolean,
): SettingsConfig {
  return {
    enabled: !readOnly && isTruthy(env.VIBEDOCS_SETTINGS_ENABLED),
    supervised: isTruthy(env.VIBEDOCS_SUPERVISED),
  }
}

export type SettingsAuthResult =
  | 'disabled'  // feature off: 404, as if the routes did not exist
  | 'not-local' // 403
  | 'ok'

export interface SettingsAuthInput {
  enabled: boolean
  method: string
  /** Socket peer address. */
  peerAddress: string | undefined
  /** `Host` header. */
  host: string | undefined
  /** `Origin` header. */
  origin: string | undefined
  /** Port this server listens on. */
  port: number
}

const SAFE_METHODS = new Set(['GET', 'HEAD'])

/** Vite's dev server, which proxies `/api` here (the Host it forwards is ours). */
const DEV_PORT = 5173

export function checkSettingsAuth(input: SettingsAuthInput): SettingsAuthResult {
  if (!input.enabled) return 'disabled'
  if (!isLoopbackAddress(input.peerAddress)) return 'not-local'
  if (!isLoopbackHost(input.host, input.port)) return 'not-local'
  if (!SAFE_METHODS.has(input.method.toUpperCase())) {
    const ours = [...loopbackOrigins(input.port), ...loopbackOrigins(DEV_PORT)]
    if (!isOriginAllowed(input.origin, ours, { allowNoOrigin: false })) return 'not-local'
  }
  return 'ok'
}

const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]']

function loopbackOrigins(port: number): string[] {
  return LOOPBACK_NAMES.map((name) => `http://${name}:${port}`)
}

function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false
  const norm = host.toLowerCase()
  return LOOPBACK_NAMES.some((name) => norm === `${name}:${port}`)
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const v4 = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return v4 === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4)
}
