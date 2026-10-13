import { Cell, descend, distanceField, findPath, type PathGrid } from './astar.ts'
import { flightLine } from './motion.ts'
import type { TileCoord } from './tiles.ts'
import { MoveDomain } from './unit-types.ts'

/** What move planning reads from the map; the server answers from the game, the client from its replica. */
export interface RouteMap {
  readonly width: number
  readonly height: number
  /** Terrain the domain can stand on, outside city buildings. */
  terrainOpen(x: number, y: number, domain: MoveDomain): boolean
  occupant(x: number, y: number): number | null
  /** Whether the unit standing on the tile can make way. */
  movable(x: number, y: number): boolean
}

export type Mover = { id: number; tile: TileCoord; domain: MoveDomain }

const POCKET = 256
const LANDING_RADIUS = 24
const LANDING_OFFSETS = ringOffsets(LANDING_RADIUS)
const APPROACH = 6
const CONVOY_SIZE = 4

let seen = new Uint32Array(0)
let queue = new Int32Array(0)
let floodMark = 0

export function cellAt(map: RouteMap, x: number, y: number, ignore: number | null, domain: MoveDomain): Cell {
  if (!map.terrainOpen(x, y, domain)) return Cell.Blocked
  const holder = map.occupant(x, y)
  if (holder === null || holder === ignore) return Cell.Open
  return map.movable(x, y) ? Cell.Crowded : Cell.Blocked
}

export function findRoute(map: RouteMap, start: TileCoord, goal: TileCoord, ignore: number | null, domain: MoveDomain): TileCoord[] | null {
  if (domain === MoveDomain.Air) {
    if (!inside(map, start) || !inside(map, goal)) return null
    return flightLine(start, goal)
  }
  if (isolated(map, start, goal, domain)) return null
  return findPath(gridOf(map, ignore, domain), start, goal)
}

/**
 * Routes for a move order: each domain's movers get distinct free tiles nearest the target, the nearest mover
 * taking each, and groups share one flood toward their goals. Movers left without a goal are absent.
 */
export function planMoves(map: RouteMap, movers: readonly Mover[], target: TileCoord): Map<number, TileCoord[]> {
  const routes = new Map<number, TileCoord[]>()
  const crews = new Map<MoveDomain, Mover[]>()
  for (const mover of movers) {
    const crew = crews.get(mover.domain) ?? []
    crew.push(mover)
    crews.set(mover.domain, crew)
  }
  for (const [domain, crew] of crews) {
    const goals = landing(map, target, domain, crew)
    const route = crew.length >= CONVOY_SIZE ? convoy(map, goals, crew, domain) : null
    const free = [...crew]
    for (const goal of goals) {
      const mover = takeNearest(free, goal)
      const path = route ? route(mover, goal) : findRoute(map, mover.tile, goal, mover.id, domain)
      if (path) routes.set(mover.id, path)
    }
  }
  return routes
}

function landing(map: RouteMap, target: TileCoord, domain: MoveDomain, movers: readonly Mover[]): TileCoord[] {
  const goals: TileCoord[] = []
  const members = new Set(movers.map((mover) => mover.id))
  const from = movers[0]?.tile
  if (!from) return goals
  for (const offset of LANDING_OFFSETS) {
    const x = target.x + offset.x
    const y = target.y + offset.y
    if (!map.terrainOpen(x, y, domain)) continue
    const holder = map.occupant(x, y)
    if (holder !== null && !members.has(holder)) continue
    const tile = { x, y }
    if (isolated(map, from, tile, domain)) continue
    goals.push(tile)
    if (goals.length === movers.length) break
  }
  return goals
}

/** Each mover walks down one shared flood until it is APPROACH from the goals, then plans the rest to its own goal. */
function convoy(map: RouteMap, goals: readonly TileCoord[], movers: readonly Mover[], domain: MoveDomain) {
  const grid = gridOf(map, null, domain)
  const field = distanceField(grid, goals, movers.map((mover) => mover.tile))
  return (mover: Mover, goal: TileCoord): TileCoord[] | null => {
    const direct = () => findRoute(map, mover.tile, goal, mover.id, domain)
    const trunk = descend(grid, field, mover.tile)
    const cut = trunk?.findIndex((tile) => field(tile.x, tile.y) <= APPROACH) ?? -1
    if (!trunk || cut < 0) return direct()
    const last = findRoute(map, trunk[cut], goal, mover.id, domain)
    return last ? [...trunk.slice(0, cut + 1), ...last] : direct()
  }
}

/** True when `goal` sits in a small enclosed pocket that does not hold `start`. */
function isolated(map: RouteMap, start: TileCoord, goal: TileCoord, domain: MoveDomain): boolean {
  const { width, height } = map
  if (!map.terrainOpen(goal.x, goal.y, domain)) return false
  if (seen.length < width * height) {
    seen = new Uint32Array(width * height)
    queue = new Int32Array(width * height)
    floodMark = 0
  }
  floodMark += 1
  const mark = floodMark
  const standable = (x: number, y: number) => cellAt(map, x, y, null, domain) !== Cell.Blocked
  const startKey = start.y * width + start.x
  let head = 0
  let tail = 0
  const first = goal.y * width + goal.x
  seen[first] = mark
  queue[tail++] = first
  while (head < tail) {
    const key = queue[head++]
    if (key === startKey || tail > POCKET) return false
    const x = key % width
    const y = (key - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (!standable(nx, ny)) continue
        if (dx !== 0 && dy !== 0 && (!standable(nx, y) || !standable(x, ny))) continue
        const next = ny * width + nx
        if (seen[next] === mark) continue
        seen[next] = mark
        queue[tail++] = next
      }
    }
  }
  return true
}

function gridOf(map: RouteMap, ignore: number | null, domain: MoveDomain): PathGrid {
  return {
    width: map.width,
    height: map.height,
    cell: (x: number, y: number) => cellAt(map, x, y, ignore, domain),
  }
}

function inside(map: RouteMap, tile: TileCoord): boolean {
  return tile.x >= 0 && tile.y >= 0 && tile.x < map.width && tile.y < map.height
}

function takeNearest(movers: Mover[], tile: TileCoord): Mover {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < movers.length; i++) {
    const dist = (movers[i].tile.x - tile.x) ** 2 + (movers[i].tile.y - tile.y) ** 2
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  }
  return movers.splice(best, 1)[0]
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
