import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALARM_LINES, Alarm, KLAXON_MS } from './alarm.ts'
import { ContactKind } from './render/radar.ts'

type Voice = { lang: string }

class FakeUtterance {
  lang = ''
  voice: Voice | null = null
  constructor(readonly text: string) {}
}

function param() {
  return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} }
}

class FakeContext {
  static made: FakeContext[] = []
  state = 'suspended'
  currentTime = 0
  destination = {}
  horns = 0
  resumes = 0

  constructor() {
    FakeContext.made.push(this)
  }

  resume() {
    this.resumes += 1
    this.state = 'running'
    return Promise.resolve()
  }

  createOscillator() {
    return {
      type: '',
      frequency: param(),
      connect: <T>(next: T) => next,
      start: () => {
        this.horns += 1
      },
      stop() {},
    }
  }

  createBiquadFilter() {
    return { type: '', frequency: param(), connect: <T>(next: T) => next }
  }

  createGain() {
    return { gain: param(), connect: <T>(next: T) => next }
  }
}

function fakeSpeech(voices: Voice[] = []) {
  const said: FakeUtterance[] = []
  return {
    said,
    speaking: false,
    pending: false,
    getVoices: () => voices,
    speak: (utterance: FakeUtterance) => said.push(utterance),
    cancel() {},
    lines: () => said.filter((utterance) => utterance.text !== '').map((utterance) => utterance.text),
  }
}

function withSpeech(voices: Voice[] = []) {
  const speech = fakeSpeech(voices)
  vi.stubGlobal('speechSynthesis', speech)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  return speech
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('AudioContext', FakeContext)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  FakeContext.made = []
})

describe('alarm', () => {
  it('starts audio and primes speech once, on the first gesture', () => {
    const speech = withSpeech()
    const alarm = new Alarm()
    alarm.unlock()
    alarm.unlock()
    expect(FakeContext.made).toHaveLength(1)
    expect(FakeContext.made[0].resumes).toBe(1)
    expect(speech.said.map((utterance) => utterance.text)).toEqual([''])
  })

  it('sounds the klaxon, then the line for a base or a unit in an en-JM voice', () => {
    const jamaican = { lang: 'en-JM' }
    const speech = withSpeech([{ lang: 'en-US' }, jamaican])
    const alarm = new Alarm()
    alarm.unlock()
    alarm.sound(ContactKind.Base)
    expect(FakeContext.made[0].horns).toBe(1)
    expect(speech.lines()).toEqual([])
    vi.advanceTimersByTime(KLAXON_MS)
    alarm.sound(ContactKind.Unit)
    vi.advanceTimersByTime(KLAXON_MS)
    expect(FakeContext.made[0].horns).toBe(2)
    expect(speech.lines()).toEqual([ALARM_LINES[ContactKind.Base], ALARM_LINES[ContactKind.Unit]])
    expect(speech.said.at(-1)?.voice).toBe(jamaican)
  })

  it('plays nothing once Sounds is off, not even a line already on its way', () => {
    const speech = withSpeech()
    const alarm = new Alarm()
    alarm.unlock()
    alarm.sound(ContactKind.Unit)
    alarm.setOn(false)
    vi.advanceTimersByTime(KLAXON_MS)
    alarm.sound(ContactKind.Base)
    vi.advanceTimersByTime(KLAXON_MS)
    expect(FakeContext.made[0].horns).toBe(1)
    expect(speech.lines()).toEqual([])
  })

  it('never speaks over a line still being spoken', () => {
    const speech = withSpeech()
    speech.speaking = true
    const alarm = new Alarm()
    alarm.sound(ContactKind.Base)
    vi.advanceTimersByTime(KLAXON_MS)
    expect(speech.lines()).toEqual([])
  })

  it('still sounds the klaxon without speech synthesis', () => {
    const alarm = new Alarm()
    alarm.unlock()
    alarm.sound(ContactKind.Base)
    vi.advanceTimersByTime(KLAXON_MS)
    expect(FakeContext.made[0].horns).toBe(1)
  })
})
