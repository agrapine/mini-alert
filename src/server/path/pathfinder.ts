import { isWalkableTerrain, Terrain, type TileCoord } from '../../shared/tiles.ts'
import { MoveDomain, spanOf } from '../../shared/unit-types.ts'
import { flightLine } from '../../shared/motion.ts'
import type { Unit } from '../units/unit.ts'
import type { World } from '../world.ts'
import { findPath } from './astar.ts'
import { __TRACE__, traceBegin, traceEnd } from '../trace.ts'
import { TraceSlot } from '../../shared/trace.ts'

const EMPTY = 0

export class PathFinder {
  readonly world: World
  private readonly occupants: Int32Array
  private readonly blocked: Uint8Array
  private readonly soft: Uint8Array

  constructor(world: World) {
    this.world = world
    this.occupants = new Int32Array(world.width * world.height)
    this.blocked = new Uint8Array(world.width * world.height)
    this.soft = new Uint8Array(world.width * world.height)
  }

  get width(): number {
    return this.world.width
  }

  inBounds(x: number, y: number): boolean {
    return this.world.inBounds(x, y)
  }

  occupant(x: number, y: number): number | null {
    const id = this.occupants[this.index(x, y)]
    return id === EMPTY ? null : id
  }

  setOccupant(x: number, y: number, occupantId: number | null, movable = false) {
    const index = this.index(x, y)
    this.occupants[index] = occupantId ?? EMPTY
    this.soft[index] = occupantId != null && movable ? 1 : 0
  }

  setBlocked(x: number, y: number, blocked: boolean) {
    if (!this.world.inBounds(x, y)) return
    this.blocked[this.index(x, y)] = blocked ? 1 : 0
  }

  clearBlocked() {
    this.blocked.fill(0)
  }

  isWalkable(x: number, y: number, ignoreUnitId: number, domain = MoveDomain.Ground): boolean {
    if (!this.terrainOpen(x, y, domain)) return false
    const occupantId = this.occupants[y * this.world.width + x]
    return occupantId === EMPTY || occupantId === ignoreUnitId
  }

  isPassable(x: number, y: number, ignoreUnitId: number, domain = MoveDomain.Ground): boolean {
    if (!this.terrainOpen(x, y, domain)) return false
    const occupantId = this.occupants[y * this.world.width + x]
    if (occupantId === EMPTY || occupantId === ignoreUnitId) return true
    return this.soft[this.index(x, y)] === 1
  }

  stepCost(x: number, y: number, ignoreUnitId: number): number {
    if (!this.world.inBounds(x, y)) return 1
    const occupantId = this.occupants[y * this.world.width + x]
    if (occupantId === EMPTY || occupantId === ignoreUnitId) return 1
    return this.soft[this.index(x, y)] === 1 ? 3 : 1
  }

  findPath(start: TileCoord, goal: TileCoord, ignoreUnitId: number, domain = MoveDomain.Ground): TileCoord[] | null {
    __TRACE__ && traceBegin(TraceSlot.Path)
    const path = this.search(start, goal, ignoreUnitId, domain)
    __TRACE__ && traceEnd()
    return path
  }

  private search(start: TileCoord, goal: TileCoord, ignoreUnitId: number, domain: MoveDomain): TileCoord[] | null {
    if (domain === MoveDomain.Air) {
      if (!this.inBounds(start.x, start.y) || !this.inBounds(goal.x, goal.y)) return null
      return flightLine(start, goal)
    }
    const grid = {
      width: this.width,
      inBounds: (x: number, y: number) => this.inBounds(x, y),
      isWalkable: (x: number, y: number, ignore: number) => this.isWalkable(x, y, ignore, domain),
      isPassable: (x: number, y: number, ignore: number) => this.isPassable(x, y, ignore, domain),
      stepCost: (x: number, y: number, ignore: number) => this.stepCost(x, y, ignore),
    }
    return findPath(grid, start, goal, ignoreUnitId)
  }

  claim(unit: Unit, tile: TileCoord, footprint: number, domain = MoveDomain.Ground): boolean {
    if (unit.tile.x === tile.x && unit.tile.y === tile.y) return true
    if (!this.canClaim(tile, footprint, unit.id, domain)) return false
    this.clearFootprint(unit.tile, footprint, unit.id)
    this.fillFootprint(tile, footprint, unit.id, unit.type.topSpeed > 0)
    unit.tile = { x: tile.x, y: tile.y }
    return true
  }

  release(unit: Unit) {
    const span = spanOf(unit.type)
    this.clearFootprint(unit.tile, span.x, unit.id, span.y)
  }

  private terrainOpen(x: number, y: number, domain: MoveDomain): boolean {
    if (!this.world.inBounds(x, y)) return false
    if (this.blocked[this.index(x, y)] !== 0) return false
    if (domain === MoveDomain.Air) return true
    const terrain = this.world.terrainAt(x, y)
    if (domain === MoveDomain.Water) return terrain === Terrain.Water || terrain === Terrain.Lake
    return isWalkableTerrain(terrain)
  }

  private index(x: number, y: number): number {
    if (!this.world.inBounds(x, y)) throw new Error(`tile out of bounds: ${x},${y}`)
    return y * this.world.width + x
  }

  private canClaim(origin: TileCoord, footprint: number, unitId: number, domain: MoveDomain): boolean {
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        if (!this.isWalkable(origin.x + dx, origin.y + dy, unitId, domain)) return false
      }
    }
    return true
  }

  private clearFootprint(origin: TileCoord, footprint: number, unitId: number, spanY = footprint) {
    for (let dy = 0; dy < spanY; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        const x = origin.x + dx
        const y = origin.y + dy
        if (!this.world.inBounds(x, y)) continue
        if (this.occupant(x, y) === unitId) this.setOccupant(x, y, null)
      }
    }
  }

  private fillFootprint(origin: TileCoord, footprint: number, unitId: number, movable: boolean) {
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        this.setOccupant(origin.x + dx, origin.y + dy, unitId, movable)
      }
    }
  }
}
