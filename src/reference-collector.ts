export interface RefRecord {
  resolvedPath: string
  sourceDoc: string
}

export interface ReferenceCollector {
  add(resolvedPath: string, sourceDoc: string): void
  /** All refs added so far, in insertion order; duplicates preserved. */
  getRefs(): RefRecord[]
}

export function createReferenceCollector(): ReferenceCollector {
  const refs: RefRecord[] = []
  return {
    add(resolvedPath, sourceDoc) {
      refs.push({ resolvedPath, sourceDoc })
    },
    getRefs() {
      return refs
    },
  }
}
