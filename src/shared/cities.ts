import type { MapPoint } from './protocol.ts'
import { isWalkableTerrain, type TileCoord } from './tiles.ts'

export const NEUTRAL_CITY = 0xffffff
export const CAPTURE_DRAIN = 2
export const CITY_GROW_SECONDS = 4
export const STREET_REACH = 4
export const STRUCTURE_RANGE = 8
export const CAPTURE_SPEED_CAP = 5
export const CITY_SIGHT = 10

export const enum StreetKind {
  Straight = 0,
  Corner = 1,
  Split = 2,
  Junction = 3,
  Crossing = 4,
  Curve = 5,
  Lamp = 6,
  SignalA = 7,
  SignalB = 8,
  SignalC = 9,
}

export type CityBuilding = {
  x: number
  y: number
  model: number
  yaw: number
}

export type CityStreet = {
  x: number
  y: number
  kind: StreetKind
  yaw: number
  ox: number
  oz: number
}

export type CityLayout = {
  x: number
  y: number
  span: number
  seed: number
  tiles: TileCoord[]
  buildings: CityBuilding[]
  streets: CityStreet[]
}

export function captureDuration(span: number, neutral: boolean): number {
  const base = (4 + 2 * span) * 10
  return neutral ? base : base * 2.5
}

export function captureSpeed(units: number): number {
  return Math.min(CAPTURE_SPEED_CAP, Math.max(1, units))
}

export function footprintNearCity(
  cities: readonly { buildings: readonly { x: number; y: number }[] }[],
  origin: { x: number; y: number },
  footprint: number,
): boolean {
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      const x = origin.x + dx
      const y = origin.y + dy
      let close = false
      for (const city of cities) {
        for (const building of city.buildings) {
          if (Math.max(Math.abs(building.x - x), Math.abs(building.y - y)) <= STRUCTURE_RANGE) {
            close = true
            break
          }
        }
        if (close) break
      }
      if (!close) return false
    }
  }
  return footprint > 0
}

export function cityContains(city: CityLayout, x: number, y: number): boolean {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  for (const tile of city.tiles) {
    if (tile.x === ix && tile.y === iy) return true
  }
  return false
}

const CAPTURE_PAD = 1

export function cityHolds(city: CityLayout, x: number, z: number): boolean {
  const tx = Math.floor(x)
  const tz = Math.floor(z)
  for (const tile of city.tiles) {
    if (Math.max(Math.abs(tile.x - tx), Math.abs(tile.y - tz)) <= CAPTURE_PAD) return true
  }
  return false
}

export function cityCenter(city: CityLayout): TileCoord {
  const pool = city.streets.length > 0 ? city.streets : city.tiles
  let sx = 0
  let sy = 0
  for (const tile of pool) {
    sx += tile.x
    sy += tile.y
  }
  const cx = sx / pool.length
  const cy = sy / pool.length
  let best = pool[0]
  let bestDist = Infinity
  for (const tile of pool) {
    const dist = (tile.x - cx) ** 2 + (tile.y - cy) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = tile
    }
  }
  return { x: best.x, y: best.y }
}

export function citySightOrigin(city: CityLayout): { x: number; z: number } {
  const center = cityCenter(city)
  return { x: center.x + 0.5, z: center.y + 0.5 }
}

export function layoutCities(
  towns: readonly MapPoint[],
  seed: number,
  terrain: ArrayLike<number>,
  width: number,
  height: number,
): CityLayout[] {
  return towns.map((town, index) => {
    const span = 2 + (hash(index, 1, seed) % 3)
    const anchorX = Math.floor(town.x)
    const anchorY = Math.floor(town.y)
    const citySeed = seed + index * 17
    let city = compose([{ x: anchorX, y: anchorY }], [], span, citySeed)
    const target = span * span
    let guard = 0
    while (city.tiles.length < target && guard < target * 6) {
      const next = growCity(city, terrain, width, height)
      if (!next) break
      city = next
      guard += 1
    }
    return city
  })
}

export function growCity(
  city: CityLayout,
  terrain: ArrayLike<number>,
  width: number,
  height: number,
): CityLayout | null {
  const roads = roadTiles(city)
  const buildings = city.buildings.map((building) => ({ x: building.x, y: building.y }))
  const roadSet = new Set<number>()
  const buildingSet = new Set<number>()
  for (const road of roads) roadSet.add(key(road.x, road.y))
  for (const building of buildings) buildingSet.add(key(building.x, building.y))
  const salt = hash(city.tiles.length, city.span, city.seed)
  const far = farthestStreet(roads, buildings)
  if (far > STREET_REACH || (salt % 5 === 0 && buildings.length > 0) || buildings.length === 0) {
    const built = addBuilding(city, roads, buildings, roadSet, buildingSet, terrain, width, height, salt)
    if (built) return built
  }
  const street = addStreet(city, roads, buildings, roadSet, buildingSet, terrain, width, height, salt)
  if (street) return street
  return addBuilding(city, roads, buildings, roadSet, buildingSet, terrain, width, height, salt + 1)
}

const projection = new Map<number, { grown: number; city: CityLayout; width: number; height: number }>()

export function projectCity(
  base: CityLayout,
  grown: number,
  terrain: ArrayLike<number>,
  width: number,
  height: number,
): CityLayout {
  if (grown <= 0) return base
  const cached = projection.get(base.seed)
  let city = base
  let done = 0
  if (cached && cached.width === width && cached.height === height && cached.grown <= grown) {
    city = cached.city
    done = cached.grown
  }
  for (let step = done; step < grown; step++) {
    const next = growCity(city, terrain, width, height)
    if (!next) break
    city = next
    done += 1
  }
  if (done > 0) projection.set(base.seed, { grown: done, city, width, height })
  return city
}

const DIR_X = [0, 1, 0, -1]
const DIR_Y = [1, 0, -1, 0]
const MASK_STRAIGHT = 0b0101
const MASK_CORNER = 0b0011
const MASK_SPLIT = 0b0111

function addStreet(
  city: CityLayout,
  roads: TileCoord[],
  buildings: TileCoord[],
  roadSet: Set<number>,
  buildingSet: Set<number>,
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  salt: number,
): CityLayout | null {
  const reach = farthestStreet(roads, buildings)
  let best: TileCoord | null = null
  let bestScore = -Infinity
  for (const road of roads) {
    const openings = roadPieceFor(neighborMask(road.x, road.y, roadSet), hash(road.x, road.y, city.seed)).openings
    for (let dir = 0; dir < 4; dir++) {
      const x = road.x + DIR_X[dir]
      const y = road.y + DIR_Y[dir]
      if (!openLand(x, y, roadSet, buildingSet, terrain, width, height)) continue
      const id = key(x, y)
      roadSet.add(id)
      const hits = opensOntoBuilding(x, y, roadSet, buildingSet, city.seed)
      roadSet.delete(id)
      if (hits) continue
      if (Math.max(reach, distanceToBuilding({ x, y }, buildings)) > STREET_REACH) continue
      const extend = (openings & (1 << dir)) !== 0
      const noise = (hash(x, y, salt) % 1000) / 1000
      const score = noise + (extend ? 0.4 : 0)
      if (score <= bestScore) continue
      bestScore = score
      best = { x, y }
    }
  }
  if (!best) return null
  return compose(roads.concat(best), buildings, city.span, city.seed)
}

function addBuilding(
  city: CityLayout,
  roads: TileCoord[],
  buildings: TileCoord[],
  roadSet: Set<number>,
  buildingSet: Set<number>,
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  salt: number,
): CityLayout | null {
  const forbidden = new Set<number>()
  const openingsByRoad = new Array<number>(roads.length)
  for (let i = 0; i < roads.length; i++) {
    const road = roads[i]
    const openings = visualOpenings(road.x, road.y, roadSet, city.seed)
    openingsByRoad[i] = openings
    for (let dir = 0; dir < 4; dir++) {
      if ((openings & (1 << dir)) === 0) continue
      forbidden.add(key(road.x + DIR_X[dir], road.y + DIR_Y[dir]))
    }
  }
  let best: TileCoord | null = null
  let bestScore = -Infinity
  for (let i = 0; i < roads.length; i++) {
    const road = roads[i]
    const openings = openingsByRoad[i]
    const need = distanceToBuilding(road, buildings)
    for (let dir = 0; dir < 4; dir++) {
      if (openings & (1 << dir)) continue
      const x = road.x + DIR_X[dir]
      const y = road.y + DIR_Y[dir]
      if (!openLand(x, y, roadSet, buildingSet, terrain, width, height)) continue
      if (forbidden.has(key(x, y))) continue
      const noise = (hash(x, y, salt + 19) % 1000) / 1000
      const score = noise + Math.min(need, 8) * 0.15
      if (score <= bestScore) continue
      bestScore = score
      best = { x, y }
    }
  }
  if (!best) return null
  return compose(roads, buildings.concat(best), city.span, city.seed)
}

function compose(roads: readonly TileCoord[], buildings: readonly TileCoord[], span: number, seed: number): CityLayout {
  const roadSet = new Set<number>()
  for (const road of roads) roadSet.add(key(road.x, road.y))
  const streets: CityStreet[] = []
  let signaled = false
  for (const road of roads) {
    const neighbors = neighborMask(road.x, road.y, roadSet)
    const piece = roadPieceFor(neighbors, hash(road.x, road.y, seed))
    streets.push({ x: road.x, y: road.y, kind: piece.kind, yaw: piece.yaw, ox: 0, oz: 0 })
    const edge = pop(neighbors) < 4
    if (edge && hash(road.x, road.y, seed + 4) % 2 === 0) {
      const side = sidewalk(piece.openings)
      if (side) {
        streets.push({
          x: road.x,
          y: road.y,
          kind: StreetKind.Lamp,
          yaw: hash(road.x, road.y, seed + 5) % 4,
          ox: DIR_X[side] * 0.38,
          oz: DIR_Y[side] * 0.38,
        })
      }
    }
    if (!signaled && pop(neighbors) >= 3 && hash(road.x, road.y, seed + 6) % 3 === 0) {
      const variant = hash(road.x, road.y, seed + 8) % 3
      const kind = variant === 0 ? StreetKind.SignalA : variant === 1 ? StreetKind.SignalB : StreetKind.SignalC
      streets.push({ x: road.x, y: road.y, kind, yaw: piece.yaw, ox: 0.28, oz: 0.28 })
      signaled = true
    }
  }
  const built = buildings.map((tile) => ({
    x: tile.x,
    y: tile.y,
    model: hash(tile.x, tile.y, seed + 3) % 8,
    yaw: hash(tile.x, tile.y, seed + 9) % 4,
  }))
  let minX = roads[0]?.x ?? 0
  let minY = roads[0]?.y ?? 0
  for (const tile of roads.concat(buildings)) {
    if (tile.x < minX) minX = tile.x
    if (tile.y < minY) minY = tile.y
  }
  return {
    x: minX,
    y: minY,
    span,
    seed,
    tiles: roads.concat(buildings).map((tile) => ({ x: tile.x, y: tile.y })),
    buildings: built,
    streets,
  }
}

function roadPieceFor(neighborMask: number, salt: number): { kind: StreetKind; yaw: number; openings: number } {
  const bits = pop(neighborMask)
  if (bits >= 4) return { kind: StreetKind.Junction, yaw: 0, openings: 0b1111 }
  if (bits === 3) {
    const yaw = yawFor(MASK_SPLIT, neighborMask)
    return { kind: StreetKind.Split, yaw, openings: rotateMask(MASK_SPLIT, yaw) }
  }
  if (neighborMask === MASK_STRAIGHT || neighborMask === rotateMask(MASK_STRAIGHT, 1)) {
    const yaw = neighborMask === MASK_STRAIGHT ? 0 : 1
    const kind = salt % 2 === 0 ? StreetKind.Straight : StreetKind.Crossing
    return { kind, yaw, openings: rotateMask(MASK_STRAIGHT, yaw) }
  }
  if (bits === 2) {
    const yaw = yawFor(MASK_CORNER, neighborMask)
    const kind = salt % 2 === 0 ? StreetKind.Corner : StreetKind.Curve
    return { kind, yaw, openings: rotateMask(MASK_CORNER, yaw) }
  }
  if (bits === 1) {
    const aligned = (neighborMask & MASK_STRAIGHT) !== 0
    const facing = aligned ? 0 : 1
    return { kind: StreetKind.Straight, yaw: facing, openings: rotateMask(MASK_STRAIGHT, facing) }
  }
  const yaw = salt & 1
  return { kind: StreetKind.Straight, yaw, openings: rotateMask(MASK_STRAIGHT, yaw) }
}

function visualOpenings(x: number, y: number, roadSet: Set<number>, seed: number): number {
  return roadPieceFor(neighborMask(x, y, roadSet), hash(x, y, seed)).openings
}

function opensOntoBuilding(x: number, y: number, roadSet: Set<number>, buildingSet: Set<number>, seed: number): boolean {
  if (roadOpensOntoBuilding(x, y, roadSet, buildingSet, seed)) return true
  for (let dir = 0; dir < 4; dir++) {
    const nx = x + DIR_X[dir]
    const ny = y + DIR_Y[dir]
    if (!roadSet.has(key(nx, ny))) continue
    if (roadOpensOntoBuilding(nx, ny, roadSet, buildingSet, seed)) return true
  }
  return false
}

function roadOpensOntoBuilding(
  x: number,
  y: number,
  roadSet: Set<number>,
  buildingSet: Set<number>,
  seed: number,
): boolean {
  const openings = roadPieceFor(neighborMask(x, y, roadSet), hash(x, y, seed)).openings
  for (let dir = 0; dir < 4; dir++) {
    if ((openings & (1 << dir)) === 0) continue
    if (buildingSet.has(key(x + DIR_X[dir], y + DIR_Y[dir]))) return true
  }
  return false
}

function sidewalk(openings: number): number | null {
  for (let dir = 0; dir < 4; dir++) if ((openings & (1 << dir)) === 0) return dir
  return null
}

function farthestStreet(roads: readonly TileCoord[], buildings: readonly TileCoord[]): number {
  if (roads.length === 0) return 0
  let worst = 0
  for (const road of roads) {
    const dist = distanceToBuilding(road, buildings)
    if (dist > worst) worst = dist
  }
  return worst
}

function distanceToBuilding(road: TileCoord, buildings: readonly TileCoord[]): number {
  if (buildings.length === 0) return Infinity
  let best = Infinity
  for (const building of buildings) {
    const dist = Math.abs(road.x - building.x) + Math.abs(road.y - building.y)
    if (dist < best) best = dist
  }
  return best
}

function neighborMask(x: number, y: number, roadSet: Set<number>): number {
  let mask = 0
  for (let dir = 0; dir < 4; dir++) {
    if (roadSet.has(key(x + DIR_X[dir], y + DIR_Y[dir]))) mask |= 1 << dir
  }
  return mask
}

function openLand(
  x: number,
  y: number,
  roadSet: Set<number>,
  buildingSet: Set<number>,
  terrain: ArrayLike<number>,
  width: number,
  height: number,
): boolean {
  if (roadSet.has(key(x, y)) || buildingSet.has(key(x, y))) return false
  return walkable(terrain, width, height, x, y)
}

function roadTiles(city: CityLayout): TileCoord[] {
  const seen = new Set<number>()
  const tiles: TileCoord[] = []
  for (const street of city.streets) {
    if (street.kind >= StreetKind.Lamp) continue
    const id = key(street.x, street.y)
    if (seen.has(id)) continue
    seen.add(id)
    tiles.push({ x: street.x, y: street.y })
  }
  return tiles
}

function rotateMask(mask: number, yaw: number): number {
  let out = 0
  const turn = yaw & 3
  for (let dir = 0; dir < 4; dir++) if (mask & (1 << dir)) out |= 1 << ((dir + turn) & 3)
  return out
}

function yawFor(base: number, target: number): number {
  for (let yaw = 0; yaw < 4; yaw++) if (rotateMask(base, yaw) === target) return yaw
  return 0
}

function pop(mask: number): number {
  let count = 0
  for (let dir = 0; dir < 4; dir++) if (mask & (1 << dir)) count += 1
  return count
}

function key(x: number, y: number): number {
  return x + y * 4096
}

function walkable(terrain: ArrayLike<number>, width: number, height: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false
  return isWalkableTerrain(terrain[y * width + x])
}

function hash(x: number, y: number, seed: number): number {
  let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ (seed | 0)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n ^ (n >>> 16)) >>> 0
}
