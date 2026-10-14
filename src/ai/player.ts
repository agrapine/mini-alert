import { consider, type Brain, type Mood, type Thought } from './scenarios.ts'
import { clampAiPace, AI_PACE_DEFAULT } from '../shared/lobby.ts'
import { SIM_STEP } from '../shared/motion.ts'
import { ClientMessageKind, type ClientPort } from '../shared/protocol.ts'
import { Replica } from '../client/replica.ts'

const THINK_SECONDS = 1.6

export class AiPlayer {
  private readonly replica = new Replica()
  private pace = AI_PACE_DEFAULT
  private elapsed = 0
  lastThought: Thought | null = null
  thinks = 0
  private mood: Mood = { now: 0, pop: -1, popAt: 0, plan: 0, atX: -1, atY: -1, planAt: 0, salt: 0, banX: -1, banY: -1, near: 1e9 }

  get playerId(): number {
    return this.replica.playerId ?? 0
  }

  constructor(private readonly port: ClientPort) {
    this.port.onServer((message) => this.replica.apply(message))
  }

  setPace(pace: number) {
    this.pace = clampAiPace(pace)
  }

  update(dt: number) {
    if (this.replica.advance(dt)) this.port.send({ kind: ClientMessageKind.RequestSnapshot })
    this.elapsed += dt
    if (this.elapsed < THINK_SECONDS / this.pace) return
    this.elapsed = 0
    this.act()
  }

  private act() {
    const world = this.replica.world
    const playerId = this.replica.playerId
    if (!world || playerId === null) return
    const brain: Brain = {
      playerId,
      width: world.width,
      height: world.height,
      seed: world.seed,
      credits: this.replica.credits,
      towns: world.towns,
      units: this.replica.units,
      training: this.replica.training,
      cities: this.replica.cities,
      terrain: world.terrain,
      known: world.known,
      layouts: this.replica.settledLayouts(),
      mood: { ...this.mood, now: this.replica.localTick * SIM_STEP },
    }
    const budget = Math.max(8, Math.round(this.pace * 8))
    const thought = consider(brain, budget)
    this.mood = thought.mood
    this.lastThought = thought
    this.thinks += 1
    for (const order of thought.orders) this.port.send(order)
  }
}
