import type { MapPoint, ShotEvent, UnitSnapshot } from '../shared/protocol.ts'
import type { TileCoord } from '../shared/tiles.ts'
import { UNIT_TYPES, type UnitTypeId } from '../shared/unit-types.ts'
import { PathFinder } from './path/pathfinder.ts'
import { Player } from './player.ts'
import { createUnit } from './units/create.ts'
import { Unit } from './units/unit.ts'
import { applyImpacts, engage, type Impact } from './sim/combat.ts'
import type { World } from './world.ts'

const SPAWN_TILE = { x: 1, y: 12 }

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

  trySpawn(playerId: number, typeId: UnitTypeId, facing = Math.PI / 2): boolean {
    const owner = this.players.get(playerId)
    if (!owner) return false
    const origin = this.spawnAnchors.get(playerId) ?? SPAWN_TILE
    for (const step of spawnSteps()) {
      const tile = { x: origin.x + step.x, y: origin.y + step.y }
      if (!this.pathfinder.isWalkable(tile.x, tile.y, -1)) continue
      this.spawn(owner, typeId, tile, facing)
      return true
    }
    return false
  }

  spawn(owner: Player, typeId: UnitTypeId, tile: TileCoord, facing = 0): Unit {
    const type = UNIT_TYPES[typeId]
    if (!this.pathfinder.isWalkable(tile.x, tile.y, -1)) {
      throw new Error(`cannot spawn on ${tile.x},${tile.y}`)
    }
    const unit = createUnit(this.nextUnitId++, owner.id, type, tile, facing)
    this.units.push(unit)
    owner.addUnit(unit.id)
    this.pathfinder.setOccupant(tile.x, tile.y, unit.id)
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
    for (const unit of this.units) {
      if (unit.health <= 0) continue
      unit.step(dt, this.pathfinder, this.units)
    }
    this.time += dt
    const shots = engage(this.units, dt, this.time, this.impacts)
    applyImpacts(this.units, this.impacts, this.time)
    this.removeDead()
    return shots
  }

  unitSnapshots(): UnitSnapshot[] {
    return this.units.map((unit) => ({
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
    }))
  }

  private owned(playerId: number, unitId: number): Unit | undefined {
    const player = this.players.get(playerId)
    if (!player?.owns(unitId)) return undefined
    return this.units.find((candidate) => candidate.id === unitId)
  }

  private removeDead() {
    for (const unit of this.units) {
      if (unit.health > 0) continue
      this.pathfinder.release(unit)
    }
    this.units.splice(0, this.units.length, ...this.units.filter((unit) => unit.health > 0))
  }
}
