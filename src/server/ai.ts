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
    const living = this.game.units.filter((unit) => unit.ownerId === this.playerId && unit.type.topSpeed > 0)
    if (living.length === 0) return
    const unit = living[Math.floor(Math.random() * living.length)]
    const tile = {
      x: Math.floor(Math.random() * this.game.world.width),
      y: Math.floor(Math.random() * this.game.world.height),
    }
    this.game.orderMove(this.playerId, unit.id, tile)
  }

  private reinforce() {
    if (!this.game.hasFinishedFactory(this.playerId)) {
      if (!this.game.units.some((unit) => unit.ownerId === this.playerId && unit.typeId === UnitTypeId.Factory && unit.health > 0)) {
        this.game.placeNearAnchor(this.playerId, UnitTypeId.Factory)
      }
      return
    }
    const living = this.game.units.filter(
      (unit) => unit.ownerId === this.playerId && unit.type.topSpeed > 0,
    ).length
    if (living + this.game.trainingCount(this.playerId) >= AI_MAX_UNITS) return
    const typeId = SPAWN_TYPES[this.spawnCursor % SPAWN_TYPES.length]
    if (!this.game.trySpawn(this.playerId, typeId)) return
    this.spawnCursor += 1
  }
}
