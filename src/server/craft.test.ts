import { describe, expect, it } from 'vitest'
import { Flight } from '../shared/flight.ts'
import { AIRPORT, CRUISER, JET, SHIPYARD, UnitTypeId, WeaponKind } from '../shared/unit-types.ts'
import { CREDIT_PER_POPULATION } from './player.ts'
import { Terrain } from '../shared/tiles.ts'
import { Game } from './game.ts'
import { World } from './world.ts'

const STEP = 1 / 30

function seat(game: Game, playerId: number, x: number, y: number) {
  game.scenery = { coast: [], holes: [], roads: [], towns: [{ x: x + 0.5, y: y + 0.5 }], seed: 3 }
  game.bindCities()
  game.claimCity({ x: x + 0.5, y: y + 0.5 }, playerId)
}

function padPop(game: Game, playerId: number, people: number) {
  let added = 0
  while (game.creditIncome(playerId) / CREDIT_PER_POPULATION < people && added < 8) {
    added += 1
    game.scenery.towns.push({ x: game.world.width - 1.5, y: 0.5 + (added - 1) * 5 })
    game.bindCities()
    for (const town of game.scenery.towns) game.claimCity(town, playerId)
  }
}

describe('craft', () => {
  it('trains a jet on the strip, circles the order, and can be sent home', () => {
    const game = new Game(new World(28, 16))
    const human = game.addPlayer()
    seat(game, human.id, 10, 8)
    padPop(game, human.id, AIRPORT.supply + JET.supply)
    expect(game.trySpawn(human.id, UnitTypeId.Jet)).toBe(false)
    expect(game.placeBuilding(human.id, UnitTypeId.Airport, { x: 4, y: 6 })).toBe(true)
    game.finishBuild(human.id)
    const airport = game.units.find((unit) => unit.typeId === UnitTypeId.Airport)
    expect(airport).toBeDefined()
    expect(game.trySpawn(human.id, UnitTypeId.Jet)).toBe(true)
    game.tick(JET.buildTime)
    const jet = game.units.find((unit) => unit.typeId === UnitTypeId.Jet)
    expect(jet).toBeDefined()
    if (!jet || !airport) return
    expect(jet.home).toEqual({ x: airport.tile.x, y: airport.tile.y })
    expect(jet.tile).toEqual(airport.tile)
    expect(jet.flight).toBe(Flight.Ground)
    expect(game.orderMove(human.id, jet.id, { x: 22, y: 6 })).toBe(true)
    expect(jet.returning).toBe(false)
    expect(jet.flight).toBe(Flight.Takeoff)
    expect(jet.path.some((tile) => tile.y === airport.tile.y + 3)).toBe(true)
    let guard = 0
    while (jet.flight !== Flight.Orbit && guard < 30 * 12) {
      game.tick(STEP)
      guard += 1
    }
    expect(jet.flight).toBe(Flight.Orbit)
    expect(jet.returning).toBe(false)
    expect(game.orderMove(human.id, jet.id, airport.tile)).toBe(true)
    expect(jet.returning).toBe(true)
  })

  it('launches a cruiser onto water and refuses a land order', () => {
    const width = 24
    const height = 16
    const tiles = new Uint8Array(width * height)
    for (let y = 2; y <= 4; y++) {
      for (let x = 0; x < width; x++) tiles[y * width + x] = Terrain.Water
    }
    const game = new Game(World.fromTiles(width, height, tiles))
    const human = game.addPlayer()
    seat(game, human.id, 12, 10)
    padPop(game, human.id, SHIPYARD.supply + CRUISER.supply)
    expect(game.placeBuilding(human.id, UnitTypeId.Shipyard, { x: 6, y: 6 })).toBe(false)
    expect(game.placeBuilding(human.id, UnitTypeId.Shipyard, { x: 12, y: 3 })).toBe(true)
    game.finishBuild(human.id)
    expect(game.trySpawn(human.id, UnitTypeId.Cruiser)).toBe(true)
    game.tick(20)
    const ship = game.units.find((unit) => unit.typeId === UnitTypeId.Cruiser)
    expect(ship).toBeDefined()
    if (!ship) return
    expect(game.world.terrainAt(ship.tile.x, ship.tile.y)).toBe(Terrain.Water)
    expect(game.orderMove(human.id, ship.id, { x: 18, y: 2 })).toBe(true)
    expect(ship.path.every((tile) => game.world.terrainAt(tile.x, tile.y) === Terrain.Water)).toBe(true)
    expect(game.orderMove(human.id, ship.id, { x: 18, y: 8 })).toBe(false)
  })

  it('fires five rockets and reloads only after landing at its airport', () => {
    const game = new Game(new World(28, 16))
    const human = game.addPlayer()
    const enemy = game.addPlayer()
    seat(game, human.id, 10, 8)
    padPop(game, human.id, AIRPORT.supply)
    expect(game.placeBuilding(human.id, UnitTypeId.Airport, { x: 4, y: 6 })).toBe(true)
    game.finishBuild(human.id)
    const airport = game.units.find((unit) => unit.typeId === UnitTypeId.Airport)
    const jet = game.spawn(human, UnitTypeId.Jet, { x: 20, y: 4 }, 0)
    const foe = game.spawn(enemy, UnitTypeId.Scout, { x: 20, y: 14 }, 0)
    if (!airport) return
    foe.health = 5000
    jet.home = { x: airport.tile.x, y: airport.tile.y }
    jet.tile = { x: 20, y: 4 }
    jet.pos = { x: 20.5, z: 4.5 }
    jet.facing = 0
    jet.flight = Flight.Cruise
    jet.altitude = 2.6
    const opening = game.tick(STEP)
    expect(opening[0]?.kind).toBe(WeaponKind.Rocket)
    expect(opening[0]?.flight).toBeGreaterThan(0)
    expect(foe.health).toBe(5000)
    let rockets = opening.length
    for (let i = 0; i < 80 && rockets < 5; i++) {
      rockets += game.tick(0.2).filter((shot) => shot.kind === WeaponKind.Rocket).length
    }
    expect(rockets).toBe(5)
    expect(jet.rounds).toBe(0)
    game.tick(STEP)
    expect(jet.returning).toBe(true)
    const phase = () => jet.flight as Flight
    let guard = 0
    while (phase() !== Flight.Ground && guard < 30 * 25) {
      game.tick(STEP)
      if (phase() !== Flight.Ground) expect(jet.rounds).toBe(0)
      guard += 1
    }
    expect(phase()).toBe(Flight.Ground)
    expect(jet.rounds).toBe(JET.weapon.magazine)
    expect(jet.tile.x).toBeGreaterThanOrEqual(airport.tile.x)
    expect(jet.tile.x).toBeLessThan(airport.tile.x + 2)
    expect(jet.tile.y).toBeGreaterThanOrEqual(airport.tile.y)
    expect(jet.tile.y).toBeLessThan(airport.tile.y + 4)
  })
})
