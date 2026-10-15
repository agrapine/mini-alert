import { readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Alarm, TAKES } from './alarm.ts'
import { ContactKind } from './render/radar.ts'

const HORN_S = 2
const LINE_S = 1.5

type FakeBuffer = { url: string; duration: number }

class FakeSource {
  buffer: FakeBuffer | null = null
  started = false
  stopped = false

  connect() {}

  start() {
    this.started = true
  }

  stop() {
    this.stopped = true
  }
}

class FakeContext {
  static made: FakeContext[] = []
  state = 'suspended'
  currentTime = 0
  destination = {}
  resumes = 0
  sources: FakeSource[] = []

  constructor() {
    FakeContext.made.push(this)
  }

  resume() {
    this.resumes += 1
    this.state = 'running'
    return Promise.resolve()
  }

  decodeAudioData(data: FakeBuffer) {
    return Promise.resolve(data)
  }

  createBufferSource() {
    const source = new FakeSource()
    this.sources.push(source)
    return source
  }

  played() {
    return this.sources.filter((source) => source.started).map((source) => source.buffer?.url)
  }
}

async function fetchSample(url: string) {
  return { arrayBuffer: async () => ({ url, duration: TAKES.horns.includes(url) ? HORN_S : LINE_S }) }
}

function gestures() {
  const listeners = new Map<string, () => void>()
  return {
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    dispatch: (type: string) => listeners.get(type)?.(),
  }
}

function rolls(...values: number[]) {
  const random = vi.spyOn(Math, 'random')
  for (const value of values) random.mockReturnValueOnce(value)
}

async function unlocked() {
  const alarm = new Alarm()
  const target = gestures()
  alarm.listen(target)
  target.dispatch('pointerup')
  await new Promise((resolve) => setTimeout(resolve))
  return { alarm, context: FakeContext.made[0] }
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('fetch', fetchSample)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  FakeContext.made = []
})

describe('alarm', () => {
  it('starts audio on the release of a touch or on a key, until it runs', () => {
    const alarm = new Alarm()
    const target = gestures()
    alarm.listen(target)
    target.dispatch('pointerdown')
    expect(FakeContext.made).toHaveLength(0)
    target.dispatch('pointerup')
    const context = FakeContext.made[0]
    expect(context.resumes).toBe(1)
    context.state = 'suspended'
    target.dispatch('keydown')
    target.dispatch('pointerup')
    expect(context.resumes).toBe(2)
    expect(FakeContext.made).toHaveLength(1)
  })

  it('plays one sample per contact: a horn, or the line for a base or a unit', async () => {
    const { alarm, context } = await unlocked()
    rolls(0, 0, 0.5, 0, 0.5, 0)
    alarm.sound(ContactKind.Base)
    context.currentTime = 10
    alarm.sound(ContactKind.Base)
    context.currentTime = 20
    alarm.sound(ContactKind.Unit)
    expect(context.played()).toEqual([
      TAKES.horns[0],
      TAKES.lines[ContactKind.Base][0],
      TAKES.lines[ContactKind.Unit][0],
    ])
  })

  it('draws the horn and the line for what was hit equally often, each from every one of its takes', async () => {
    const files = readdirSync(new URL('../../assets/alarm/', import.meta.url))
    const named = (name: string) => files.filter((file) => file.startsWith(`${name}-`))
    const { alarm, context } = await unlocked()
    const steps = 20
    for (const [kind, line] of [
      [ContactKind.Base, 'base'],
      [ContactKind.Unit, 'unit'],
    ] as const) {
      const from = context.sources.length
      for (let pool = 0; pool < steps; pool++) {
        for (let take = 0; take < steps; take++) {
          rolls(pool / steps, take / steps)
          alarm.sound(kind)
          context.currentTime += HORN_S
        }
      }
      const heard = context.played().slice(from).map((url) => url?.split('/').pop() ?? '')
      expect(heard.filter((file) => file.startsWith('horn-'))).toHaveLength((steps * steps) / 2)
      expect(heard.filter((file) => file.startsWith(`${line}-`))).toHaveLength((steps * steps) / 2)
      expect(new Set(heard)).toEqual(new Set([...named('horn'), ...named(line)]))
    }
    expect(named('horn').length + named('base').length + named('unit').length).toBe(files.length)
  })

  it('never starts over an alarm still sounding', async () => {
    const { alarm, context } = await unlocked()
    rolls(0.5, 0, 0, 0)
    alarm.sound(ContactKind.Base)
    context.currentTime = LINE_S - 0.1
    alarm.sound(ContactKind.Unit)
    expect(context.played()).toEqual([TAKES.lines[ContactKind.Base][0]])
    context.currentTime = LINE_S
    alarm.sound(ContactKind.Unit)
    expect(context.played()).toEqual([TAKES.lines[ContactKind.Base][0], TAKES.horns[0]])
    context.currentTime = LINE_S + HORN_S - 0.1
    alarm.sound(ContactKind.Unit)
    expect(context.played()).toEqual([TAKES.lines[ContactKind.Base][0], TAKES.horns[0]])
  })

  it('stops a sounding alarm when Sounds is turned off, and plays nothing until it is back on', async () => {
    const { alarm, context } = await unlocked()
    alarm.sound(ContactKind.Base)
    alarm.setOn(false)
    expect(context.sources.map((source) => source.stopped)).toEqual([true])
    alarm.sound(ContactKind.Unit)
    expect(context.sources).toHaveLength(1)
    alarm.setOn(true)
    alarm.sound(ContactKind.Unit)
    expect(context.sources).toHaveLength(2)
  })

  it('stays silent without Web Audio', () => {
    vi.unstubAllGlobals()
    const alarm = new Alarm()
    const target = gestures()
    alarm.listen(target)
    expect(() => {
      target.dispatch('pointerup')
      alarm.sound(ContactKind.Base)
    }).not.toThrow()
  })
})
