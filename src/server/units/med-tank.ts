import type { TileCoord } from '../../shared/tiles.ts'
import type { UnitType } from '../../shared/unit-types.ts'
import { approach, clamp, wrapAngle } from '../sim/drive.ts'
import { Unit } from './unit.ts'

export class MedTank extends Unit {
  constructor(id: number, ownerId: number, type: UnitType, tile: TileCoord, facing: number) {
    super(id, ownerId, type, tile, facing)
  }

  drive(dt: number) {
    const aim = this.aimPoint()
    if (!aim) return
    const err = this.headingError(aim)
    const step = clamp(err, -this.type.turnRate * dt, this.type.turnRate * dt)
    this.facing = wrapAngle(this.facing + step)
    const align = 1 - Math.min(1, Math.abs(err) / Math.PI) * 0.5
    this.speed = approach(this.speed, this.cruiseSpeed(1) * align, this.type.acceleration * dt)
  }
}
