import { ContactKind } from './render/radar.ts'

const samples = import.meta.glob('../../assets/alarm/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
})

type Takes<T> = { horns: T[]; lines: Record<ContactKind, T[]> }

export const TAKES: Takes<string> = {
  horns: takes('horn'),
  lines: { [ContactKind.Base]: takes('base'), [ContactKind.Unit]: takes('unit') },
}

/** A touch can start audio only on its release, not its press. */
const GESTURES = ['pointerup', 'keydown']

export class Alarm {
  private context: AudioContext | null = null
  private buffers: Takes<AudioBuffer> | null = null
  private playing: AudioBufferSourceNode | null = null
  private until = 0
  private on = true

  listen(target: Pick<EventTarget, 'addEventListener'>) {
    for (const gesture of GESTURES) target.addEventListener(gesture, () => this.unlock())
  }

  setOn(on: boolean) {
    this.on = on
    if (on) return
    this.playing?.stop()
    this.playing = null
    this.until = 0
  }

  sound(kind: ContactKind) {
    const context = this.context
    if (!this.on || !context || !this.buffers || context.currentTime < this.until) return
    const sample = pick(pick([this.buffers.horns, this.buffers.lines[kind]]))
    this.playing = play(context, sample)
    this.until = context.currentTime + sample.duration
  }

  private unlock() {
    if (!this.context) {
      if (!('AudioContext' in globalThis)) return
      this.context = new AudioContext()
      decode(this.context).then((buffers) => {
        this.buffers = buffers
      })
    }
    if (this.context.state !== 'running') this.context.resume().catch(() => {})
  }
}

function takes(name: string): string[] {
  return Object.entries(samples)
    .filter(([path]) => new RegExp(`/${name}-\\d+\\.mp3$`).test(path))
    .map((entry) => entry[1])
}

async function decode(context: AudioContext): Promise<Takes<AudioBuffer>> {
  const load = (urls: string[]) =>
    Promise.all(urls.map(async (url) => context.decodeAudioData(await (await fetch(url)).arrayBuffer())))
  const [horns, base, unit] = await Promise.all([
    load(TAKES.horns),
    load(TAKES.lines[ContactKind.Base]),
    load(TAKES.lines[ContactKind.Unit]),
  ])
  return { horns, lines: { [ContactKind.Base]: base, [ContactKind.Unit]: unit } }
}

function pick<T>(takes: T[]): T {
  return takes[Math.floor(Math.random() * takes.length)]
}

function play(context: AudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
  return source
}
