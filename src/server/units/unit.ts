import { tileCenter, type TileCoord } from '../../shared/tiles.ts'
import type { UnitType } from '../../shared/unit-types.ts'
import type { PathFinder } from '../path/pathfinder.ts'
import { approach, wrapAngle } from '../sim/drive.ts'
import { redirect } from '../sim/steering.ts'

const ARRIVE = 0.38

export abstract class Unit {
  id: number
  ownerId: number
  typeId: UnitType['id']
  readonly type: UnitType
  pos: { x: number; z: number }
  tile: TileCoord
  facing: number
  turretYaw: number
  speed = 0
  health: number
  rounds: number
  cooldown = 0
  sinceShot = 0
  path: TileCoord[] = []

  constructor(id: number, ownerId: number, type: UnitType, tile: TileCoord, facing: number) {
    this.id = id
    this.ownerId = ownerId
    this.type = type
    this.typeId = type.id
    this.pos = tileCenter(tile)
    this.tile = { x: tile.x, y: tile.y }
    this.facing = facing
    this.turretYaw = facing
    this.health = type.maxHealth
    this.rounds = type.weapon.magazine
  }

  abstract drive(dt: number): void

  orderMove(tile: TileCoord, paths: PathFinder): boolean {
    const path = paths.findPath(this.tile, tile, this.id)
    if (path === null) return false
    this.path = path
    return true
  }

  step(dt: number, paths: PathFinder, units: readonly Unit[]) {
    if (this.path.length === 0) {
      this.speed = approach(this.speed, 0, this.type.acceleration * dt)
      this.integrate(dt, paths, units)
      return
    }

    const next = this.path[0]
    if (!paths.isWalkable(next.x, next.y, this.id) && !redirect(this, paths, units)) {
      this.speed = approach(this.speed, 0, this.type.acceleration * dt)
      return
    }

    this.drive(dt)
    this.integrate(dt, paths, units)
    this.consumeWaypoints()
  }

  protected aimPoint(): { x: number; z: number } | null {
    if (this.path.length === 0) return null
    let index = 0
    while (index < this.path.length - 1) {
      const prev = index === 0 ? this.tile : this.path[index - 1]
      const curr = this.path[index]
      const next = this.path[index + 1]
      const same =
        curr.x - prev.x === next.x - curr.x && curr.y - prev.y === next.y - curr.y
      if (!same) break
      index++
    }
    return tileCenter(this.path[index])
  }

  protected headingError(aim: { x: number; z: number }): number {
    const desired = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z)
    return wrapAngle(desired - this.facing)
  }

  protected cruiseSpeed(direction: number): number {
    const goal = this.path[this.path.length - 1]
    if (!goal) return 0
    const center = tileCenter(goal)
    const dist = Math.hypot(center.x - this.pos.x, center.z - this.pos.z)
    let mag = this.type.topSpeed
    const stopping = (this.speed * this.speed) / (2 * this.type.acceleration)
    if (dist < stopping + 0.2) mag = Math.min(mag, Math.max(0.45, dist * 1.6))
    return mag * direction
  }

  private integrate(dt: number, paths: PathFinder, units: readonly Unit[]) {
    const dist = this.speed * dt
    if (Math.abs(dist) < 1e-8) return
    const nx = this.pos.x + Math.sin(this.facing) * dist
    const nz = this.pos.z + Math.cos(this.facing) * dist
    const entered = { x: Math.floor(nx), y: Math.floor(nz) }
    const changing = entered.x !== this.tile.x || entered.y !== this.tile.y
    if (changing && !paths.claim(this, entered, this.type.footprint)) {
      this.speed = 0
      redirect(this, paths, units)
      return
    }
    this.pos.x = nx
    this.pos.z = nz
  }

  private consumeWaypoints() {
    const dir = this.speed < -0.02 ? -1 : 1
    const hx = Math.sin(this.facing) * dir
    const hz = Math.cos(this.facing) * dir
    while (this.path.length > 0) {
      const center = tileCenter(this.path[0])
      const dx = center.x - this.pos.x
      const dz = center.z - this.pos.z
      const dist = Math.hypot(dx, dz)
      const ahead = dx * hx + dz * hz
      if (this.path.length === 1) {
        if (dist < ARRIVE && Math.abs(this.speed) < 0.85) this.path.shift()
        break
      }
      const onTile = Math.floor(this.pos.x) === this.path[0].x && Math.floor(this.pos.z) === this.path[0].y
      if (dist < 0.4 || (onTile && ahead < 0.15) || (ahead < -0.05 && dist < 0.85)) {
        this.path.shift()
        continue
      }
      break
    }
  }
}
