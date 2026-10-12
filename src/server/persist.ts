import { Buffer } from 'node:buffer'

type ByteCtor = {
  new (buffer: ArrayBuffer, byteOffset: number, length: number): ArrayBufferView
  BYTES_PER_ELEMENT: number
}

const BYTE_TYPES: Record<string, ByteCtor> = {
  Uint8Array: Uint8Array as unknown as ByteCtor,
  Uint16Array: Uint16Array as unknown as ByteCtor,
  Uint32Array: Uint32Array as unknown as ByteCtor,
  Int8Array: Int8Array as unknown as ByteCtor,
  Int16Array: Int16Array as unknown as ByteCtor,
  Int32Array: Int32Array as unknown as ByteCtor,
  Float32Array: Float32Array as unknown as ByteCtor,
  Float64Array: Float64Array as unknown as ByteCtor,
}

export type SaveKind = {
  tag: string
  test(value: object): boolean
  skip?: readonly string[]
  revive(fields: Record<string, unknown>): object
}

const kinds: SaveKind[] = []

export function registerKind(kind: SaveKind) {
  const index = kinds.findIndex((item) => item.tag === kind.tag)
  if (index >= 0) kinds[index] = kind
  else kinds.push(kind)
}

export function pack(value: unknown, skip: readonly string[] = []): unknown {
  return write(value, new WeakSet(), skip)
}

export function unpack(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(unpack)
  const data = value as Record<string, unknown>
  if (typeof data.$ === 'string') return unpackTagged(data.$, data)
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(data)) out[key] = unpack(data[key])
  return out
}

function write(value: unknown, stack: WeakSet<object>, skip: readonly string[]): unknown {
  if (value === null || typeof value !== 'object') return value
  if (stack.has(value)) throw new Error('save cycle')
  stack.add(value)
  try {
    if (value instanceof Map) {
      return { $: 'map', entries: [...value].map(([key, item]) => [write(key, stack, []), write(item, stack, [])]) }
    }
    if (value instanceof Set) return { $: 'set', values: [...value].map((item) => write(item, stack, [])) }
    if (isBytes(value)) return { $: 'bytes', ...bytesOf(value) }
    for (const kind of kinds) {
      if (!kind.test(value)) continue
      const body = plain(value, stack, kind.skip ?? [])
      body.$ = kind.tag
      return body
    }
    if (Array.isArray(value)) return value.map((item) => write(item, stack, []))
    return plain(value, stack, skip)
  } finally {
    stack.delete(value)
  }
}

function plain(value: object, stack: WeakSet<object>, skip: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    if (skip.includes(key)) continue
    const field = (value as Record<string, unknown>)[key]
    if (typeof field === 'function' || field === undefined) continue
    out[key] = write(field, stack, [])
  }
  return out
}

function unpackTagged(tag: string, data: Record<string, unknown>): unknown {
  if (tag === 'map') {
    const map = new Map()
    const entries = data.entries
    if (!Array.isArray(entries)) throw new Error('saved map')
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length < 2) throw new Error('saved map entry')
      map.set(unpack(entry[0]), unpack(entry[1]))
    }
    return map
  }
  if (tag === 'set') {
    const values = data.values
    if (!Array.isArray(values)) throw new Error('saved set')
    return new Set(values.map(unpack))
  }
  if (tag === 'bytes') {
    if (typeof data.t !== 'string' || typeof data.b !== 'string') throw new Error('saved bytes')
    return unpackBytes(data.t, data.b)
  }
  const kind = kinds.find((item) => item.tag === tag)
  if (!kind) throw new Error(`unknown save tag ${tag}`)
  const fields: Record<string, unknown> = {}
  for (const key of Object.keys(data)) {
    if (key === '$') continue
    fields[key] = unpack(data[key])
  }
  return kind.revive(fields)
}

function isBytes(value: object): value is ArrayBufferView {
  return ArrayBuffer.isView(value) && !(value instanceof DataView)
}

function bytesOf(value: ArrayBufferView): { t: string; b: string } {
  const raw = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  const t = value instanceof Uint8Array ? 'Uint8Array' : value.constructor.name
  return { t, b: Buffer.from(raw).toString('base64') }
}

function unpackBytes(t: string, b64: string): ArrayBufferView {
  const ctor = BYTE_TYPES[t]
  if (!ctor) throw new Error(`unknown bytes ${t}`)
  const raw = Uint8Array.from(Buffer.from(b64, 'base64'))
  const count = raw.byteLength / ctor.BYTES_PER_ELEMENT
  if (!Number.isInteger(count)) throw new Error(`bad bytes ${t}`)
  if (t === 'Uint8Array') return raw
  return new ctor(raw.buffer, 0, count)
}
