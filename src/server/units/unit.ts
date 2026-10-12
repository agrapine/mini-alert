import { driveMotion, MotionResult, stepMotion, type MotionState } from '../../shared/motion.ts'
import { tileCenter, type TileCoord } from '../../shared/tiles.ts'
import type { UnitType } from '../../shared/unit-types.ts'
import type { PathFinder } from '../path/pathfinder.ts'
import { clamp, wrapAngle } from '../sim/drive.ts'
import { redirect } from '../sim/steering.ts'

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
  attackId: number | null = null
  attackPoint: { x: number; z: number } | null = null
  path: TileCoord[] = []
  route = 0
  progress = 1
  bill: number

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
    this.bill = type.cost
  }

  drive(dt: number): void {
    const state = motionOf(this)
    driveMotion(state, this.type, dt)
    this.facing = state.facing
    this.speed = state.speed
  }

  commitPath(path: readonly TileCoord[]): void {
    if (samePath(this.path, path)) return
    this.path = path.map((tile) => ({ x: tile.x, y: tile.y }))
    this.route++
  }

  orderMove(tile: TileCoord, paths: PathFinder): boolean {
    if (this.type.topSpeed <= 0) return false
    const path = paths.findPath(this.tile, tile, this.id)
    if (path === null) return false
    this.commitPath(path)
    return true
  }

  step(dt: number, paths: PathFinder, units: readonly Unit[]) {
    if (this.type.topSpeed <= 0) return
    this.pursue(dt, paths, units)
    if (this.path.length > 0) {
      const next = this.path[0]
      if (!paths.isWalkable(next.x, next.y, this.id)) redirect(this, paths, units)
    }

    const state = motionOf(this)
    const stalled = this.speed === 0
    const occupied = (x: number, y: number) => !paths.isWalkable(x, y, this.id)
    const result = stepMotion(state, this.type, dt, occupied)
    if (result === MotionResult.Denied) {
      this.speed = 0
      this.facing = state.facing
      if (!stalled) this.route++
      redirect(this, paths, units)
      return
    }
    const entered = { x: state.tileX, y: state.tileY }
    const changing = entered.x !== this.tile.x || entered.y !== this.tile.y
    if (changing && !paths.claim(this, entered, this.type.footprint)) {
      this.speed = 0
      this.facing = state.facing
      if (!stalled) this.route++
      redirect(this, paths, units)
      return
    }
    this.pos.x = state.x
    this.pos.z = state.z
    this.facing = state.facing
    this.speed = state.speed
    this.path = state.path
  }

  private pursue(dt: number, paths: PathFinder, units: readonly Unit[]) {
    if (this.attackPoint) {
      this.pursuePoint(dt, paths)
      return
    }
    if (this.attackId === null) return
    const target = units.find((unit) => unit.id === this.attackId)
    if (!target || target.health <= 0 || target.ownerId === this.ownerId) {
      this.attackId = null
      return
    }
    const dist = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z)
    const range = this.type.weapon.range
    if (dist <= range) {
      this.commitPath([])
      if (this.type.weapon.turretRate === 0) this.face(target, dt)
      return
    }
    const goal = this.path[this.path.length - 1]
    const goalCenter = goal ? tileCenter(goal) : null
    const goalHolds =
      goalCenter !== null && Math.hypot(goalCenter.x - target.pos.x, goalCenter.z - target.pos.z) <= range
    if (goalHolds) return
    const tile = approachTile(this, target, paths)
    if (!tile) return
    if (goal && goal.x === tile.x && goal.y === tile.y) return
    this.orderMove(tile, paths)
  }

  private pursuePoint(dt: number, paths: PathFinder) {
    const point = this.attackPoint
    if (!point) return
    const dist = Math.hypot(point.x - this.pos.x, point.z - this.pos.z)
    const range = this.type.weapon.range
    if (dist <= range || this.type.topSpeed <= 0) {
      this.commitPath([])
      if (this.type.weapon.turretRate === 0) this.facePoint(point, dt)
      return
    }
    const goal = this.path[this.path.length - 1]
    const goalCenter = goal ? tileCenter(goal) : null
    const goalHolds = goalCenter !== null && Math.hypot(goalCenter.x - point.x, goalCenter.z - point.z) <= range
    if (goalHolds) return
    const tile = approachPoint(this, point, paths)
    if (!tile) return
    if (goal && goal.x === tile.x && goal.y === tile.y) return
    this.orderMove(tile, paths)
  }

  private facePoint(point: { x: number; z: number }, dt: number) {
    const desired = Math.atan2(point.x - this.pos.x, point.z - this.pos.z)
    const err = wrapAngle(desired - this.facing)
    this.facing = wrapAngle(this.facing + clamp(err, -2.5 * dt, 2.5 * dt))
  }

  private face(target: Unit, dt: number) {
    const desired = Math.atan2(target.pos.x - this.pos.x, target.pos.z - this.pos.z)
    const err = wrapAngle(desired - this.facing)
    this.facing = wrapAngle(this.facing + clamp(err, -2.5 * dt, 2.5 * dt))
  }

}

function motionOf(unit: Unit): MotionState {
  return {
    x: unit.pos.x,
    z: unit.pos.z,
    facing: unit.facing,
    speed: unit.speed,
    tileX: unit.tile.x,
    tileY: unit.tile.y,
    path: unit.path,
  }
}

function samePath(left: readonly TileCoord[], right: readonly TileCoord[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i].x !== right[i].x || left[i].y !== right[i].y) return false
  }
  return true
}

function approachPoint(unit: Unit, point: { x: number; z: number }, paths: PathFinder): TileCoord | null {
  const range = unit.type.weapon.range
  const reach = Math.ceil(range) + 1
  const tx = Math.floor(point.x)
  const ty = Math.floor(point.z)
  let best: TileCoord | null = null
  let bestScore = Infinity
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const tile = { x: tx + dx, y: ty + dy }
      if (!paths.isWalkable(tile.x, tile.y, unit.id)) continue
      const center = tileCenter(tile)
      const toTarget = Math.hypot(center.x - point.x, center.z - point.z)
      if (toTarget > range) continue
      const toSelf = Math.hypot(center.x - unit.pos.x, center.z - unit.pos.z)
      if (toSelf >= bestScore) continue
      best = tile
      bestScore = toSelf
    }
  }
  return best
}

function approachTile(unit: Unit, target: Unit, paths: PathFinder): TileCoord | null {
  const range = unit.type.weapon.range
  const reach = Math.ceil(range) + 1
  let best: TileCoord | null = null
  let bestScore = Infinity
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const tile = { x: target.tile.x + dx, y: target.tile.y + dy }
      if (!paths.isWalkable(tile.x, tile.y, unit.id)) continue
      const center = tileCenter(tile)
      const toTarget = Math.hypot(center.x - target.pos.x, center.z - target.pos.z)
      const toSelf = Math.hypot(center.x - unit.pos.x, center.z - unit.pos.z)
      const score = toTarget <= range ? toSelf : toSelf + 1000 + toTarget
      if (score >= bestScore) continue
      best = tile
      bestScore = score
    }
  }
  return best
}
