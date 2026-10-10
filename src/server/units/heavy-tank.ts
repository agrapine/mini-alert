import type { TileCoord } from '../../shared/tiles.ts'
import type { UnitType } from '../../shared/unit-types.ts'
import { approach, clamp, wrapAngle } from '../sim/drive.ts'
import { Unit } from './unit.ts'

export class HeavyTank extends Unit {
  constructor(id: number, ownerId: number, type: UnitType, tile: TileCoord, facing: number) {
    super(id, ownerId, type, tile, facing)
  }

  drive(dt: number) {
    const aim = this.aimPoint()
    if (!aim) return
    const err = this.headingError(aim)
    const step = clamp(err, -this.type.turnRate * dt, this.type.turnRate * dt)
    this.facing = wrapAngle(this.facing + step)
    const commit = Math.abs(err) > 0.8 ? 0.3 : 1
    this.speed = approach(this.speed, this.cruiseSpeed(1) * commit, this.type.acceleration * dt)
  }
}
