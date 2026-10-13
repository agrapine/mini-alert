import { consider, type Brain, type Thought } from './scenarios.ts'
import { clampAiPace, AI_PACE_DEFAULT } from '../shared/lobby.ts'
import { ClientMessageKind, type ClientPort } from '../shared/protocol.ts'
import { Replica } from '../client/replica.ts'

const THINK_SECONDS = 1.6

export class AiPlayer {
  private readonly replica = new Replica()
  private pace = AI_PACE_DEFAULT
  private elapsed = 0
  lastThought: Thought | null = null
  thinks = 0

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
    }
    const budget = Math.max(1, Math.round(this.pace * 2))
    const thought = consider(brain, budget)
    this.lastThought = thought
    this.thinks += 1
    for (const order of thought.orders) this.port.send(order)
  }
}
