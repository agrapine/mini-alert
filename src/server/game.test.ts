import { describe, expect, it } from 'vitest'
import { HEAVY_TANK, MED_TANK, SCOUT, UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { createSkirmish } from './skirmish.ts'
import { World } from './world.ts'

const STEP = 1 / 30

function battle(width: number, height: number) {
  const game = new Game(new World(width, height))
  const player = game.addPlayer()
  return { game, player }
}

function ticks(game: Game, seconds: number) {
  for (let i = 0; i < 30 * seconds; i++) game.tick(STEP)
}

describe('skirmish orders', () => {
  it('routes through the open gate and around the parked tank', () => {
    const { game, human, ai } = createSkirmish()
    const tank = game.units.find((unit) => unit.ownerId === human.id && unit.tile.x === 3)
    expect(tank).toBeDefined()
    if (!tank) return

    expect(game.orderMove(human.id, tank.id, { x: 18, y: 12 })).toBe(true)
    expect(tank.path.length).toBeGreaterThan(0)
    expect(tank.path.some((tile) => tile.x === 11 && tile.y === 16)).toBe(true)
    expect(tank.path.some((tile) => tile.x === 11 && tile.y !== 16)).toBe(false)

    const parked = game.units.find((unit) => unit.tile.x === 11 && unit.tile.y === 8)
    expect(parked).toBeDefined()
    expect(game.orderMove(human.id, tank.id, { x: 11, y: 8 })).toBe(false)
    expect(tank.path.at(-1)).toEqual({ x: 18, y: 12 })

    ticks(game, 40)
    expect(tank.tile).toEqual({ x: 18, y: 12 })
    expect(parked?.tile).toEqual({ x: 11, y: 8 })
    expect(game.pathfinder.occupant(18, 12)).toBe(tank.id)
    expect(game.pathfinder.occupant(11, 8)).toBe(parked?.id)

    if (!parked) return
    expect(game.orderMove(ai.id, parked.id, { x: 18, y: 12 })).toBe(false)
    expect(parked.path).toEqual([])
  })

  it('places scouts, med tanks, and heavy tanks', () => {
    const { game, human, ai } = createSkirmish()
    expect(game.units.map((unit) => unit.typeId).sort()).toEqual([
      UnitTypeId.Scout,
      UnitTypeId.Scout,
      UnitTypeId.MedTank,
      UnitTypeId.MedTank,
      UnitTypeId.MedTank,
      UnitTypeId.HeavyTank,
      UnitTypeId.HeavyTank,
    ])
    expect(SCOUT.topSpeed).toBeGreaterThan(MED_TANK.topSpeed)
    expect(MED_TANK.topSpeed).toBeGreaterThan(HEAVY_TANK.topSpeed)
    expect(MED_TANK.turnRate).toBeGreaterThan(HEAVY_TANK.turnRate)
    expect(SCOUT.hull.x).toBeLessThan(MED_TANK.hull.x)
    expect(MED_TANK.hull.x).toBeLessThan(HEAVY_TANK.hull.x)
    expect(SCOUT.label).toBe('Scout')
    expect(MED_TANK.label).toBe('Med Tank')
    expect(HEAVY_TANK.label).toBe('Heavy Tank')
    const snapshots = game.unitSnapshots()
    const colorsOf = (ownerId: number) =>
      snapshots.filter((unit) => unit.ownerId === ownerId).map((unit) => unit.color)
    expect(new Set(colorsOf(human.id)).size).toBe(1)
    expect(new Set(colorsOf(ai.id)).size).toBe(1)
    expect(colorsOf(human.id)[0]).not.toBe(colorsOf(ai.id)[0])
  })
})

describe('movement', () => {
  it('lets a faster scout pull ahead of a heavy tank', () => {
    const { game, player } = battle(24, 8)
    const scout = game.spawn(player, UnitTypeId.Scout, { x: 1, y: 2 }, Math.PI / 2)
    const heavy = game.spawn(player, UnitTypeId.HeavyTank, { x: 1, y: 5 }, Math.PI / 2)
    expect(game.orderMove(player.id, scout.id, { x: 18, y: 2 })).toBe(true)
    expect(game.orderMove(player.id, heavy.id, { x: 18, y: 5 })).toBe(true)

    ticks(game, 4)
    expect(scout.pos.x).toBeGreaterThan(heavy.pos.x + 1)
  })

  it('steps aside when two tanks meet head-on', () => {
    const { game, player } = battle(16, 7)
    const eastbound = game.spawn(player, UnitTypeId.MedTank, { x: 2, y: 3 }, Math.PI / 2)
    const westbound = game.spawn(player, UnitTypeId.MedTank, { x: 10, y: 3 }, -Math.PI / 2)
    expect(game.orderMove(player.id, eastbound.id, { x: 12, y: 3 })).toBe(true)
    expect(game.orderMove(player.id, westbound.id, { x: 1, y: 3 })).toBe(true)

    for (let i = 0; i < 30 * 40; i++) {
      game.tick(STEP)
      const tiles = game.units.map((unit) => `${unit.tile.x},${unit.tile.y}`)
      expect(new Set(tiles).size).toBe(tiles.length)
    }
    expect(eastbound.tile).toEqual({ x: 12, y: 3 })
    expect(westbound.tile).toEqual({ x: 1, y: 3 })
  })

  it('follows a slower tank without cancelling the order', () => {
    const { game, player } = battle(16, 5)
    const lead = game.spawn(player, UnitTypeId.HeavyTank, { x: 2, y: 2 }, Math.PI / 2)
    const trail = game.spawn(player, UnitTypeId.Scout, { x: 1, y: 2 }, Math.PI / 2)
    expect(game.orderMove(player.id, lead.id, { x: 12, y: 2 })).toBe(true)
    expect(game.orderMove(player.id, trail.id, { x: 11, y: 2 })).toBe(true)

    ticks(game, 40)
    expect(lead.tile).toEqual({ x: 12, y: 2 })
    expect(trail.tile).toEqual({ x: 11, y: 2 })
  })

  it('pivots a stopped med tank', () => {
    const { game, player } = battle(8, 5)
    const tank = game.spawn(player, UnitTypeId.MedTank, { x: 1, y: 2 })
    expect(tank.speed).toBe(0)
    expect(game.orderMove(player.id, tank.id, { x: 4, y: 2 })).toBe(true)
    const facing = tank.facing
    tank.drive(STEP)
    expect(Math.abs(tank.facing - facing)).toBeGreaterThan(0.02)
  })

  it('does not yaw a scout until it is moving', () => {
    const { game, player } = battle(10, 5)
    const scout = game.spawn(player, UnitTypeId.Scout, { x: 1, y: 2 })
    expect(scout.speed).toBe(0)
    expect(game.orderMove(player.id, scout.id, { x: 6, y: 2 })).toBe(true)
    const facing = scout.facing
    scout.drive(STEP)
    expect(scout.facing).toBeCloseTo(facing)
    expect(Math.abs(scout.speed)).toBeGreaterThan(0)
    scout.drive(STEP)
    expect(Math.abs(scout.facing - facing)).toBeGreaterThan(0.01)
  })
})
