import { ContactKind } from './render/radar.ts'

export const ALARM_LINES: Record<ContactKind, string> = {
  [ContactKind.Base]: 'Wi base a get attack!',
  [ContactKind.Unit]: 'Unit a get lick!',
}

const KLAXON_HZ = [784, 587]
const KLAXON_BEAT_S = 0.22
const KLAXON_BEATS = 4
const KLAXON_FADE_S = 0.015
const KLAXON_VOLUME = 0.15
const KLAXON_TONE_HZ = 2400
export const KLAXON_MS = KLAXON_BEAT_S * KLAXON_BEATS * 1000

export class Alarm {
  private context: AudioContext | null = null
  private readonly speech = 'speechSynthesis' in globalThis ? speechSynthesis : null
  private primed = false
  private on = true

  setOn(on: boolean) {
    this.on = on
    if (!on) this.speech?.cancel()
  }

  /** Runs inside a user gesture: browsers start audio, and iOS starts speech, only from one. */
  unlock() {
    this.context ??= new AudioContext()
    if (this.context.state !== 'running') this.context.resume().catch(() => {})
    if (this.primed || !this.speech) return
    this.primed = true
    this.speech.speak(new SpeechSynthesisUtterance(''))
  }

  sound(kind: ContactKind) {
    if (!this.on) return
    if (this.context) klaxon(this.context)
    setTimeout(() => this.say(ALARM_LINES[kind]), KLAXON_MS)
  }

  private say(line: string) {
    const speech = this.speech
    if (!speech || !this.on || speech.speaking || speech.pending) return
    const utterance = new SpeechSynthesisUtterance(line)
    utterance.lang = 'en-JM'
    utterance.voice = speech.getVoices().find((voice) => /^en[-_]JM$/i.test(voice.lang)) ?? null
    speech.speak(utterance)
  }
}

function klaxon(context: AudioContext) {
  const start = context.currentTime
  const end = start + KLAXON_BEAT_S * KLAXON_BEATS
  const horn = context.createOscillator()
  horn.type = 'sawtooth'
  for (let beat = 0; beat < KLAXON_BEATS; beat++) {
    horn.frequency.setValueAtTime(KLAXON_HZ[beat % KLAXON_HZ.length], start + beat * KLAXON_BEAT_S)
  }
  const tone = context.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = KLAXON_TONE_HZ
  const level = context.createGain()
  level.gain.setValueAtTime(0, start)
  level.gain.linearRampToValueAtTime(KLAXON_VOLUME, start + KLAXON_FADE_S)
  level.gain.setValueAtTime(KLAXON_VOLUME, end - KLAXON_FADE_S)
  level.gain.linearRampToValueAtTime(0, end)
  horn.connect(tone).connect(level).connect(context.destination)
  horn.start(start)
  horn.stop(end)
}
