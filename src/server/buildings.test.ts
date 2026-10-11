import { describe, expect, it } from 'vitest'
import { CITY_GROW_SECONDS, layoutCities, populationOf } from '../shared/cities.ts'
import { ARTILLERY, FACTORY, HEAVY_TANK, MED_TANK, SCOUT, TURRET, UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { CREDIT_PER_POPULATION, INCOME_SECONDS } from './player.ts'
import { Terrain } from '../shared/tiles.ts'
import { World } from './world.ts'

function seat(game: Game, playerId: number, x: number, y: number) {
  game.scenery = { coast: [], holes: [], roads: [], towns: [{ x: x + 0.5, y: y + 0.5 }], seed: 11 }
  game.bindCities()
  game.claimCity({ x: x + 0.5, y: y + 0.5 }, playerId)
}

describe('buildings', () => {
  it('pauses a structure when credits run out and keeps what was already paid', () => {
    const game = new Game(new World(12, 12))
    const human = game.addPlayer()
    human.credits = 100
    seat(game, human.id, 8, 2)
    expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: 2, y: 2 })).toBe(true)
    quiet(game, 8, 2)
    expect(human.credits).toBe(100)
    game.tick(TURRET.buildTime)
    expect(game.units[0].progress).toBeCloseTo(100 / TURRET.cost)
    expect(human.credits).toBeCloseTo(0)
    game.tick(TURRET.buildTime)
    expect(game.units[0].progress).toBeCloseTo(100 / TURRET.cost)
    expect(human.credits).toBeCloseTo(0)
  })

  it('places several structures and builds them one at a time', () => {
    const game = new Game(new World(16, 16))
    const human = game.addPlayer()
    seat(game, human.id, 4, 10)
    expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: 2, y: 2 })).toBe(true)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 6, y: 6 })).toBe(true)
    quiet(game, 4, 10)
    expect(human.credits).toBe(10_000)
    const turret = game.units[0]
    const factory = game.units[1]
    expect(game.pathfinder.occupant(6, 6)).toBe(factory.id)
    expect(game.pathfinder.occupant(7, 7)).toBe(factory.id)
    game.tick(2.5)
    expect(turret.progress).toBeCloseTo(0.5)
    expect(factory.progress).toBe(0)
    expect(human.credits).toBeCloseTo(10_000 - TURRET.cost / 2)
    game.tick(2.5)
    expect(turret.progress).toBe(1)
    expect(factory.progress).toBe(0)
    expect(human.credits).toBeCloseTo(10_000 - TURRET.cost)
    game.tick(4)
    expect(factory.progress).toBeCloseTo(0.5)
    expect(human.credits).toBeCloseTo(10_000 - TURRET.cost - FACTORY.cost / 2)
  })

  it('queues unit production and finishes one at a time', () => {
    const game = new Game(new World(16, 16))
    const human = game.addPlayer()
    seat(game, human.id, 10, 4)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 4, y: 4 })).toBe(true)
    game.finishBuild(human.id)
    expect(human.credits).toBe(10_000 - FACTORY.cost)
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(true)
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(true)
    expect(human.credits).toBe(10_000 - FACTORY.cost)
    expect(game.units.filter((unit) => unit.typeId === UnitTypeId.Scout)).toHaveLength(0)
    expect(game.trainingFor(human.id)[0]?.progress).toBe(0)
    const pace = 1.25
    game.tick(SCOUT.buildTime / 2)
    expect(game.trainingFor(human.id)).toHaveLength(2)
    expect(game.trainingFor(human.id)[0]?.progress).toBeCloseTo(0.5 * pace)
    expect(game.trainingFor(human.id)[1]?.progress).toBe(0)
    expect(human.credits).toBeCloseTo(10_000 - FACTORY.cost - SCOUT.cost * 0.5 * pace)
    game.tick(SCOUT.buildTime / 2)
    expect(game.units.filter((unit) => unit.typeId === UnitTypeId.Scout)).toHaveLength(1)
    expect(game.trainingFor(human.id)[0]?.progress).toBeCloseTo(0.25)
    game.tick(SCOUT.buildTime)
    expect(game.units.filter((unit) => unit.typeId === UnitTypeId.Scout)).toHaveLength(2)
    expect(game.trainingFor(human.id)).toHaveLength(0)
    expect(human.credits).toBeCloseTo(10_000 - FACTORY.cost - SCOUT.cost * 2)
  })

  it('cancels the latest queued build and leaves credits already spent', () => {
    const game = new Game(new World(16, 16))
    const human = game.addPlayer()
    seat(game, human.id, 4, 10)
    expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: 2, y: 2 })).toBe(true)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 6, y: 6 })).toBe(true)
    quiet(game, 4, 10)
    expect(game.cancelBuild(human.id, UnitTypeId.Factory)).toBe(true)
    game.tick(0)
    expect(game.units.map((unit) => unit.typeId)).toEqual([UnitTypeId.Turret])
    game.tick(TURRET.buildTime / 2)
    expect(human.credits).toBeCloseTo(10_000 - TURRET.cost / 2)
    expect(game.cancelBuild(human.id, UnitTypeId.Turret)).toBe(true)
    game.tick(0)
    expect(game.units).toHaveLength(0)
    expect(human.credits).toBeCloseTo(10_000 - TURRET.cost / 2)

    game.claimCity({ x: 4.5, y: 10.5 }, human.id)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 6, y: 6 })).toBe(true)
    game.finishBuild(human.id)
    const layout = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), game.world.width, game.world.height)[0]
    const road = layout.streets.find((street) => street.kind < 6)
    expect(road).toBeDefined()
    if (!road) return
    const holder = game.spawn(human, UnitTypeId.Scout, { x: road.x, y: road.y }, 0)
    let guard = 0
    while (game.creditIncome(human.id) < SCOUT.supply + MED_TANK.supply + SCOUT.supply && guard < 8) {
      game.tick(CITY_GROW_SECONDS)
      guard += 1
    }
    holder.health = 0
    game.tick(0)
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(true)
    expect(game.trySpawn(human.id, UnitTypeId.MedTank)).toBe(true)
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(true)
    expect(game.cancelTraining(human.id, UnitTypeId.Scout)).toBe(true)
    expect(game.trainingFor(human.id).map((job) => job.typeId)).toEqual([UnitTypeId.Scout, UnitTypeId.MedTank])
    game.tick(SCOUT.buildTime / 2)
    const paid = human.credits
    expect(game.cancelTraining(human.id, UnitTypeId.Scout)).toBe(true)
    expect(game.trainingFor(human.id).map((job) => job.typeId)).toEqual([UnitTypeId.MedTank])
    expect(human.credits).toBeCloseTo(paid)
  })

  it('pays one credit per population every ten seconds, unless an enemy is near', () => {
    const width = 16
    const height = 16
    const tiles = new Uint8Array(width * height).fill(Terrain.Land)
    const game = new Game(World.fromTiles(width, height, tiles))
    game.scenery = { coast: [], holes: [], roads: [], towns: [{ x: 6, y: 6 }], seed: 11 }
    game.bindCities()
    const human = game.addPlayer()
    game.claimCity({ x: 6, y: 6 }, human.id)
    const population = populationOf(layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), width, height)[0])
    expect(population).toBeGreaterThan(0)
    expect(game.creditIncome(human.id)).toBe(CREDIT_PER_POPULATION * population)
    human.credits = 0
    game.tick(INCOME_SECONDS - 1)
    expect(human.credits).toBe(0)
    expect(game.takeYields()).toEqual([])
    game.tick(1)
    expect(human.credits).toBe(CREDIT_PER_POPULATION * population)
    expect(game.takeYields()).toHaveLength(1)

    human.credits = 0
    const foe = game.addPlayer()
    const street = layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), width, height)[0].streets[0]
    game.spawn(foe, UnitTypeId.Scout, { x: street.x, y: street.y }, 0)
    expect(game.creditIncome(human.id)).toBe(0)
    game.tick(INCOME_SECONDS)
    expect(human.credits).toBe(0)
    expect(game.takeYields()).toEqual([])
  })

  it('refuses to train more units than the population', () => {
    const width = 24
    const height = 24
    const tiles = new Uint8Array(width * height).fill(Terrain.Land)
    const game = new Game(World.fromTiles(width, height, tiles))
    game.scenery = { coast: [], holes: [], roads: [], towns: [{ x: 6, y: 6 }], seed: 11 }
    game.bindCities()
    const human = game.addPlayer()
    game.claimCity({ x: 6, y: 6 }, human.id)
    const population = populationOf(layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), width, height)[0])
    expect(population).toBeGreaterThan(0)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 2, y: 2 })).toBe(true)
    game.finishBuild(human.id)
    for (let i = 0; i < population; i++) game.spawn(human, UnitTypeId.Scout, { x: 18, y: i }, 0)
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(false)
    const scout = game.units.find((unit) => unit.typeId === UnitTypeId.Scout)
    expect(scout).toBeDefined()
    if (!scout) return
    scout.health = 0
    game.tick(0)
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(true)
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(false)
  })

  it('charges more population for heavier units and turrets', () => {
    const width = 24
    const height = 24
    const tiles = new Uint8Array(width * height).fill(Terrain.Land)
    const game = new Game(World.fromTiles(width, height, tiles))
    game.scenery = { coast: [], holes: [], roads: [], towns: [{ x: 6, y: 6 }], seed: 11 }
    game.bindCities()
    const human = game.addPlayer()
    game.claimCity({ x: 6, y: 6 }, human.id)
    const population = populationOf(layoutCities(game.scenery.towns, game.scenery.seed, terrainOf(game), width, height)[0])
    expect(population).toBeGreaterThanOrEqual(MED_TANK.supply)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 2, y: 2 })).toBe(true)
    game.finishBuild(human.id)
    expect(game.trySpawn(human.id, UnitTypeId.MedTank)).toBe(true)
    expect(game.trySpawn(human.id, UnitTypeId.MedTank)).toBe(population >= MED_TANK.supply * 2)
    expect(game.trySpawn(human.id, UnitTypeId.Artillery)).toBe(false)
    expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: 14, y: 14 })).toBe(false)
    expect(SCOUT.supply).toBe(1)
    expect(MED_TANK.supply).toBe(2)
    expect(ARTILLERY.supply).toBe(3)
    expect(HEAVY_TANK.supply).toBe(4)
    expect(TURRET.supply).toBe(2)
  })

  it('rejects a footprint that overlaps an occupied tile', () => {
    const game = new Game(new World(12, 12))
    const human = game.addPlayer()
    seat(game, human.id, 10, 4)
    game.spawn(human, UnitTypeId.Scout, { x: 4, y: 4 })
    const credits = human.credits
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 4, y: 4 })).toBe(false)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 3, y: 3 })).toBe(false)
    expect(human.credits).toBe(credits)
  })

  it('refuses a building beside a city the player does not own', () => {
    const game = new Game(new World(24, 24))
    const human = game.addPlayer()
    const foe = game.addPlayer()
    game.scenery = {
      coast: [],
      holes: [],
      roads: [],
      towns: [
        { x: 4.5, y: 10.5 },
        { x: 18.5, y: 4.5 },
      ],
      seed: 11,
    }
    game.bindCities()
    game.claimCity({ x: 18.5, y: 4.5 }, foe.id)
    expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: 2, y: 2 })).toBe(false)
    game.claimCity({ x: 4.5, y: 10.5 }, human.id)
    expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: 2, y: 2 })).toBe(true)
  })

  it('adds a quarter of training speed for each finished factory', () => {
    const game = new Game(new World(24, 24))
    const human = game.addPlayer()
    seat(game, human.id, 10, 8)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 4, y: 6 })).toBe(true)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 12, y: 6 })).toBe(true)
    game.finishBuild(human.id)
    game.finishBuild(human.id)
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(true)
    game.tick(SCOUT.buildTime / 2)
    expect(game.trainingFor(human.id)[0]?.progress).toBeCloseTo(0.75)
  })

  it('sends finished units out of the primary factory toward the waypoint', () => {
    const game = new Game(new World(28, 28))
    const human = game.addPlayer()
    seat(game, human.id, 10, 8)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 4, y: 6 })).toBe(true)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 12, y: 6 })).toBe(true)
    game.finishBuild(human.id)
    game.finishBuild(human.id)
    const first = game.units[0]
    const second = game.units[1]
    expect(game.setPrimary(human.id, second.id)).toBe(true)
    expect(game.primaryFactory(human.id)).toBe(second.id)
    const rally = { x: 24, y: 8 }
    expect(game.setRally(human.id, rally)).toBe(true)
    expect(game.rally(human.id)).toEqual(rally)
    expect(game.trySpawn(human.id, UnitTypeId.Scout)).toBe(true)
    game.tick(SCOUT.buildTime / 1.5)
    const scout = game.units.find((unit) => unit.typeId === UnitTypeId.Scout)
    expect(scout).toBeDefined()
    if (!scout) return
    const from = (factory: { pos: { x: number; z: number } }) => Math.hypot(scout.pos.x - factory.pos.x, scout.pos.z - factory.pos.z)
    expect(from(second)).toBeLessThan(from(first))
    expect(scout.path.at(-1)).toEqual(rally)
    second.health = 0
    game.tick(0)
    expect(game.primaryFactory(human.id)).toBe(0)
  })

  it('holds a finished turret in place while it fires', () => {
    const game = new Game(new World(24, 24))
    const human = game.addPlayer()
    const enemy = game.addPlayer()
    seat(game, human.id, 10, 4)
    expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: 4, y: 4 })).toBe(true)
    const turret = game.units[0]
    const foe = game.spawn(enemy, UnitTypeId.Scout, { x: 4, y: 10 })
    const health = foe.health
    game.tick(2)
    expect(foe.health).toBe(health)
    game.finishBuild(human.id)
    game.tick(2)
    game.tick(1)
    expect(turret.tile).toEqual({ x: 4, y: 4 })
    expect(turret.pos).toEqual({ x: 4.5, z: 4.5 })
    expect(foe.health).toBeLessThan(health)
    expect(game.orderMove(human.id, turret.id, { x: 8, y: 8 })).toBe(false)
    expect(turret.path).toEqual([])
  })
})

function quiet(game: Game, x: number, y: number) {
  game.claimCity({ x: x + 0.5, y: y + 0.5 }, 0)
}

function terrainOf(game: Game): number[] {
  const terrain: number[] = []
  for (let y = 0; y < game.world.height; y++) {
    for (let x = 0; x < game.world.width; x++) terrain.push(game.world.terrainAt(x, y))
  }
  return terrain
}
