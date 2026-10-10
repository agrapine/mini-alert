import type { MapPoint, ShotEvent, TrainJob, UnitSnapshot } from '../shared/protocol.ts'
import type { TileCoord } from '../shared/tiles.ts'
import { UNIT_TYPES, UnitTypeId } from '../shared/unit-types.ts'
import { PathFinder } from './path/pathfinder.ts'
import { CREDIT_INCOME, Player } from './player.ts'
import { createUnit } from './units/create.ts'
import { Unit } from './units/unit.ts'
import { applyImpacts, engage, type Impact } from './sim/combat.ts'
import type { World } from './world.ts'

export type Scenery = {
  coast: MapPoint[]
  holes: MapPoint[][]
  roads: MapPoint[][]
  towns: MapPoint[]
  seed: number
}

const EMPTY_SCENERY: Scenery = { coast: [], holes: [], roads: [], towns: [], seed: 0 }
const SPAWN_STEPS: TileCoord[] = [
  { x: 0, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: 0, y: 2 },
  { x: 0, y: -2 },
  { x: 2, y: 0 },
]

const SPAWN_REACH = 8

function spawnSteps(): TileCoord[] {
  const steps = [...SPAWN_STEPS]
  const seen = new Set(steps.map((step) => `${step.x},${step.y}`))
  for (let radius = 0; radius <= SPAWN_REACH; radius++) {
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== radius) continue
        const key = `${x},${y}`
        if (seen.has(key)) continue
        seen.add(key)
        steps.push({ x, y })
      }
    }
  }
  return steps
}

export class Game {
  readonly world: World
  readonly pathfinder: PathFinder
  readonly units: Unit[] = []
  private readonly players = new Map<number, Player>()
  private nextUnitId = 1
  private nextPlayerId = 1
  private readonly spawnAnchors = new Map<number, TileCoord>()
  private impacts: Impact[] = []
  private time = 0
  private deaths: Unit[] = []
  private readonly jobs = new Map<number, number[]>()
  private readonly training = new Map<number, TrainJob[]>()
  scenery: Scenery = EMPTY_SCENERY

  constructor(world: World) {
    this.world = world
    this.pathfinder = new PathFinder(world)
  }

  addPlayer(): Player {
    const player = new Player(this.nextPlayerId++)
    this.players.set(player.id, player)
    return player
  }

  player(id: number): Player | undefined {
    return this.players.get(id)
  }

  setSpawnAnchor(playerId: number, tile: TileCoord) {
    this.spawnAnchors.set(playerId, tile)
  }

  hasFinishedFactory(playerId: number): boolean {
    return this.units.some(
      (unit) =>
        unit.ownerId === playerId &&
        unit.typeId === UnitTypeId.Factory &&
        unit.health > 0 &&
        unit.progress >= 1,
    )
  }

  placeBuilding(playerId: number, typeId: UnitTypeId, tile: TileCoord): boolean {
    const owner = this.players.get(playerId)
    const type = UNIT_TYPES[typeId]
    if (!owner || type.topSpeed > 0) return false
    if (owner.credits < type.cost) return false
    if (!this.footprintFree(tile, type.footprint)) return false
    owner.credits -= type.cost
    const unit = this.spawn(owner, typeId, tile, 0)
    unit.progress = 0
    const queue = this.jobs.get(playerId) ?? []
    queue.push(unit.id)
    this.jobs.set(playerId, queue)
    return true
  }

  placeNearAnchor(playerId: number, typeId: UnitTypeId): boolean {
    const anchor = this.spawnAnchors.get(playerId)
    if (!anchor) return false
    for (const step of spawnSteps()) {
      const tile = { x: anchor.x + step.x, y: anchor.y + step.y }
      if (this.placeBuilding(playerId, typeId, tile)) return true
    }
    return false
  }

  finishBuild(playerId: number) {
    const queue = this.jobs.get(playerId)
    const id = queue?.[0]
    if (id === undefined) return
    const unit = this.units.find((candidate) => candidate.id === id)
    if (unit) unit.progress = 1
    queue?.shift()
    if (queue && queue.length === 0) this.jobs.delete(playerId)
  }

  trainingFor(playerId: number): TrainJob[] {
    return (this.training.get(playerId) ?? []).map((job) => ({ typeId: job.typeId, progress: job.progress }))
  }

  trainingCount(playerId: number): number {
    return this.training.get(playerId)?.length ?? 0
  }

  trySpawn(playerId: number, typeId: UnitTypeId): boolean {
    const owner = this.players.get(playerId)
    const type = UNIT_TYPES[typeId]
    if (!owner || type.topSpeed <= 0 || !this.hasFinishedFactory(playerId) || owner.credits < type.cost) return false
    owner.credits -= type.cost
    const queue = this.training.get(playerId) ?? []
    queue.push({ typeId, progress: 0 })
    this.training.set(playerId, queue)
    return true
  }

  spawn(owner: Player, typeId: UnitTypeId, tile: TileCoord, facing = 0): Unit {
    const type = UNIT_TYPES[typeId]
    if (!this.footprintFree(tile, type.footprint)) {
      throw new Error(`cannot spawn on ${tile.x},${tile.y}`)
    }
    const unit = createUnit(this.nextUnitId++, owner.id, type, tile, facing)
    const span = type.footprint
    unit.pos = { x: tile.x + span / 2, z: tile.y + span / 2 }
    this.units.push(unit)
    owner.addUnit(unit.id)
    this.fillFootprint(unit)
    return unit
  }

  orderMove(playerId: number, unitId: number, tile: TileCoord): boolean {
    const unit = this.owned(playerId, unitId)
    if (!unit) return false
    unit.attackId = null
    return unit.orderMove(tile, this.pathfinder)
  }

  orderAttack(playerId: number, unitId: number, targetId: number): boolean {
    const unit = this.owned(playerId, unitId)
    const target = this.units.find((candidate) => candidate.id === targetId)
    if (!unit || !target || target.id === unit.id || target.ownerId === unit.ownerId || target.health <= 0) {
      return false
    }
    unit.attackId = target.id
    unit.step(0, this.pathfinder, this.units)
    return true
  }

  tick(dt: number): ShotEvent[] {
    for (const player of this.players.values()) player.credits += CREDIT_INCOME * dt
    this.advanceBuilds(dt)
    for (const unit of this.units) {
      if (unit.health <= 0) continue
      unit.step(dt, this.pathfinder, this.units)
    }
    this.time += dt
    const shots = engage(this.units, dt, this.time, this.impacts)
    applyImpacts(this.units, this.impacts, this.time)
    this.removeDead()
    this.advanceTraining(dt)
    return shots
  }

  unitSnapshots(): UnitSnapshot[] {
    return this.units.map((unit) => this.snapshot(unit))
  }

  takeDeaths(): UnitSnapshot[] {
    const snapshots = this.deaths.map((unit) => this.snapshot(unit))
    this.deaths = []
    return snapshots
  }

  private owned(playerId: number, unitId: number): Unit | undefined {
    const player = this.players.get(playerId)
    if (!player?.owns(unitId)) return undefined
    return this.units.find((candidate) => candidate.id === unitId)
  }

  private removeDead() {
    this.deaths = []
    for (const unit of this.units) {
      if (unit.health > 0) continue
      this.pathfinder.release(unit)
      this.clearJob(unit.id)
      this.deaths.push(unit)
    }
    this.units.splice(0, this.units.length, ...this.units.filter((unit) => unit.health > 0))
  }

  private snapshot(unit: Unit): UnitSnapshot {
    return {
      id: unit.id,
      typeId: unit.typeId,
      ownerId: unit.ownerId,
      color: this.player(unit.ownerId)?.color ?? 0xffffff,
      x: unit.pos.x,
      z: unit.pos.z,
      facing: unit.facing,
      turretYaw: unit.type.weapon.turretRate > 0 ? unit.turretYaw : unit.facing,
      health: unit.health,
      tileX: unit.tile.x,
      tileY: unit.tile.y,
      goal: unit.path.length > 0 ? unit.path[unit.path.length - 1] : null,
      progress: unit.progress,
    }
  }

  private advanceBuilds(dt: number) {
    for (const [playerId, queue] of this.jobs) {
      let left = dt
      while (queue.length > 0 && left > 0) {
        const unit = this.units.find((candidate) => candidate.id === queue[0])
        if (!unit || unit.health <= 0) {
          queue.shift()
          continue
        }
        const duration = unit.type.buildTime
        const need = (1 - unit.progress) * duration
        if (need > left) {
          unit.progress += left / duration
          break
        }
        left -= need
        unit.progress = 1
        queue.shift()
      }
      if (queue.length === 0) this.jobs.delete(playerId)
    }
  }

  private advanceTraining(dt: number) {
    for (const [playerId, queue] of this.training) {
      let left = dt
      while (queue.length > 0 && left > 0) {
        const job = queue[0]
        if (job.progress >= 1) {
          if (!this.releaseTrainee(playerId, job.typeId)) break
          queue.shift()
          continue
        }
        const duration = UNIT_TYPES[job.typeId].buildTime
        const need = (1 - job.progress) * duration
        if (need > left) {
          job.progress += left / duration
          break
        }
        left -= need
        job.progress = 1
        if (!this.releaseTrainee(playerId, job.typeId)) break
        queue.shift()
      }
      if (queue.length === 0) this.training.delete(playerId)
    }
  }

  private releaseTrainee(playerId: number, typeId: UnitTypeId): boolean {
    const owner = this.players.get(playerId)
    if (!owner) return false
    const factory = this.units.find(
      (unit) =>
        unit.ownerId === playerId &&
        unit.typeId === UnitTypeId.Factory &&
        unit.health > 0 &&
        unit.progress >= 1,
    )
    if (!factory) return false
    const exit = this.exitTile(factory)
    if (!exit) return false
    const unit = this.spawn(owner, typeId, exit.tile, exit.facing)
    if (exit.rally.x !== exit.tile.x || exit.rally.y !== exit.tile.y) unit.orderMove(exit.rally, this.pathfinder)
    return true
  }

  private footprintFree(origin: TileCoord, footprint: number): boolean {
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        if (!this.pathfinder.isWalkable(origin.x + dx, origin.y + dy, -1)) return false
      }
    }
    return footprint > 0
  }

  private fillFootprint(unit: Unit) {
    const span = unit.type.footprint
    for (let dy = 0; dy < span; dy++) {
      for (let dx = 0; dx < span; dx++) {
        this.pathfinder.setOccupant(unit.tile.x + dx, unit.tile.y + dy, unit.id)
      }
    }
  }

  private exitTile(factory: Unit): { tile: TileCoord; facing: number; rally: TileCoord } | null {
    const span = factory.type.footprint
    const origin = factory.tile
    for (let ring = 1; ring <= SPAWN_REACH; ring++) {
      const y0 = origin.y - ring
      const y1 = origin.y + span - 1 + ring
      const x0 = origin.x - ring
      const x1 = origin.x + span - 1 + ring
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const onRing = x === x0 || x === x1 || y === y0 || y === y1
          if (!onRing || !this.pathfinder.isWalkable(x, y, -1)) continue
          const dx = Math.sign(x + 0.5 - factory.pos.x)
          const dy = Math.sign(y + 0.5 - factory.pos.z)
          const rally = {
            x: Math.min(this.world.width - 1, Math.max(0, x + dx * 3)),
            y: Math.min(this.world.height - 1, Math.max(0, y + dy * 3)),
          }
          return { tile: { x, y }, facing: Math.atan2(dx, dy), rally }
        }
      }
    }
    return null
  }

  private clearJob(unitId: number) {
    for (const [playerId, queue] of this.jobs) {
      const next = queue.filter((id) => id !== unitId)
      if (next.length === queue.length) continue
      if (next.length === 0) this.jobs.delete(playerId)
      else this.jobs.set(playerId, next)
    }
  }
}
