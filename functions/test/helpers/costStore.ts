// functions/test/helpers/costStore.ts
//
// SDK-boundary read/write counter for Cloud Function handlers.
//
// This is the harness the handoff (docs/firestore-cost-controls.md) requires:
// a tiny in-memory Firestore stub that counts *handler intentions* — every
// collection read, every get, every write, every transaction op — against
// explicit per-invocation ceilings.
//
// It does NOT try to emulate real Firestore semantics (indexes, rules,
// composite queries, subcollections, limits). It gives you a fake `db` whose
// shape matches the tiny surface the aggregation callables in this repo
// actually use:
//
//   db.collection('name').where('k','==',v).where(...).limit(n).get()
//   db.collection('name').doc('id').get()
//   db.getAll(...docRefs)
//   docRef.set/update/create/delete()
//   db.runTransaction(async (tx) => { tx.get(ref); tx.set(ref, data); ... })
//
// You seed it with `seed(collection, docs)`, run the handler against
// `store.db`, and then assert `store.reads <= CEILING`, `store.writes <= CEILING`.
// When a ceiling is exceeded the build fails.
//
// Honest caveat (also documented in firestore-cost-controls.md): these counts
// are *intentions* at the SDK boundary, not billable operations. They catch
// regressions in code (e.g., someone reintroduces a collection scan); they
// are not a substitute for post-deploy measurement.

export interface CostStoreCounters {
  /** Number of document reads (includes get(), where().get(), getAll, tx.get). */
  reads: number
  /** Number of document writes (set/update/create/delete, in or out of tx). */
  writes: number
  /** Number of queries issued (each .where()...get() chain counts as one query). */
  queries: number
  /** Number of transactions started. */
  transactions: number
}

export interface SeedDoc {
  id: string
  [key: string]: unknown
}

interface FakeDocRef {
  id: string
  path: string
  get: () => Promise<{ exists: boolean; id: string; data: () => Record<string, unknown> | undefined }>
  set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void>
  update: (data: Record<string, unknown>) => Promise<void>
  create: (data: Record<string, unknown>) => Promise<void>
  delete: () => Promise<void>
  collection: (name: string) => FakeCollectionRef
}

interface FakeQuerySnapshot {
  empty: boolean
  size: number
  docs: Array<{ id: string; data: () => Record<string, unknown>; ref: FakeDocRef; exists: boolean }>
  forEach: (cb: (doc: { id: string; data: () => Record<string, unknown>; ref: FakeDocRef }) => void) => void
}

interface FakeQuery {
  where: (field: string, op: string, value: unknown) => FakeQuery
  orderBy: (field: string, dir?: 'asc' | 'desc') => FakeQuery
  limit: (n: number) => FakeQuery
  startAfter: (...args: unknown[]) => FakeQuery
  get: () => Promise<FakeQuerySnapshot>
  count: () => { get: () => Promise<{ data: () => { count: number } }> }
}

interface FakeCollectionRef extends FakeQuery {
  doc: (id?: string) => FakeDocRef
  add: (data: Record<string, unknown>) => Promise<FakeDocRef>
}

interface FakeTransaction {
  get: (ref: FakeDocRef) => Promise<{ exists: boolean; id: string; data: () => Record<string, unknown> | undefined }>
  set: (ref: FakeDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) => FakeTransaction
  update: (ref: FakeDocRef, data: Record<string, unknown>) => FakeTransaction
  create: (ref: FakeDocRef, data: Record<string, unknown>) => FakeTransaction
  delete: (ref: FakeDocRef) => FakeTransaction
}

export interface CostStore {
  /** Fake Firestore db you hand to a handler. */
  db: {
    collection: (path: string) => FakeCollectionRef
    doc: (path: string) => FakeDocRef
    getAll: (...refs: FakeDocRef[]) => Promise<Array<{ exists: boolean; id: string; data: () => Record<string, unknown> | undefined }>>
    runTransaction: <T>(fn: (tx: FakeTransaction) => Promise<T>) => Promise<T>
    batch: () => {
      set: (ref: FakeDocRef, data: Record<string, unknown>, options?: { merge?: boolean }) => void
      update: (ref: FakeDocRef, data: Record<string, unknown>) => void
      delete: (ref: FakeDocRef) => void
      commit: () => Promise<void>
    }
  }
  /** Current counters. */
  readonly counters: Readonly<CostStoreCounters>
  /** Reset counters without clearing seed data (between assertions). */
  resetCounters: () => void
  /** Seed a collection with documents. Replaces any previous seed for that collection. */
  seed: (collection: string, docs: SeedDoc[]) => void
  /** Read counter shortcut. */
  readonly reads: number
  /** Write counter shortcut. */
  readonly writes: number
  /** Reset all seed data and counters. */
  clear: () => void
  /** Assert a hard per-invocation read ceiling; throws if exceeded. */
  assertMaxReads: (ceiling: number, label?: string) => void
  /** Assert a hard per-invocation write ceiling; throws if exceeded. */
  assertMaxWrites: (ceiling: number, label?: string) => void
}

/** Create an empty cost store. Seed it with seed(), then drive your handler against store.db. */
export function makeCostStore(): CostStore {
  const data: Map<string, Map<string, Record<string, unknown>>> = new Map()
  const counters: CostStoreCounters = { reads: 0, writes: 0, queries: 0, transactions: 0 }

  const resetCounters = () => {
    counters.reads = 0
    counters.writes = 0
    counters.queries = 0
    counters.transactions = 0
  }

  const clear = () => {
    data.clear()
    resetCounters()
  }

  const seed = (collection: string, docs: SeedDoc[]) => {
    const col = data.get(collection) || new Map()
    col.clear()
    for (const d of docs) col.set(d.id, { ...d })
    data.set(collection, col)
  }

  function getDoc(collectionPath: string, id: string) {
    const col = data.get(collectionPath)
    const raw = col?.get(id)
    return raw ? { ...raw } : undefined
  }

  function putDoc(collectionPath: string, id: string, doc: Record<string, unknown>) {
    let col = data.get(collectionPath)
    if (!col) {
      col = new Map()
      data.set(collectionPath, col)
    }
    col.set(id, { ...doc })
  }

  function matches(doc: Record<string, unknown>, filters: Array<[string, string, unknown]>): boolean {
    for (const [field, op, value] of filters) {
      const dotVal = field.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), doc)
      switch (op) {
        case '==':
          if (dotVal !== value) return false
          break
        case '!=':
          if (dotVal === value) return false
          break
        case '>':
          if (!(dotVal > (value as number))) return false
          break
        case '>=':
          if (!(dotVal >= (value as number))) return false
          break
        case '<':
          if (!(dotVal < (value as number))) return false
          break
        case '<=':
          if (!(dotVal <= (value as number))) return false
          break
        case 'in':
          if (!Array.isArray(value) || !value.includes(dotVal as never)) return false
          break
        case 'array-contains':
          if (!Array.isArray(dotVal) || !(dotVal as unknown[]).includes(value)) return false
          break
        default:
          // Unknown ops pass through (no filtering) so tests can be written
          // incrementally. If you add a real `not-in` / `array-contains-any`
          // consumer in a handler, extend this switch.
          break
      }
    }
    return true
  }

  function makeDocRef(collectionPath: string, id: string): FakeDocRef {
    const path = `${collectionPath}/${id}`
    const ref: FakeDocRef = {
      id,
      path,
      get: async () => {
        counters.reads += 1
        const snap = getDoc(collectionPath, id)
        return {
          exists: !!snap,
          id,
          data: () => (snap ? { ...snap } : undefined),
          ref,
        } as FakeQuerySnapshot['docs'][number]
      },
      set: async (d, _opts) => {
        counters.writes += 1
        putDoc(collectionPath, id, { ...d })
      },
      update: async (d) => {
        counters.writes += 1
        const existing = getDoc(collectionPath, id) || {}
        putDoc(collectionPath, id, { ...existing, ...d })
      },
      create: async (d) => {
        counters.writes += 1
        if (getDoc(collectionPath, id)) throw new Error(`Document already exists: ${path}`)
        putDoc(collectionPath, id, { ...d })
      },
      delete: async () => {
        counters.writes += 1
        data.get(collectionPath)?.delete(id)
      },
      collection: (name: string) => makeCollectionRef(`${path}/${name}`),
    }
    return ref
  }

  function makeQuery(collectionPath: string, filters: Array<[string, string, unknown]> = [], limitN?: number, orderBys: Array<[string, 'asc' | 'desc']> = []): FakeQuery {
    const self: FakeQuery = {
      where: (field, op, value) => makeQuery(collectionPath, [...filters, [field, op, value]], limitN, orderBys),
      orderBy: (field, dir = 'asc') => makeQuery(collectionPath, filters, limitN, [...orderBys, [field, dir]]),
      limit: (n) => makeQuery(collectionPath, filters, n, orderBys),
      startAfter: () => self,
      count: () => ({
        get: async () => {
          counters.queries += 1
          const col = data.get(collectionPath)
          const all = col ? [...col.entries()].filter(([, d]) => matches(d, filters)) : []
          return { data: () => ({ count: all.length }) }
        },
      }),
      get: async () => {
        counters.queries += 1
        const col = data.get(collectionPath)
        let rows = col ? [...col.entries()].filter(([, d]) => matches(d, filters)) : []
        if (orderBys.length) {
          rows.sort(([aid, a], [bid, b]) => {
            for (const [field, dir] of orderBys) {
              const av = field.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), a)
              const bv = field.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), b)
              if (av === bv) continue
              const cmp = (av as number) < (bv as number) ? -1 : 1
              return dir === 'desc' ? -cmp : cmp
            }
            return aid < bid ? -1 : 1
          })
        }
        if (limitN !== undefined) rows = rows.slice(0, limitN)
        counters.reads += rows.length
        const docs = rows.map(([id, d]) => {
          const ref = makeDocRef(collectionPath, id)
          return {
            id,
            exists: true,
            ref,
            data: () => ({ ...d }),
          }
        })
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach: (cb: (d: FakeQuerySnapshot['docs'][number]) => void) => docs.forEach(cb),
        }
      },
    }
    return self
  }

  function makeCollectionRef(path: string): FakeCollectionRef {
    const base = makeQuery(path)
    const col: FakeCollectionRef = {
      ...base,
      doc: (id) => makeDocRef(path, id || `auto-${Math.random().toString(36).slice(2, 10)}`),
      add: async (d) => {
        const id = `auto-${Math.random().toString(36).slice(2, 10)}`
        await makeDocRef(path, id).set(d)
        return makeDocRef(path, id)
      },
    }
    return col
  }

  function parseDocPath(path: string): [string, string] {
    // supports 'col/doc' or 'col/doc/sub/subdoc'; last two segments are treated as the write target.
    const parts = path.split('/').filter(Boolean)
    if (parts.length < 2) throw new Error(`Bad doc path: ${path}`)
    const docId = parts.pop() as string
    const col = parts.join('/')
    return [col, docId]
  }

  const txnFor = (isTx: boolean): FakeTransaction => ({
    get: async (ref) => {
      const [col, id] = parseDocPath(ref.path)
      if (isTx) counters.reads += 1
      const raw = getDoc(col, id)
      return { exists: !!raw, id, data: () => (raw ? { ...raw } : undefined) }
    },
    set: (ref, d, _opts) => {
      const [col, id] = parseDocPath(ref.path)
      if (isTx) counters.writes += 1
      putDoc(col, id, { ...d })
      return txnFor(isTx)
    },
    update: (ref, d) => {
      const [col, id] = parseDocPath(ref.path)
      if (isTx) counters.writes += 1
      const existing = getDoc(col, id) || {}
      putDoc(col, id, { ...existing, ...d })
      return txnFor(isTx)
    },
    create: (ref, d) => {
      const [col, id] = parseDocPath(ref.path)
      if (isTx) counters.writes += 1
      if (getDoc(col, id)) throw new Error(`Document already exists: ${ref.path}`)
      putDoc(col, id, { ...d })
      return txnFor(isTx)
    },
    delete: (ref) => {
      const [col, id] = parseDocPath(ref.path)
      if (isTx) counters.writes += 1
      data.get(col)?.delete(id)
      return txnFor(isTx)
    },
  })

  const db: CostStore['db'] = {
    collection: (path) => makeCollectionRef(path),
    doc: (path) => {
      const [col, id] = parseDocPath(path)
      return makeDocRef(col, id)
    },
    getAll: async (...refs) => {
      counters.reads += refs.length
      return refs.map((ref) => {
        const [col, id] = parseDocPath(ref.path)
        const raw = getDoc(col, id)
        return { exists: !!raw, id, data: () => (raw ? { ...raw } : undefined) }
      })
    },
    runTransaction: async (fn) => {
      counters.transactions += 1
      return await fn(txnFor(true))
    },
    batch: () => {
      const ops: Array<() => void> = []
      return {
        set: (ref, d) => {
          ops.push(() => {
            const [col, id] = parseDocPath(ref.path)
            putDoc(col, id, { ...d })
          })
        },
        update: (ref, d) => {
          ops.push(() => {
            const [col, id] = parseDocPath(ref.path)
            const existing = getDoc(col, id) || {}
            putDoc(col, id, { ...existing, ...d })
          })
        },
        delete: (ref) => {
          ops.push(() => {
            const [col, id] = parseDocPath(ref.path)
            data.get(col)?.delete(id)
          })
        },
        commit: async () => {
          counters.writes += ops.length
          ops.forEach((op) => op())
        },
      }
    },
  }

  const assertMaxReads = (ceiling: number, label = 'handler') => {
    if (counters.reads > ceiling) {
      throw new Error(
        `costStore: ${label} exceeded read ceiling (${counters.reads} > ${ceiling}). ` +
          `Violates cost rule C1/C3 — see docs/firestore-cost-controls.md.`
      )
    }
  }
  const assertMaxWrites = (ceiling: number, label = 'handler') => {
    if (counters.writes > ceiling) {
      throw new Error(
        `costStore: ${label} exceeded write ceiling (${counters.writes} > ${ceiling}). ` +
          `Violates cost rule C5/C10 — see docs/firestore-cost-controls.md.`
      )
    }
  }

  return {
    db,
    counters,
    resetCounters,
    seed,
    clear,
    get reads() { return counters.reads },
    get writes() { return counters.writes },
    assertMaxReads,
    assertMaxWrites,
  }
}
