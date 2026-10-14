import type { CitySite, MapPoint } from './protocol.ts'
import { isWalkableTerrain, Terrain, type TileCoord } from './tiles.ts'

export const NEUTRAL_CITY = 0xffffff
export const CAPTURE_DRAIN = 60
export const CAPTURE_PER_POP = 5
export const CITY_GROW_SECONDS = 4
export const UPGRADE_REST = 2
export const STREET_REACH = 8
export const STRUCTURE_RANGE = 8
export const CITY_SIGHT = 10
export const SIEGE_RANGE = 6
export const BUILDING_HP = 120
export const STREET_HP = 60
export const BUILDING_COST = 100

export const DENSITY_MIN = 1
export const DENSITY_MAX = 20

export const CITY_CATALOG: readonly { name: string; density: number }[] = [
  { name: 'building-h', density: 7 },
  { name: 'building-i', density: 1 },
  { name: 'building-j', density: 8 },
  { name: 'building-k', density: 9 },
  { name: 'building-o', density: 10 },
  { name: 'chimney-basic', density: 3 },
  { name: 'chimney-medium', density: 2 },
  { name: 'chimney-small', density: 3 },
  { name: 'detail-tank', density: 3 },
  { name: 'shipping-container-a', density: 1 },
  { name: 'shipping-container-b', density: 1 },
  // { name: 'shipping-container-c', density: 1 },
  // { name: 'solar-panel-flat', density: 1 },
  // { name: 'solar-panel-landscape', density: 1 },
  { name: 'solar-panel-portrait', density: 2 },
  { name: 'building-d', density: 11 },
  { name: 'building-g', density: 12 },
  { name: 'building-n', density: 13 },
  { name: 'building-p', density: 14 },
  { name: 'building-s', density: 15 },
  { name: 'chimney-large', density: 3 },
  { name: 'detail-tank-large', density: 4 },
  { name: 'solar-panel-landscape-group', density: 4 },
  { name: 'solar-panel-portrait-group', density: 3 },
  { name: 'windmill-low', density: 5 },
  { name: 'building-e', density: 16 },
  { name: 'building-m', density: 17 },
  { name: 'building-q', density: 18 },
  { name: 'building-t', density: 18 },
  { name: 'water-tower', density: 6 },
  { name: 'windmill', density: 6 },
  { name: 'building-a', density: 19 },
  { name: 'building-b', density: 19 },
  { name: 'building-c', density: 19 },
  { name: 'building-f', density: 20 },
  { name: 'building-l', density: 20 },
  { name: 'building-r', density: 20 },
]

const RANK_MODELS: number[][] = Array.from({ length: DENSITY_MAX + 1 }, () => [])
for (let index = 0; index < CITY_CATALOG.length; index++) RANK_MODELS[CITY_CATALOG[index].density].push(index)

export const CITY_MODELS = CITY_CATALOG.length
export const HALL_MODEL = CITY_CATALOG.findIndex((entry) => entry.name === 'water-tower')

export function densityOf(model: number): number {
  return CITY_CATALOG[model]?.density ?? DENSITY_MIN
}

export function modelAtRank(rank: number, salt: number): number {
  const pool = RANK_MODELS[rank]
  const models = pool && pool.length > 0 ? pool : RANK_MODELS[DENSITY_MIN]
  return models[(salt >>> 0) % models.length]
}

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
  upgradeRest?: number
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
  spanY = footprint,
): boolean {
  for (let dy = 0; dy < spanY; dy++) {
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
  return footprint > 0 && spanY > 0
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
  return compose(roads, buildings, layout.span, layout.seed, layout.upgradeRest ?? 0)
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
    if (!ruined) count += densityOf(building.model)
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
  const buildings: { x: number; y: number; keep?: boolean; model?: number; yaw?: number }[] = city.buildings.map((building) => ({
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
  const center = roads[0] ?? { x: city.x, y: city.y }
  const salt = growthSalt(city)
  const seeding = city.tiles.length < city.span * city.span
  const needPlot =
    buildings.length === 0 ||
    farthestStreet(roads, buildings) > STREET_REACH ||
    (seeding && !buildings.some((building) => !building.keep))
  let bestScore = -Infinity
  let bestPlot: TileCoord | null = null
  let bestUpgrade: { x: number; y: number; model: number } | null = null
  let bestRun: TileCoord[] | null = null

  const resting = (city.upgradeRest ?? 0) > 0
  const nextRest = resting ? (city.upgradeRest ?? 0) - 1 : 0
  const people = buildings.reduce((sum, building) => sum + densityOf(building.model ?? 0), 0)
  const radius = seeding ? Infinity : cityRadius(people)
  const sprawl = seeding ? 1 : sprawlOf(buildings.length)
  for (const plot of plotsOf(city, roads, roadSet, buildingSet, terrain, width, height)) {
    if (spanDist(plot.x, plot.y, center) > radius) continue
    const score = spreadScore(plot.x, plot.y, center, salt) * sprawl
    if (score <= bestScore) continue
    bestScore = score
    bestPlot = plot
    bestUpgrade = null
    bestRun = null
  }
  if (needPlot) {
    if (!bestPlot) return null
    const hall = buildings.length === 0
    return compose(
      roads,
      buildings.concat({
        x: bestPlot.x,
        y: bestPlot.y,
        keep: hall,
        model: hall ? HALL_MODEL : modelAtRank(DENSITY_MIN, hash(bestPlot.x, bestPlot.y, salt)),
      }),
      city.span,
      city.seed,
      nextRest,
    )
  }

  if (!seeding && !resting) {
    const pressure = 1 + Math.log(1 + people)
    for (const building of buildings) {
      if (building.keep) continue
      const away = spanDist(building.x, building.y, center)
      const current = densityOf(building.model ?? 0)
      const next = current + 1
      if (next > targetDensity(away, people)) continue
      const score = spreadScore(building.x, building.y, center, salt + 3) * crowdAt(building.x, building.y, buildings) * pressure
      if (score <= bestScore) continue
      bestScore = score
      bestPlot = null
      bestRun = null
      bestUpgrade = { x: building.x, y: building.y, model: modelAtRank(next, hash(building.x, building.y, salt + next)) }
    }
  }

  for (let i = 0; i < roads.length; i++) {
    const road = roads[i]
    for (let dir = 0; dir < 4; dir++) {
      const run = traceRun(road, dir, roads, roadSet, buildingSet, buildings, terrain, width, height, city.seed, center, radius, salt + dir + 1)
      if (run.length === 0) continue
      const score = spreadScore(run[0].x, run[0].y, center, salt + 11) * sprawl
      if (score <= bestScore) continue
      bestScore = score
      bestPlot = null
      bestUpgrade = null
      bestRun = run
    }
  }

  if (bestUpgrade) {
    const chosen = bestUpgrade
    const next = buildings.map((building) =>
      building.x === chosen.x && building.y === chosen.y ? { ...building, model: chosen.model } : building,
    )
    return compose(roads, next, city.span, city.seed, UPGRADE_REST)
  }
  if (bestRun) return compose(roads.concat(bestRun), buildings, city.span, city.seed, nextRest)
  if (!bestPlot) return null
  return compose(
    roads,
    buildings.concat({
      x: bestPlot.x,
      y: bestPlot.y,
      keep: false,
      model: modelAtRank(DENSITY_MIN, hash(bestPlot.x, bestPlot.y, salt)),
    }),
    city.span,
    city.seed,
    nextRest,
  )
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

const AXIS_H = 1
const AXIS_V = 2

function growthSalt(city: CityLayout): number {
  let stamp = hash(city.tiles.length, city.buildings.length, city.seed)
  for (const building of city.buildings) stamp = hash(stamp, building.model, key(building.x, building.y))
  return stamp
}

const LOT_REACH = 2
const RADIUS_BASE = 1.6
const RADIUS_LOG = 1.7
const DENSITY_FALLOFF = 2.4

export function cityRadius(population: number): number {
  return RADIUS_BASE + Math.log(1 + Math.max(0, population)) * RADIUS_LOG
}

function spanDist(x: number, y: number, center: TileCoord): number {
  return Math.hypot(x - center.x, y - center.y)
}

function targetDensity(dist: number, population: number): number {
  const grown = Math.log(1 + Math.max(0, population))
  const aim = Math.min(DENSITY_MAX, 1 + grown * 2.8)
  const falloff = DENSITY_FALLOFF + grown * 0.45
  const core = Math.max(0, dist - 1)
  const level = Math.round(aim * Math.exp(-core / falloff))
  if (level < DENSITY_MIN) return DENSITY_MIN
  if (level > DENSITY_MAX) return DENSITY_MAX
  return level
}

function spreadScore(x: number, y: number, center: TileCoord, salt: number): number {
  const away = spanDist(x, y, center)
  const noise = ((hash(x, y, salt) % 1000) / 1000) * 0.02
  return Math.exp(-away) + noise
}

function sprawlOf(buildings: number): number {
  return 1 / (1 + buildings * buildings * 0.08)
}

function crowdAt(
  x: number,
  y: number,
  buildings: readonly { x: number; y: number; model?: number }[],
): number {
  let sum = 0
  for (const building of buildings) {
    if (Math.max(Math.abs(building.x - x), Math.abs(building.y - y)) > 2) continue
    sum += densityOf(building.model ?? 0)
  }
  return Math.max(1, sum)
}

function plotsOf(
  city: CityLayout,
  roads: readonly TileCoord[],
  roadSet: Set<number>,
  buildingSet: Set<number>,
  terrain: ArrayLike<number>,
  width: number,
  height: number,
): TileCoord[] {
  const frame = plotFrame(city, roads, roadSet)
  const found: TileCoord[] = []
  const seen = new Set<number>()
  for (const road of roads) {
    for (let dy = -LOT_REACH; dy <= LOT_REACH; dy++) {
      for (let dx = -LOT_REACH; dx <= LOT_REACH; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) > LOT_REACH || (dx === 0 && dy === 0)) continue
        const x = road.x + dx
        const y = road.y + dy
        const id = key(x, y)
        if (seen.has(id) || frame.forbidden.has(id)) continue
        if (!openLand(x, y, roadSet, buildingSet, terrain, width, height)) continue
        seen.add(id)
        found.push({ x, y })
      }
    }
  }
  return found
}

function traceRun(
  origin: TileCoord,
  dir: number,
  roads: readonly TileCoord[],
  roadSet: Set<number>,
  buildingSet: Set<number>,
  buildings: readonly TileCoord[],
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  seed: number,
  center: TileCoord,
  radius: number,
  salt: number,
): TileCoord[] {
  const horizontal = DIR_X[dir] !== 0
  const length = 1 + (hash(origin.x + DIR_X[dir], origin.y + DIR_Y[dir], salt) % 4)
  const run: TileCoord[] = []
  const localRoads = roads.slice()
  const localSet = new Set(roadSet)
  let prev = origin
  for (let step = 0; step < length; step++) {
    const x = prev.x + DIR_X[dir]
    const y = prev.y + DIR_Y[dir]
    const away = spanDist(x, y, center)
    if (away > radius) break
    if (step > 0 && hash(x, y, salt + step) % 1000 >= 1000 * Math.exp(-away / 2)) break
    if (!openLand(x, y, localSet, buildingSet, terrain, width, height)) break
    const touch = orthogonalStreets(x, y, localSet)
    if (touch.length !== 1 || touch[0].x !== prev.x || touch[0].y !== prev.y) break
    if (parallelClose(x, y, horizontal, localRoads, localSet)) break
    const id = key(x, y)
    localSet.add(id)
    if (opensOntoBuilding(x, y, localSet, buildingSet, seed) || distanceToBuilding({ x, y }, buildings) > STREET_REACH) {
      localSet.delete(id)
      break
    }
    const tile = { x, y }
    run.push(tile)
    localRoads.push(tile)
    prev = tile
  }
  return run
}

function parallelClose(
  x: number,
  y: number,
  horizontal: boolean,
  roads: readonly TileCoord[],
  roadSet: Set<number>,
): boolean {
  for (const road of roads) {
    const axis = roadAxis(road.x, road.y, roadSet)
    if (horizontal) {
      if ((axis & AXIS_H) === 0) continue
      if (Math.abs(road.y - y) === 1 && Math.abs(road.x - x) <= 2) return true
    } else if ((axis & AXIS_V) !== 0 && Math.abs(road.x - x) === 1 && Math.abs(road.y - y) <= 2) {
      return true
    }
  }
  return false
}

function roadAxis(x: number, y: number, roadSet: Set<number>): number {
  let axis = 0
  if (roadSet.has(key(x + 1, y)) || roadSet.has(key(x - 1, y))) axis |= AXIS_H
  if (roadSet.has(key(x, y + 1)) || roadSet.has(key(x, y - 1))) axis |= AXIS_V
  return axis
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
  for (const road of roads) {
    if (Math.max(Math.abs(road.x - x), Math.abs(road.y - y)) <= LOT_REACH) return true
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
  return compose(roads, buildings.concat({ ...plot, keep: false }), city.span, city.seed, city.upgradeRest ?? 0)
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
      forbidden.add(key(road.x + DIR_X[dir] * LOT_REACH, road.y + DIR_Y[dir] * LOT_REACH))
    }
  }
  return { forbidden, openings }
}

function compose(
  roads: readonly TileCoord[],
  buildings: readonly { x: number; y: number; keep?: boolean; model?: number; yaw?: number }[],
  span: number,
  seed: number,
  upgradeRest = 0,
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
      model: tile.model ?? modelAtRank(DENSITY_MIN, hash(tile.x, tile.y, seed + 3)),
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
    upgradeRest,
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
  const tile = terrain[y * width + x]
  return tile === Terrain.Tree || isWalkableTerrain(tile)
}

function hash(x: number, y: number, seed: number): number {
  let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ (seed | 0)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n ^ (n >>> 16)) >>> 0
}
