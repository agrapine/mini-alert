import type { TileCoord } from '../../shared/tiles.ts'
import type { UnitType } from '../../shared/unit-types.ts'
import { approach, clamp, wrapAngle } from '../sim/drive.ts'
import { Unit } from './unit.ts'

const BEHIND = (Math.PI * 2) / 3

export class Scout extends Unit {
  constructor(id: number, ownerId: number, type: UnitType, tile: TileCoord, facing: number) {
    super(id, ownerId, type, tile, facing)
  }

  drive(dt: number) {
    const aim = this.aimPoint()
    if (!aim) return
    const desired = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z)
    const noseErr = wrapAngle(desired - this.facing)
    const reverse = Math.abs(noseErr) > BEHIND
    const moveHeading = this.speed < -0.02 ? wrapAngle(this.facing + Math.PI) : this.facing
    const err = wrapAngle(desired - moveHeading)
    const steerSign = this.speed < 0 ? -1 : 1
    const steer = clamp(err * steerSign, -this.type.maxSteer, this.type.maxSteer)
    if (Math.abs(this.speed) > 0.02) {
      const yaw = (this.speed / this.type.wheelbase) * Math.tan(steer)
      this.facing = wrapAngle(this.facing + yaw * dt)
    }
    this.speed = approach(this.speed, this.cruiseSpeed(reverse ? -1 : 1), this.type.acceleration * dt)
  }
}
