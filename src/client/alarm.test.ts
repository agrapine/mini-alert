import { readdirSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Alarm, TAKES } from './alarm.ts'
import { ContactKind } from './render/radar.ts'

const HORN_S = 2
const LINE_S = 1.5

type FakeBuffer = { url: string; duration: number }

class FakeSource {
  buffer: FakeBuffer | null = null
  at: number | null = null
  stopped = false

  connect() {}

  start(when: number) {
    this.at = when
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
    return this.sources.map((source) => [source.buffer?.url, source.at])
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

  it('plays a horn, then the line for a base or a unit', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { alarm, context } = await unlocked()
    alarm.sound(ContactKind.Base)
    context.currentTime = 10
    alarm.sound(ContactKind.Unit)
    expect(context.played()).toEqual([
      [TAKES.horns[0], 0],
      [TAKES.lines[ContactKind.Base][0], HORN_S],
      [TAKES.horns[0], 10],
      [TAKES.lines[ContactKind.Unit][0], 10 + HORN_S],
    ])
  })

  it('draws every horn, and every take of the line for what was hit, at random', async () => {
    const files = readdirSync(new URL('../../assets/alarm/', import.meta.url))
    const named = (name: string) => new Set(files.filter((file) => file.startsWith(`${name}-`)))
    const { alarm, context } = await unlocked()
    const heard = (from: number, nth: number) =>
      new Set(context.sources.slice(from).filter((_, i) => i % 2 === nth).map((source) => source.buffer?.url.split('/').pop()))
    const draws = 40
    const lines = new Map<ContactKind, Set<string | undefined>>()
    for (const kind of [ContactKind.Base, ContactKind.Unit]) {
      const from = context.sources.length
      for (let draw = 0; draw < draws; draw++) {
        vi.spyOn(Math, 'random').mockReturnValue(draw / draws)
        alarm.sound(kind)
        context.currentTime += HORN_S + LINE_S
      }
      lines.set(kind, heard(from, 1))
    }
    const horns = heard(0, 0)
    expect(horns).toEqual(named('horn'))
    expect(lines.get(ContactKind.Base)).toEqual(named('base'))
    expect(lines.get(ContactKind.Unit)).toEqual(named('unit'))
    expect(horns.size + named('base').size + named('unit').size).toBe(files.length)
  })

  it('never starts over an alarm still sounding', async () => {
    const { alarm, context } = await unlocked()
    alarm.sound(ContactKind.Base)
    context.currentTime = HORN_S + LINE_S - 0.1
    alarm.sound(ContactKind.Unit)
    expect(context.sources).toHaveLength(2)
    context.currentTime = HORN_S + LINE_S
    alarm.sound(ContactKind.Unit)
    expect(context.sources).toHaveLength(4)
  })

  it('stops a sounding alarm when Sounds is turned off, and plays nothing until it is back on', async () => {
    const { alarm, context } = await unlocked()
    alarm.sound(ContactKind.Base)
    alarm.setOn(false)
    expect(context.sources.map((source) => source.stopped)).toEqual([true, true])
    alarm.sound(ContactKind.Unit)
    expect(context.sources).toHaveLength(2)
    alarm.setOn(true)
    alarm.sound(ContactKind.Unit)
    expect(context.sources).toHaveLength(4)
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
