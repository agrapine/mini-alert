import { consider, type Brain } from './scenarios.ts'
import { clampAiPace, AI_PACE_DEFAULT } from '../shared/lobby.ts'
import {
  ServerMessageKind,
  type CityState,
  type ClientPort,
  type ServerMessage,
  type TrainJob,
  type UnitSnapshot,
  type WorldSnapshot,
} from '../shared/protocol.ts'

const THINK_SECONDS = 1.6

export class AiPlayer {
  private seenId = 0
  private world: WorldSnapshot | null = null
  private units: UnitSnapshot[] = []
  private training: TrainJob[] = []
  private cities: CityState[] = []
  private credits = 0
  private pace = AI_PACE_DEFAULT
  private elapsed = 0

  get playerId(): number {
    return this.seenId
  }

  constructor(private readonly port: ClientPort) {
    this.port.onServer((message) => this.hear(message))
  }

  setPace(pace: number) {
    this.pace = clampAiPace(pace)
  }

  update(dt: number) {
    this.elapsed += dt
    if (this.elapsed < THINK_SECONDS / this.pace) return
    this.elapsed = 0
    this.act()
  }

  private act() {
    const world = this.world
    if (!world || this.seenId === 0) return
    const brain: Brain = {
      playerId: this.seenId,
      width: world.width,
      height: world.height,
      seed: world.seed,
      credits: this.credits,
      towns: world.towns,
      units: this.units,
      training: this.training,
      cities: this.cities,
      terrain: world.terrain,
    }
    const budget = Math.max(1, Math.round(this.pace * 2))
    for (const order of consider(brain, budget)) this.port.send(order)
  }

  private hear(message: ServerMessage) {
    if (message.kind === ServerMessageKind.Welcome) {
      this.seenId = message.playerId
      return
    }
    if (message.kind === ServerMessageKind.World) {
      this.world = message
      return
    }
    if (message.kind === ServerMessageKind.Units) {
      this.units = message.units
      this.credits = message.credits
      this.training = message.training
      this.cities = message.cities
    }
  }
}
