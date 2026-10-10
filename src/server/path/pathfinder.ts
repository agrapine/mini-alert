import { isWalkableTerrain, type TileCoord } from '../../shared/tiles.ts'
import type { Unit } from '../units/unit.ts'
import type { World } from '../world.ts'
import { findPath } from './astar.ts'

const EMPTY = 0

export class PathFinder {
  readonly world: World
  private readonly occupants: Int32Array

  constructor(world: World) {
    this.world = world
    this.occupants = new Int32Array(world.width * world.height)
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

  setOccupant(x: number, y: number, occupantId: number | null) {
    this.occupants[this.index(x, y)] = occupantId ?? EMPTY
  }

  isWalkable(x: number, y: number, ignoreUnitId: number): boolean {
    if (!this.world.inBounds(x, y)) return false
    if (!isWalkableTerrain(this.world.terrainAt(x, y))) return false
    const occupantId = this.occupants[y * this.world.width + x]
    return occupantId === EMPTY || occupantId === ignoreUnitId
  }

  findPath(start: TileCoord, goal: TileCoord, ignoreUnitId: number): TileCoord[] | null {
    return findPath(this, start, goal, ignoreUnitId)
  }

  claim(unit: Unit, tile: TileCoord, footprint: number): boolean {
    if (unit.tile.x === tile.x && unit.tile.y === tile.y) return true
    if (!this.canClaim(tile, footprint, unit.id)) return false
    this.clearFootprint(unit.tile, footprint, unit.id)
    this.fillFootprint(tile, footprint, unit.id)
    unit.tile = { x: tile.x, y: tile.y }
    return true
  }

  private index(x: number, y: number): number {
    if (!this.world.inBounds(x, y)) throw new Error(`tile out of bounds: ${x},${y}`)
    return y * this.world.width + x
  }

  private canClaim(origin: TileCoord, footprint: number, unitId: number): boolean {
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        if (!this.isWalkable(origin.x + dx, origin.y + dy, unitId)) return false
      }
    }
    return true
  }

  private clearFootprint(origin: TileCoord, footprint: number, unitId: number) {
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        const x = origin.x + dx
        const y = origin.y + dy
        if (!this.world.inBounds(x, y)) continue
        if (this.occupant(x, y) === unitId) this.setOccupant(x, y, null)
      }
    }
  }

  private fillFootprint(origin: TileCoord, footprint: number, unitId: number) {
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        this.setOccupant(origin.x + dx, origin.y + dy, unitId)
      }
    }
  }
}
