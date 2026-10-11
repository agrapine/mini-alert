import { describe, expect, it } from 'vitest'
import { captureDuration, captureSpeed, cityContains, cityHolds, CITY_GROW_SECONDS, layoutCities, STREET_REACH, StreetKind, type CityLayout } from '../shared/cities.ts'
import { Terrain } from '../shared/tiles.ts'
import { UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { CREDIT_PER_CITY, CREDIT_PER_POPULATION } from './player.ts'
import { World } from './world.ts'

function cityGame() {
  const width = 20
  const height = 20
  const tiles = new Uint8Array(width * height).fill(Terrain.Land)
  tiles[8 * width + 9] = Terrain.Water
  const game = new Game(World.fromTiles(width, height, tiles))
  game.scenery = {
    coast: [],
    holes: [],
    roads: [],
    towns: [
      { x: 8, y: 8 },
      { x: 16, y: 16 },
    ],
    seed: 7,
  }
  game.bindCities()
  return game
}

describe('cities', () => {
  it('places buildings on walkable tiles and keeps the town tile open', () => {
    const game = cityGame()
    const layouts = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)
    expect(layouts).toEqual(
      layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height),
    )
    const towns = [
      { x: 8, y: 8 },
      { x: 16, y: 16 },
    ]
    for (let index = 0; index < layouts.length; index++) {
      const city = layouts[index]
      const anchor = towns[index]
      expect(city.span === 2 || city.span === 3 || city.span === 4).toBe(true)
      expect(city.tiles.length).toBe(city.span * city.span)
      expect(city.buildings.length).toBeGreaterThan(0)
      const roads = roadsOf(city)
      expect(roads.length).toBeGreaterThan(0)
      expect(connected(roads)).toBe(true)
      expect(roads.some((street) => street.x === anchor.x && street.y === anchor.y)).toBe(true)
      for (const building of city.buildings) {
        expect(building.x === anchor.x && building.y === anchor.y).toBe(false)
        expect(building.x === 9 && building.y === 8).toBe(false)
        expect(cityContains(city, building.x, building.y)).toBe(true)
        expect(building.model).toBeGreaterThanOrEqual(0)
        expect(building.model).toBeLessThan(8)
        expect(nextToStreet(building, roads)).toBe(true)
        expect(facesStreet(building, roads)).toBe(false)
      }
      for (const road of roads) {
        expect(nearestBuilding(road, city.buildings)).toBeLessThanOrEqual(STREET_REACH)
        expect(pieceMatches(road, roads)).toBe(true)
      }
    }
  })

  it('captures a neutral city faster than an owned one', () => {
    const game = cityGame()
    const human = game.addPlayer()
    const enemy = game.addPlayer()
    const layout = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)[0]
    const stand = streetTile(layout)
    game.spawn(human, UnitTypeId.Scout, { x: stand.x, y: stand.y }, 0)
    const neutral = captureDuration(layout.span, true)
    game.tick(neutral * 0.5)
    expect(game.cityStates()[0].ownerId).toBe(0)
    expect(game.cityStates()[0].progress).toBeCloseTo(0.5, 1)
    expect(game.creditIncome(human.id)).toBe(0)
    game.tick(neutral * 0.5)
    expect(game.cityStates()[0].ownerId).toBe(human.id)
    expect(game.creditIncome(human.id)).toBe(
      CREDIT_PER_CITY + CREDIT_PER_POPULATION * (layout.tiles.length + game.cityStates()[0].grown),
    )

    game.claimCity(game.scenery.towns[0], enemy.id)
    const owned = captureDuration(layout.span, false)
    game.tick(neutral)
    expect(game.cityStates()[0].ownerId).toBe(enemy.id)
    expect(game.cityStates()[0].progress).toBeCloseTo(neutral / owned, 1)
  })

  it('captures faster with more units in the city, up to five', () => {
    const game = cityGame()
    const human = game.addPlayer()
    const layout = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)[0]
    const streets = roadsOf(layout)
    game.spawn(human, UnitTypeId.Scout, streets[0], 0)
    const extra = streets.find((street) => street.x !== streets[0].x || street.y !== streets[0].y) ?? streets[0]
    game.spawn(human, UnitTypeId.Scout, extra, 0)
    const neutral = captureDuration(layout.span, true)
    game.tick(neutral * 0.2)
    expect(game.cityStates()[0].progress).toBeCloseTo(0.2 * captureSpeed(2), 1)
    expect(captureSpeed(9)).toBe(5)
  })

  it('freezes while both players stand inside and drains when the holder leaves', () => {
    const game = cityGame()
    const human = game.addPlayer()
    const enemy = game.addPlayer()
    const layout = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)[0]
    const stand = streetTile(layout, { x: 8, y: 8 })
    const scout = game.spawn(human, UnitTypeId.Scout, { x: stand.x, y: stand.y }, 0)
    game.tick(1)
    const held = game.cityStates()[0].progress
    expect(held).toBeGreaterThan(0)
    const foe = game.spawn(enemy, UnitTypeId.Scout, { x: 8, y: 8 }, 0)
    game.tick(3)
    expect(game.cityStates()[0].progress).toBeCloseTo(held, 5)
    scout.health = 0
    foe.health = 0
    game.tick(CAPTURE_WAIT)
    expect(game.cityStates()[0].progress).toBe(0)
    expect(game.cityStates()[0].challengerId).toBe(0)
  })

  it('captures from any block of the city and the tiles beside it', () => {
    const probe = cityGame()
    const layout = layoutCities(probe.scenery.towns, probe.scenery.seed, terrainOf(probe), probe.world.width, probe.world.height)[0]
    const roads = roadsOf(layout)
    const tiles = roads.map((road) => ({ x: road.x, y: road.y }))
    const beside = neighborOutside(layout.tiles)
    if (beside && probe.world.terrainAt(beside.x, beside.y) !== Terrain.Water) tiles.push(beside)
    for (const tile of tiles) {
      if (tile.x < 0 || tile.y < 0) continue
      if (probe.world.terrainAt(tile.x, tile.y) === Terrain.Water) continue
      const game = cityGame()
      const human = game.addPlayer()
      const unit = game.spawn(human, UnitTypeId.Scout, tile, 0)
      expect(cityHolds(layout, unit.pos.x, unit.pos.z)).toBe(true)
      game.tick(1)
      expect(game.cityStates()[0].progress).toBeGreaterThan(0)
    }
  })

  it('points spare units at the nearest city they do not own', () => {
    const game = cityGame()
    const human = game.addPlayer()
    game.claimCity(game.scenery.towns[0], human.id)
    const tile = game.nearestUnownedCityTile(human.id, { x: 0, y: 0 })
    expect(tile).not.toBeNull()
    const second = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)[1]
    expect(tile && cityContains(second, tile.x, tile.y)).toBe(true)
    game.claimCity(game.scenery.towns[1], human.id)
    expect(game.nearestUnownedCityTile(human.id, { x: 0, y: 0 })).toBeNull()
  })

  it('blocks movement through buildings and grows one cell every five seconds', () => {
    const game = cityGame()
    const human = game.addPlayer()
    game.claimCity(game.scenery.towns[0], human.id)
    const layout = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)[0]
    for (const building of layout.buildings) expect(game.pathfinder.isWalkable(building.x, building.y, -1)).toBe(false)
    const street = streetTile(layout)
    expect(game.pathfinder.isWalkable(street.x, street.y, -1)).toBe(true)
    const population = layout.tiles.length
    game.tick(CITY_GROW_SECONDS)
    expect(game.cityStates()[0].grown).toBe(0)
    const blocked = layout.buildings[0]
    const shifted = game.spawn(human, UnitTypeId.Scout, { x: blocked.x, y: blocked.y }, 0)
    expect(shifted.tile.x === blocked.x && shifted.tile.y === blocked.y).toBe(false)
    expect(game.pathfinder.occupant(blocked.x, blocked.y)).toBeNull()
    game.spawn(human, UnitTypeId.Scout, { x: street.x, y: street.y }, 0)
    game.tick(CITY_GROW_SECONDS / 2)
    expect(game.cityStates()[0].grown).toBe(0)
    game.tick(CITY_GROW_SECONDS)
    expect(game.cityStates()[0].grown).toBe(1)
    expect(game.creditIncome(human.id)).toBe(CREDIT_PER_CITY + CREDIT_PER_POPULATION * (population + 1))

    const neutral = cityGame()
    const visitor = neutral.addPlayer()
    const open = layoutCities(neutral.scenery.towns, neutral.scenery.seed, terrainOf(neutral), neutral.world.width, neutral.world.height)[0]
    const gate = streetTile(open)
    neutral.spawn(visitor, UnitTypeId.Scout, { x: gate.x, y: gate.y }, 0)
    neutral.tick(CITY_GROW_SECONDS)
    expect(neutral.cityStates()[0].grown).toBe(0)
    expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: 0, y: 19 })).toBe(false)
    const beside = roadsOf(layout).find(
      (road) =>
        (road.x !== street.x || road.y !== street.y) &&
        (road.x !== shifted.tile.x || road.y !== shifted.tile.y),
    )
    expect(beside).toBeDefined()
    if (beside) expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: beside.x, y: beside.y })).toBe(true)
  })
})

const CAPTURE_WAIT = 3

function terrainOf(game: Game): number[] {
  const terrain: number[] = []
  for (let y = 0; y < game.world.height; y++) {
    for (let x = 0; x < game.world.width; x++) terrain.push(game.world.terrainAt(x, y))
  }
  return terrain
}

function roadsOf(city: CityLayout) {
  const seen = new Set<string>()
  const roads: CityLayout['streets'] = []
  for (const street of city.streets) {
    if (street.kind >= StreetKind.Lamp) continue
    const id = `${street.x},${street.y}`
    if (seen.has(id)) continue
    seen.add(id)
    roads.push(street)
  }
  return roads
}

function connected(roads: readonly { x: number; y: number }[]): boolean {
  if (roads.length === 0) return false
  const present = new Set(roads.map((road) => `${road.x},${road.y}`))
  const seen = new Set<string>([`${roads[0].x},${roads[0].y}`])
  const queue = [roads[0]]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    for (const [dx, dy] of DIRS) {
      const id = `${current.x + dx},${current.y + dy}`
      if (!present.has(id) || seen.has(id)) continue
      seen.add(id)
      queue.push({ x: current.x + dx, y: current.y + dy })
    }
  }
  return seen.size === roads.length
}

function nextToStreet(building: { x: number; y: number }, roads: readonly { x: number; y: number }[]): boolean {
  return roads.some((road) => Math.abs(road.x - building.x) + Math.abs(road.y - building.y) === 1)
}

function nearestBuilding(road: { x: number; y: number }, buildings: readonly { x: number; y: number }[]): number {
  let best = Infinity
  for (const building of buildings) {
    const dist = Math.abs(road.x - building.x) + Math.abs(road.y - building.y)
    if (dist < best) best = dist
  }
  return best
}

function facesStreet(building: { x: number; y: number }, roads: readonly CityLayout['streets'][number][]): boolean {
  for (const road of roads) {
    const openings = openingsFor(road.kind, road.yaw)
    for (let dir = 0; dir < 4; dir++) {
      if ((openings & (1 << dir)) === 0) continue
      if (road.x + DIRS[dir][0] === building.x && road.y + DIRS[dir][1] === building.y) return true
    }
  }
  return false
}

function pieceMatches(road: CityLayout['streets'][number], roads: readonly { x: number; y: number }[]): boolean {
  const present = new Set(roads.map((tile) => `${tile.x},${tile.y}`))
  let neighbors = 0
  for (let dir = 0; dir < 4; dir++) {
    if (present.has(`${road.x + DIRS[dir][0]},${road.y + DIRS[dir][1]}`)) neighbors |= 1 << dir
  }
  const openings = openingsFor(road.kind, road.yaw)
  for (let dir = 0; dir < 4; dir++) {
    if ((neighbors & (1 << dir)) !== 0 && (openings & (1 << dir)) === 0) return false
  }
  const bits = pop(neighbors)
  if (bits >= 4) return road.kind === StreetKind.Junction
  if (bits === 3) return road.kind === StreetKind.Split
  if (bits === 2 && (neighbors === 0b0101 || neighbors === 0b1010)) {
    return road.kind === StreetKind.Straight || road.kind === StreetKind.Crossing
  }
  if (bits === 2) return road.kind === StreetKind.Corner || road.kind === StreetKind.Curve
  return road.kind === StreetKind.Straight
}

function openingsFor(kind: StreetKind, yaw: number): number {
  const base =
    kind === StreetKind.Junction
      ? 0b1111
      : kind === StreetKind.Split
        ? 0b0111
        : kind === StreetKind.Corner || kind === StreetKind.Curve
          ? 0b0011
          : 0b0101
  let out = 0
  const turn = yaw & 3
  for (let dir = 0; dir < 4; dir++) if (base & (1 << dir)) out |= 1 << ((dir + turn) & 3)
  return out
}

function pop(mask: number): number {
  let count = 0
  for (let dir = 0; dir < 4; dir++) if (mask & (1 << dir)) count += 1
  return count
}

function streetTile(layout: CityLayout, avoid?: { x: number; y: number }) {
  const street = roadsOf(layout).find((road) => !avoid || road.x !== avoid.x || road.y !== avoid.y)
  if (!street) throw new Error('city has no street')
  return street
}

const DIRS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const

function neighborOutside(tiles: readonly { x: number; y: number }[]): { x: number; y: number } | null {
  const taken = new Set(tiles.map((tile) => `${tile.x},${tile.y}`))
  for (const tile of tiles) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { x: tile.x + dx, y: tile.y + dy }
      if (next.x < 0 || next.y < 0) continue
      if (!taken.has(`${next.x},${next.y}`)) return next
    }
  }
  return null
}
