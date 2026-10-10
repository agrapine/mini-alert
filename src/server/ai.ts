import { UnitTypeId } from '../shared/unit-types.ts'
import type { Game } from './game.ts'

const MOVE_INTERVAL = 2
export const AI_SPAWN_INTERVAL = 5
export const AI_MAX_UNITS = 20

const SPAWN_TYPES = [UnitTypeId.Scout, UnitTypeId.MedTank, UnitTypeId.HeavyTank, UnitTypeId.Artillery]

export class AiPlayer {
  private moveElapsed = 0
  private spawnElapsed = 0
  private spawnCursor = 0

  constructor(
    private readonly playerId: number,
    private readonly game: Game,
  ) {}

  update(dt: number) {
    this.moveElapsed += dt
    this.spawnElapsed += dt
    if (this.moveElapsed >= MOVE_INTERVAL) {
      this.moveElapsed = 0
      this.orderWander()
    }
    if (this.spawnElapsed >= AI_SPAWN_INTERVAL) {
      this.spawnElapsed = 0
      this.reinforce()
    }
  }

  private orderWander() {
    const living = this.game.units.filter((unit) => unit.ownerId === this.playerId)
    if (living.length === 0) return
    const unit = living[Math.floor(Math.random() * living.length)]
    const tile = {
      x: Math.floor(Math.random() * this.game.world.width),
      y: Math.floor(Math.random() * this.game.world.height),
    }
    this.game.orderMove(this.playerId, unit.id, tile)
  }

  private reinforce() {
    const living = this.game.units.filter((unit) => unit.ownerId === this.playerId).length
    if (living >= AI_MAX_UNITS) return
    const typeId = SPAWN_TYPES[this.spawnCursor % SPAWN_TYPES.length]
    const facing = this.game.units.find((unit) => unit.ownerId === this.playerId)?.facing ?? Math.PI / 2
    if (!this.game.trySpawn(this.playerId, typeId, facing)) return
    this.spawnCursor += 1
  }
}
