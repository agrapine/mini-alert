import { encodeVertex, SHIFT_ZERO } from '../../shared/shift.ts'
import { Terrain } from '../../shared/tiles.ts'
import { valueNoise } from '../../shared/noise.ts'

const INSET = 1 / 16
const FOREST_EDGE = 0.6
const LAKE_LOW = 0.48
const LAKE_HIGH = 0.56

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

export type Site = { x: number; y: number }

export function fitShifts(
  terrain: Uint8Array,
  width: number,
  height: number,
  seed: number,
  kept: readonly Site[],
  dropped: readonly Site[],
  roads: readonly { x: number; y: number }[][],
): Uint8Array {
  const shifts = new Uint8Array(width * height)
  shifts.fill(SHIFT_ZERO)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = terrain[y * width + x]
      const neighbors: { x: number; y: number; tile: number }[] = []
      for (const dir of DIRS) {
        const nx = x + dir.x
        const ny = y + dir.y
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        neighbors.push({ x: nx, y: ny, tile: terrain[ny * width + nx] })
      }
      const water = neighbors.filter((neighbor) => isWater(here) !== isWater(neighbor.tile))
      if (water.length > 0) {
        shifts[y * width + x] = shoreByte(x, y, kept, dropped)
        continue
      }
      const lake = neighbors.filter((neighbor) => isLake(here) !== isLake(neighbor.tile))
      if (lake.length > 0) {
        shifts[y * width + x] = noiseByte(x, y, seed, lakeThreshold(here, x, y, seed), lake)
        continue
      }
      const road = neighbors.filter((neighbor) => isRoad(here) !== isRoad(neighbor.tile))
      if (road.length > 0) {
        const point = closestRoad(roads, x, y)
        if (point) shifts[y * width + x] = encodeVertex(x, y, point.x, point.y)
        continue
      }
      const forest = neighbors.filter((neighbor) => isForest(here) !== isForest(neighbor.tile))
      if (forest.length > 0) shifts[y * width + x] = noiseByte(x, y, seed, FOREST_EDGE, forest)
    }
  }
  return shifts
}

export function bisectorDistance(x: number, y: number, kept: readonly Site[], dropped: readonly Site[]): number {
  const nearKept = nearest(kept, x, y)
  const nearDropped = nearest(dropped, x, y)
  if (!nearKept || !nearDropped) return Infinity
  const mx = (nearKept.x + nearDropped.x) / 2
  const my = (nearKept.y + nearDropped.y) / 2
  const dx = -(nearDropped.y - nearKept.y)
  const dy = nearDropped.x - nearKept.x
  const len = Math.hypot(dx, dy) || 1
  return Math.abs((x - mx) * dy - (y - my) * dx) / len
}

function shoreByte(tx: number, ty: number, kept: readonly Site[], dropped: readonly Site[]): number {
  const point = bisectorPoint(kept, dropped, tx, ty)
  if (!point) return SHIFT_ZERO
  return encodeVertex(tx, ty, point.x, point.y)
}

function bisectorPoint(kept: readonly Site[], dropped: readonly Site[], tx: number, ty: number): Site | null {
  const cx = tx + 0.5
  const cy = ty + 0.5
  const nearKept = nearest(kept, cx, cy)
  const nearDropped = nearest(dropped, cx, cy)
  if (!nearKept || !nearDropped) return null
  const mx = (nearKept.x + nearDropped.x) / 2
  const my = (nearKept.y + nearDropped.y) / 2
  let dx = -(nearDropped.y - nearKept.y)
  let dy = nearDropped.x - nearKept.x
  const len = Math.hypot(dx, dy) || 1
  dx /= len
  dy /= len
  const minX = tx + INSET
  const maxX = tx + 1 - INSET
  const minY = ty + INSET
  const maxY = ty + 1 - INSET
  const alongX = slab(mx, dx, minX, maxX, -1e9, 1e9)
  const alongY = alongX.hit ? slab(my, dy, minY, maxY, alongX.t0, alongX.t1) : alongX
  const tPrefer = (cx - mx) * dx + (cy - my) * dy
  if (alongY.hit) {
    const t = Math.min(alongY.t1, Math.max(alongY.t0, tPrefer))
    return { x: mx + dx * t, y: my + dy * t }
  }
  return {
    x: Math.min(maxX, Math.max(minX, mx + dx * tPrefer)),
    y: Math.min(maxY, Math.max(minY, my + dy * tPrefer)),
  }
}

function slab(origin: number, dir: number, min: number, max: number, t0: number, t1: number): { hit: boolean; t0: number; t1: number } {
  if (Math.abs(dir) < 1e-8) return { hit: origin >= min && origin <= max, t0, t1 }
  const a = (min - origin) / dir
  const b = (max - origin) / dir
  const low = Math.max(t0, Math.min(a, b))
  const high = Math.min(t1, Math.max(a, b))
  return { hit: low <= high, t0: low, t1: high }
}

function noiseByte(
  tx: number,
  ty: number,
  seed: number,
  threshold: number,
  neighbors: readonly { x: number; y: number }[],
): number {
  let sx = 0
  let sy = 0
  for (const neighbor of neighbors) {
    const fromX = tx + 0.5
    const fromY = ty + 0.5
    const toX = neighbor.x + 0.5
    const toY = neighbor.y + 0.5
    const start = valueNoise(fromX, fromY, seed)
    const end = valueNoise(toX, toY, seed)
    const span = end - start
    const t = Math.abs(span) < 1e-6 ? 0.5 : Math.min(1, Math.max(0, (threshold - start) / span))
    sx += fromX + (toX - fromX) * t
    sy += fromY + (toY - fromY) * t
  }
  return encodeVertex(tx, ty, sx / neighbors.length, sy / neighbors.length)
}

function lakeThreshold(tile: number, x: number, y: number, seed: number): number {
  const noise = valueNoise(x, y, seed)
  if (isLake(tile)) return Math.abs(noise - LAKE_LOW) < Math.abs(noise - LAKE_HIGH) ? LAKE_LOW : LAKE_HIGH
  if (noise <= LAKE_LOW) return LAKE_LOW
  if (noise >= LAKE_HIGH) return LAKE_HIGH
  return Math.abs(noise - LAKE_LOW) < Math.abs(noise - LAKE_HIGH) ? LAKE_LOW : LAKE_HIGH
}

function closestRoad(
  roads: readonly { x: number; y: number }[][],
  tx: number,
  ty: number,
): { x: number; y: number } | null {
  const cx = tx + 0.5
  const cy = ty + 0.5
  let best: { x: number; y: number } | null = null
  let bestDist = Infinity
  for (const road of roads) {
    for (let i = 0; i < road.length - 1; i++) {
      const point = closestOnSegment(road[i], road[i + 1], cx, cy)
      if (point.x < tx || point.x > tx + 1 || point.y < ty || point.y > ty + 1) continue
      const dist = (point.x - cx) ** 2 + (point.y - cy) ** 2
      if (dist >= bestDist) continue
      bestDist = dist
      best = point
    }
  }
  return best
}

function closestOnSegment(
  from: { x: number; y: number },
  to: { x: number; y: number },
  x: number,
  y: number,
): { x: number; y: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = dx * dx + dy * dy
  const t = len < 1e-8 ? 0 : Math.min(1, Math.max(0, ((x - from.x) * dx + (y - from.y) * dy) / len))
  return { x: from.x + dx * t, y: from.y + dy * t }
}

function nearest(sites: readonly Site[], x: number, y: number): Site | null {
  let best: Site | null = null
  let bestDist = Infinity
  for (const site of sites) {
    const dist = (site.x - x) ** 2 + (site.y - y) ** 2
    if (dist >= bestDist) continue
    bestDist = dist
    best = site
  }
  return best
}

function isWater(tile: number): boolean {
  return tile === Terrain.Water
}

function isLake(tile: number): boolean {
  return tile === Terrain.Lake
}

function isRoad(tile: number): boolean {
  return tile === Terrain.Road
}

function isForest(tile: number): boolean {
  return tile === Terrain.Forest || tile === Terrain.Tree
}
