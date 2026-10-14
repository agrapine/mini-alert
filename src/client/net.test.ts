import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeSocket {
  static readonly OPEN = 1
  static made: FakeSocket[] = []
  readyState = 0
  binaryType = ''
  closed = false
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.made.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  send() {}

  close() {
    this.closed = true
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeSocket.made = []
})

describe('net', () => {
  it('reconnects at once when a silent socket is dropped, ignoring its late close', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('location', { protocol: 'http:', host: 'test', hash: '', pathname: '/', search: '' })
    vi.stubGlobal('WebSocket', FakeSocket)
    const { Net } = await import('./net.ts')
    const net = new Net()
    let closes = 0
    net.onClose = () => (closes += 1)
    net.connect()
    const first = FakeSocket.made[0]
    first.readyState = FakeSocket.OPEN
    first.emit('open')
    expect(net.quietFor()).not.toBeNull()

    net.drop()
    expect(first.closed).toBe(true)
    expect(FakeSocket.made).toHaveLength(2)
    first.emit('close')
    expect(closes).toBe(1)
    expect(net.quietFor()).toBeNull()
  })

  it('stays offline after pause until asked to connect', async () => {
    const retries: unknown[] = []
    vi.stubGlobal('window', { setTimeout: (run: unknown) => retries.push(run) })
    vi.stubGlobal('location', { protocol: 'http:', host: 'test', hash: '', pathname: '/', search: '' })
    vi.stubGlobal('WebSocket', FakeSocket)
    const { Net } = await import('./net.ts')
    const net = new Net()
    net.connect()
    const first = FakeSocket.made[0]
    first.readyState = FakeSocket.OPEN
    first.emit('open')

    net.pause()
    first.emit('close')
    expect(first.closed).toBe(true)
    expect(retries).toEqual([])
    expect(FakeSocket.made).toHaveLength(1)

    net.connect()
    expect(FakeSocket.made[1]?.url).toBe(first.url)
  })
})
