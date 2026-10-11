import type { CitySite, MapPoint } from './protocol.ts'
import { isWalkableTerrain, type TileCoord } from './tiles.ts'

export const NEUTRAL_CITY = 0xffffff
export const CAPTURE_DRAIN = 60
export const CAPTURE_PER_POP = 5
export const CITY_GROW_SECONDS = 4
export const STREET_REACH = 4
export const STRUCTURE_RANGE = 8
export const CITY_SIGHT = 10
export const SIEGE_RANGE = 6
export const BUILDING_HP = 120
export const STREET_HP = 60
export const CITY_MODELS = 8
export const BUILDING_COST = 100

export function buildingCost(population: number): number {
  return BUILDING_COST * Math.max(1, population - 5)
}

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
  keep: boolean
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

export function captureDuration(population: number): number {
  return Math.max(1, population) * CAPTURE_PER_POP
}

export function captureFade(supply: number, population: number): number {
  if (supply <= 0) return CAPTURE_DRAIN
  return captureDuration(population) / supply
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

export function settledCity(layout: CityLayout, ruins: readonly TileCoord[] = []): CityLayout {
  if (ruins.length === 0) return layout
  const gone = new Set(ruins.map((tile) => key(tile.x, tile.y)))
  const buildings = layout.buildings.filter((building) => !gone.has(key(building.x, building.y)))
  const living = buildings.map((building) => ({ x: building.x, y: building.y, keep: building.keep }))
  const roads = roadTiles(layout).filter((road) => {
    if (gone.has(key(road.x, road.y))) return false
    return distanceToBuilding(road, living) <= STREET_REACH
  })
  return compose(roads, buildings, layout.span, layout.seed)
}

export function lostStreets(layout: CityLayout, ruins: readonly TileCoord[]): TileCoord[] {
  const kept = new Set<number>()
  for (const street of settledCity(layout, ruins).streets) {
    if (street.kind >= StreetKind.Lamp) continue
    kept.add(key(street.x, street.y))
  }
  const gone = new Set(ruins.map((tile) => key(tile.x, tile.y)))
  const lost: TileCoord[] = []
  const seen = new Set<number>()
  for (const street of layout.streets) {
    if (street.kind >= StreetKind.Lamp) continue
    const id = key(street.x, street.y)
    if (seen.has(id) || kept.has(id) || gone.has(id)) continue
    seen.add(id)
    lost.push({ x: street.x, y: street.y })
  }
  return lost
}

export function populationOf(city: CityLayout, ruins: readonly TileCoord[] = []): number {
  let count = 0
  for (const building of city.buildings) {
    let ruined = false
    for (const ruin of ruins) {
      if (ruin.x === building.x && ruin.y === building.y) {
        ruined = true
        break
      }
    }
    if (!ruined) count += 1
  }
  return count
}

export function cityContains(city: CityLayout, x: number, y: number): boolean {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  for (const tile of city.tiles) {
    if (tile.x === ix && tile.y === iy) return true
  }
  return false
}

export function cityHolds(city: CityLayout, x: number, z: number): boolean {
  return cityContains(city, x, z)
}

export function cityCenter(city: CityLayout): TileCoord {
  const pool = city.streets.length > 0 ? city.streets : city.tiles
  if (pool.length === 0) return { x: city.x, y: city.y }
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
  const buildings = city.buildings.map((building) => ({
    x: building.x,
    y: building.y,
    keep: building.keep,
    model: building.model,
    yaw: building.yaw,
  }))
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
  sites: readonly CitySite[] = [],
): CityLayout {
  if (sites.length > 0) return replayCity(base, grown, terrain, width, height, sites)
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
      if (!canPlaceStreet(x, y, roadSet)) continue
      const id = key(x, y)
      roadSet.add(id)
      const hits = opensOntoBuilding(x, y, roadSet, buildingSet, city.seed)
      roadSet.delete(id)
      if (hits) continue
      if (Math.max(reach, distanceToBuilding({ x, y }, buildings)) > STREET_REACH) continue
      const extend = (openings & (1 << dir)) !== 0
      const noise = (hash(x, y, salt) % 1000) / 1000
      const score = noise + (extend ? 2 : 0)
      if (score <= bestScore) continue
      bestScore = score
      best = { x, y }
    }
  }
  if (!best) return null
  return compose(roads.concat(best), buildings, city.span, city.seed)
}

export function canPlaceCityBuilding(
  city: CityLayout,
  x: number,
  y: number,
  terrain: ArrayLike<number>,
  width: number,
  height: number,
): boolean {
  const roads = roadTiles(city)
  const roadSet = new Set<number>()
  const buildingSet = new Set<number>()
  for (const road of roads) roadSet.add(key(road.x, road.y))
  for (const building of city.buildings) buildingSet.add(key(building.x, building.y))
  const frame = plotFrame(city, roads, roadSet)
  if (frame.forbidden.has(key(x, y)) || !openLand(x, y, roadSet, buildingSet, terrain, width, height)) return false
  for (let i = 0; i < roads.length; i++) {
    const road = roads[i]
    const openings = frame.openings[i]
    for (let dir = 0; dir < 4; dir++) {
      if (openings & (1 << dir)) continue
      if (road.x + DIR_X[dir] === x && road.y + DIR_Y[dir] === y) return true
    }
  }
  return false
}

export function insertBuilding(
  city: CityLayout,
  plot: { x: number; y: number; model: number; yaw: number },
  terrain: ArrayLike<number>,
  width: number,
  height: number,
): CityLayout | null {
  if (!canPlaceCityBuilding(city, plot.x, plot.y, terrain, width, height)) return null
  const roads = roadTiles(city)
  const buildings = city.buildings.map((building) => ({
    x: building.x,
    y: building.y,
    keep: building.keep,
    model: building.model,
    yaw: building.yaw,
  }))
  return compose(roads, buildings.concat({ ...plot, keep: false }), city.span, city.seed)
}

function replayCity(
  base: CityLayout,
  grown: number,
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  sites: readonly CitySite[],
): CityLayout {
  let city = base
  let cursor = 0
  const place = (at: number) => {
    while (cursor < sites.length && sites[cursor].at === at) {
      const site = sites[cursor]
      cursor += 1
      const next = insertBuilding(city, site, terrain, width, height)
      if (next) city = next
    }
  }
  for (let step = 0; step < grown; step++) {
    place(step)
    const next = growCity(city, terrain, width, height)
    if (!next) break
    city = next
  }
  place(grown)
  return city
}

function plotFrame(
  city: CityLayout,
  roads: readonly TileCoord[],
  roadSet: Set<number>,
): { forbidden: Set<number>; openings: number[] } {
  const forbidden = new Set<number>()
  const openings = new Array<number>(roads.length)
  for (let i = 0; i < roads.length; i++) {
    const road = roads[i]
    const mask = visualOpenings(road.x, road.y, roadSet, city.seed)
    openings[i] = mask
    for (let dir = 0; dir < 4; dir++) {
      if ((mask & (1 << dir)) === 0) continue
      forbidden.add(key(road.x + DIR_X[dir], road.y + DIR_Y[dir]))
    }
  }
  return { forbidden, openings }
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
  const frame = plotFrame(city, roads, roadSet)
  const forbidden = frame.forbidden
  const openingsByRoad = frame.openings
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

function compose(
  roads: readonly TileCoord[],
  buildings: readonly { x: number; y: number; keep?: boolean; model?: number; yaw?: number }[],
  span: number,
  seed: number,
): CityLayout {
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
  let marked = false
  const built = buildings.map((tile) => {
    const keep = tile.keep === true
    if (keep) marked = true
    return {
      x: tile.x,
      y: tile.y,
      model: tile.model ?? hash(tile.x, tile.y, seed + 3) % CITY_MODELS,
      yaw: tile.yaw ?? hash(tile.x, tile.y, seed + 9) % 4,
      keep,
    }
  })
  if (!marked && built.length > 0) built[0].keep = true
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

function canPlaceStreet(x: number, y: number, roadSet: Set<number>): boolean {
  const touch = orthogonalStreets(x, y, roadSet)
  if (touch.length !== 1) return false
  const parent = touch[0]
  if (orthogonalStreets(parent.x, parent.y, roadSet).length >= 3) return false
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (!roadSet.has(key(nx, ny))) continue
      if (nx === parent.x && ny === parent.y) continue
      if (Math.abs(nx - parent.x) + Math.abs(ny - parent.y) !== 1) return false
    }
  }
  return true
}

function orthogonalStreets(x: number, y: number, roadSet: Set<number>): TileCoord[] {
  const found: TileCoord[] = []
  for (let dir = 0; dir < 4; dir++) {
    const nx = x + DIR_X[dir]
    const ny = y + DIR_Y[dir]
    if (roadSet.has(key(nx, ny))) found.push({ x: nx, y: ny })
  }
  return found
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
