import { isWalkableTerrain, Terrain, type TileCoord } from '../../shared/tiles.ts'
import { MoveDomain, spanOf } from '../../shared/unit-types.ts'
import { flightLine } from '../../shared/motion.ts'
import type { Unit } from '../units/unit.ts'
import type { World } from '../world.ts'
import { Cell, findPath } from '../../shared/astar.ts'

const EMPTY = 0
const POCKET = 256
const LANDING_RADIUS = 24
const LANDING_OFFSETS = ringOffsets(LANDING_RADIUS)

export class PathFinder {
  readonly world: World
  private readonly occupants: Int32Array
  private readonly blocked: Uint8Array
  private readonly soft: Uint8Array
  private readonly seen: Uint32Array
  private readonly queue: Int32Array
  private floodMark = 0

  constructor(world: World) {
    this.world = world
    this.occupants = new Int32Array(world.width * world.height)
    this.blocked = new Uint8Array(world.width * world.height)
    this.soft = new Uint8Array(world.width * world.height)
    this.seen = new Uint32Array(world.width * world.height)
    this.queue = new Int32Array(world.width * world.height)
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
    return this.cell(x, y, ignoreUnitId, domain) === Cell.Open
  }

  isPassable(x: number, y: number, ignoreUnitId: number, domain = MoveDomain.Ground): boolean {
    return this.cell(x, y, ignoreUnitId, domain) !== Cell.Blocked
  }

  findPath(start: TileCoord, goal: TileCoord, ignoreUnitId: number, domain = MoveDomain.Ground): TileCoord[] | null {
    if (domain === MoveDomain.Air) {
      if (!this.inBounds(start.x, start.y) || !this.inBounds(goal.x, goal.y)) return null
      return flightLine(start, goal)
    }
    if (this.isolated(start, goal, domain)) return null
    const grid = {
      width: this.width,
      height: this.world.height,
      cell: (x: number, y: number) => this.cell(x, y, ignoreUnitId, domain),
    }
    return findPath(grid, start, goal)
  }

  /** Distinct free tiles nearest the target, one per mover, skipping pockets the movers cannot reach. */
  landing(target: TileCoord, domain: MoveDomain, movers: readonly Unit[]): TileCoord[] {
    const goals: TileCoord[] = []
    const members = new Set(movers.map((unit) => unit.id))
    const from = movers[0]?.tile
    if (!from) return goals
    for (const offset of LANDING_OFFSETS) {
      const x = target.x + offset.x
      const y = target.y + offset.y
      if (!this.terrainOpen(x, y, domain)) continue
      const occupantId = this.occupants[y * this.world.width + x]
      if (occupantId !== EMPTY && !members.has(occupantId)) continue
      const tile = { x, y }
      if (this.isolated(from, tile, domain)) continue
      goals.push(tile)
      if (goals.length === movers.length) break
    }
    return goals
  }

  /** True when `goal` sits in a small enclosed pocket that does not hold `start`. */
  private isolated(start: TileCoord, goal: TileCoord, domain: MoveDomain): boolean {
    const width = this.world.width
    if (!this.terrainOpen(goal.x, goal.y, domain)) return false
    this.floodMark += 1
    const mark = this.floodMark
    const startKey = start.y * width + start.x
    let head = 0
    let tail = 0
    const first = goal.y * width + goal.x
    this.seen[first] = mark
    this.queue[tail++] = first
    while (head < tail) {
      const key = this.queue[head++]
      if (key === startKey || tail > POCKET) return false
      const x = key % width
      const y = (key - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (!this.standable(nx, ny, domain)) continue
          if (dx !== 0 && dy !== 0 && (!this.standable(nx, y, domain) || !this.standable(x, ny, domain))) continue
          const next = ny * width + nx
          if (this.seen[next] === mark) continue
          this.seen[next] = mark
          this.queue[tail++] = next
        }
      }
    }
    return true
  }

  private standable(x: number, y: number, domain: MoveDomain): boolean {
    return this.cell(x, y, EMPTY, domain) !== Cell.Blocked
  }

  private cell(x: number, y: number, ignoreUnitId: number, domain: MoveDomain): Cell {
    if (!this.terrainOpen(x, y, domain)) return Cell.Blocked
    const index = y * this.world.width + x
    const occupantId = this.occupants[index]
    if (occupantId === EMPTY || occupantId === ignoreUnitId) return Cell.Open
    return this.soft[index] === 1 ? Cell.Crowded : Cell.Blocked
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
    if (this.blocked[y * this.world.width + x] !== 0) return false
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

function ringOffsets(radius: number): TileCoord[] {
  const offsets: TileCoord[] = []
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) offsets.push({ x, y })
    }
  }
  return offsets.sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y))
}
