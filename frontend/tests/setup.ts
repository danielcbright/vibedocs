import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Node 25 ships a native `localStorage` global. Without `--localstorage-file`
 * it is present but inert — `typeof localStorage === "object"` while
 * `localStorage.getItem` is undefined — and it shadows the jsdom
 * implementation. Any component reading storage during render then throws
 * "localStorage.getItem is not a function", which looks like a component bug
 * and is not one.
 *
 * Install a real in-memory implementation when the global one is unusable.
 */
function installLocalStorage() {
  const usable = typeof globalThis.localStorage?.getItem === 'function'
  if (usable) return

  const store = new Map<string, string>()
  const shim: Storage = {
    get length() { return store.size },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(String(k), String(v)) },
    removeItem: (k) => { store.delete(k) },
    clear: () => { store.clear() },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: shim, configurable: true, writable: true,
  })
}

installLocalStorage()

beforeEach(() => {
  globalThis.localStorage?.clear()
})

afterEach(() => {
  cleanup()
})
