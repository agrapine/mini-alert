import { describe, expect, it } from 'vitest'
import { CAPTURE_DRAIN, captureDuration, captureFade, cityContains, cityHolds, CITY_GROW_SECONDS, layoutCities, lostStreets, populationOf, projectCity, settledCity, STREET_REACH, StreetKind, type CityLayout } from '../shared/cities.ts'
import { Terrain } from '../shared/tiles.ts'
import { HEAVY_TANK, SCOUT, TURRET, UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { CREDIT_PER_POPULATION } from './player.ts'
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
  it('frees the tile of a building as soon as it is ruined', () => {
    const game = cityGame()
    const runtime = game as unknown as { cities: { layout: CityLayout; ruins: { x: number; y: number }[] }[]; syncBlocks(): void }
    const city = runtime.cities[0]
    const building = city.layout.buildings[0]
    expect(game.pathfinder.isWalkable(building.x, building.y, -1)).toBe(false)
    city.ruins.push({ x: building.x, y: building.y })
    runtime.syncBlocks()
    expect(game.pathfinder.isWalkable(building.x, building.y, -1)).toBe(true)
  })

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
      expect(city.buildings.filter((building) => building.keep)).toHaveLength(1)
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
      expect(streetNeighbors(roads)).toBeLessThanOrEqual(3)
      expect(packedStreets(roads)).toBe(false)
    }
  })

  it('pulls up streets left farther than reach from a standing building', () => {
    const game = cityGame()
    const terrain = terrainOf(game)
    const base = layoutCities(game.scenery.towns, game.scenery.seed, terrain, game.world.width, game.world.height)[0]
    const layout = projectCity(base, 14, terrain, game.world.width, game.world.height)
    let dropped = 0
    for (const building of layout.buildings) {
      const ruins = [{ x: building.x, y: building.y }]
      const settled = settledCity(layout, ruins)
      const living = layout.buildings.filter((other) => other.x !== building.x || other.y !== building.y)
      for (const street of roadsOf(settled)) {
        expect(nearestBuilding(street, living)).toBeLessThanOrEqual(STREET_REACH)
      }
      const lost = lostStreets(layout, ruins)
      for (const street of lost) {
        dropped += 1
        expect(nearestBuilding(street, living)).toBeGreaterThan(STREET_REACH)
      }
      expect(lostStreets(layout, ruins.concat(lost))).toEqual([])
    }
    expect(dropped).toBeGreaterThan(0)
  })

  it('captures a city in five seconds per building for one scout', () => {
    const game = cityGame()
    const human = game.addPlayer()
    const enemy = game.addPlayer()
    const layout = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)[0]
    const stand = streetTile(layout)
    game.spawn(human, UnitTypeId.Scout, { x: stand.x, y: stand.y }, 0)
    const duration = captureDuration(populationOf(layout))
    expect(duration).toBe(populationOf(layout) * 5)
    game.tick(duration * 0.5)
    expect(game.cityStates()[0].ownerId).toBe(0)
    expect(game.cityStates()[0].progress).toBeCloseTo(0.5, 1)
    expect(game.creditIncome(human.id)).toBe(0)
    game.tick(duration * 0.5)
    expect(game.cityStates()[0].ownerId).toBe(human.id)
    const held = projectCity(layout, game.cityStates()[0].grown, terrainOf(game), game.world.width, game.world.height)
    expect(game.creditIncome(human.id)).toBe(CREDIT_PER_POPULATION * populationOf(held))

    game.claimCity(game.scenery.towns[0], enemy.id)
    const owned = projectCity(layout, game.cityStates()[0].grown, terrainOf(game), game.world.width, game.world.height)
    const ownedDuration = captureDuration(populationOf(owned, game.cityStates()[0].ruins))
    game.tick(ownedDuration * 0.5)
    expect(game.cityStates()[0].ownerId).toBe(enemy.id)
    expect(game.cityStates()[0].progress).toBeCloseTo(0.5, 1)
  })

  it('captures faster as the units supply adds up', () => {
    const game = cityGame()
    const human = game.addPlayer()
    const layout = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)[0]
    const streets = roadsOf(layout)
    game.spawn(human, UnitTypeId.Scout, streets[0], 0)
    const extra = streets.find((street) => street.x !== streets[0].x || street.y !== streets[0].y) ?? streets[0]
    game.spawn(human, UnitTypeId.Scout, extra, 0)
    const duration = captureDuration(populationOf(layout))
    game.tick(duration * 0.2)
    expect(game.cityStates()[0].progress).toBeCloseTo(0.2 * SCOUT.supply * 2, 1)

    const heavyGame = cityGame()
    const commander = heavyGame.addPlayer()
    const heavyLayout = layoutCities(heavyGame.scenery.towns, heavyGame.scenery.seed, terrainOf(heavyGame), heavyGame.world.width, heavyGame.world.height)[0]
    heavyGame.spawn(commander, UnitTypeId.HeavyTank, streetTile(heavyLayout), 0)
    const heavyDuration = captureDuration(populationOf(heavyLayout))
    heavyGame.tick(heavyDuration * 0.2)
    expect(heavyGame.cityStates()[0].progress).toBeCloseTo(0.2 * HEAVY_TANK.supply, 1)
  })

  it('freezes while both players stand inside', () => {
    const game = cityGame()
    const human = game.addPlayer()
    const enemy = game.addPlayer()
    const layout = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)[0]
    const stand = streetTile(layout, { x: 8, y: 8 })
    game.spawn(human, UnitTypeId.Scout, { x: stand.x, y: stand.y }, 0)
    const duration = captureDuration(populationOf(layout))
    game.tick(duration * 0.2)
    const held = game.cityStates()[0].progress
    expect(held).toBeGreaterThan(0)
    game.spawn(enemy, UnitTypeId.Scout, { x: 8, y: 8 }, 0)
    game.tick(3)
    expect(game.cityStates()[0].progress).toBeCloseTo(held, 5)
  })

  it('keeps capture progress after leaving and lets other units clear it faster', () => {
    const game = cityGame()
    const human = game.addPlayer()
    const enemy = game.addPlayer()
    const layout = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)[0]
    const roads = roadsOf(layout)
    const scout = game.spawn(human, UnitTypeId.Scout, roads[0], 0)
    const duration = captureDuration(populationOf(layout))
    game.tick(duration * 0.5)
    const held = game.cityStates()[0].progress
    expect(held).toBeCloseTo(0.5, 1)
    scout.health = 0
    game.tick(4)
    const faded = game.cityStates()[0].progress
    expect(faded).toBeGreaterThan(0.2)
    expect(faded).toBeCloseTo(held - 4 / CAPTURE_DRAIN, 2)
    expect(game.cityStates()[0].challengerId).toBe(human.id)

    const stand = roads.find((road) => road.x !== roads[0].x || road.y !== roads[0].y) ?? roads[0]
    const extra = roads.find((road) => (road.x !== roads[0].x || road.y !== roads[0].y) && (road.x !== stand.x || road.y !== stand.y)) ?? stand
    game.spawn(enemy, UnitTypeId.Scout, stand, 0)
    game.spawn(enemy, UnitTypeId.Scout, extra, 0)
    const before = game.cityStates()[0].progress
    game.tick(1)
    const people = populationOf(layout)
    expect(game.cityStates()[0].progress).toBeCloseTo(before - 1 / captureFade(SCOUT.supply * 2, people), 2)
    expect(captureFade(0, people)).toBe(CAPTURE_DRAIN)
    expect(captureFade(SCOUT.supply * 2, people)).toBe(captureDuration(people) / (SCOUT.supply * 2))
  })

  it('captures from any city square, including streets', () => {
    const probe = cityGame()
    const layout = layoutCities(probe.scenery.towns, probe.scenery.seed, terrainOf(probe), probe.world.width, probe.world.height)[0]
    for (const building of layout.buildings) {
      expect(cityHolds(layout, building.x + 0.5, building.y + 0.5)).toBe(true)
    }
    for (const road of roadsOf(layout)) {
      if (probe.world.terrainAt(road.x, road.y) === Terrain.Water) continue
      const game = cityGame()
      const human = game.addPlayer()
      const unit = game.spawn(human, UnitTypeId.Scout, road, 0)
      expect(cityHolds(layout, unit.pos.x, unit.pos.z)).toBe(true)
      game.tick(1)
      expect(game.cityStates()[0].progress).toBeGreaterThan(0)
    }
    const beside = neighborOutside(layout.tiles)
    expect(beside).not.toBeNull()
    if (beside) expect(cityHolds(layout, beside.x + 0.5, beside.y + 0.5)).toBe(false)
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
    const grownLayout = projectCity(layout, 1, terrainOf(game), game.world.width, game.world.height)
    expect(game.creditIncome(human.id)).toBe(CREDIT_PER_POPULATION * populationOf(grownLayout))
    expect(packedStreets(roadsOf(grownLayout))).toBe(false)
    expect(streetNeighbors(roadsOf(grownLayout))).toBeLessThanOrEqual(3)

    const neutral = cityGame()
    const visitor = neutral.addPlayer()
    const open = layoutCities(neutral.scenery.towns, neutral.scenery.seed, terrainOf(neutral), neutral.world.width, neutral.world.height)[0]
    const gate = streetTile(open)
    neutral.spawn(visitor, UnitTypeId.Scout, { x: gate.x, y: gate.y }, 0)
    neutral.tick(CITY_GROW_SECONDS)
    expect(neutral.cityStates()[0].grown).toBe(0)
    expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: 0, y: 19 })).toBe(false)
    let guard = 0
    while (game.creditIncome(human.id) / CREDIT_PER_POPULATION < TURRET.supply && guard < 12) {
      game.tick(CITY_GROW_SECONDS)
      guard += 1
    }
    shifted.health = 0
    for (const unit of game.units) if (unit.ownerId === human.id) unit.health = 0
    game.tick(0)
    const beside = roadsOf(layout).find(
      (road) =>
        (road.x !== street.x || road.y !== street.y) &&
        (road.x !== shifted.tile.x || road.y !== shifted.tile.y),
    )
    expect(beside).toBeDefined()
    if (beside) expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: beside.x, y: beside.y })).toBe(true)
  })
})

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

function streetNeighbors(roads: readonly { x: number; y: number }[]): number {
  const present = new Set(roads.map((road) => `${road.x},${road.y}`))
  let widest = 0
  for (const road of roads) {
    let count = 0
    for (const [dx, dy] of DIRS) if (present.has(`${road.x + dx},${road.y + dy}`)) count += 1
    if (count > widest) widest = count
  }
  return widest
}

function packedStreets(roads: readonly { x: number; y: number }[]): boolean {
  const present = new Set(roads.map((road) => `${road.x},${road.y}`))
  for (const road of roads) {
    const east = present.has(`${road.x + 1},${road.y}`)
    const south = present.has(`${road.x},${road.y + 1}`)
    const corner = present.has(`${road.x + 1},${road.y + 1}`)
    if (east && south && corner) return true
  }
  return false
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
