import { describe, expect, it } from 'vitest'
import { HEAVY, SCOUT, TANK, UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { createSkirmish } from './skirmish.ts'
import { World } from './world.ts'

const STEP = 1 / 30

function battle(width: number, height: number) {
  const game = new Game(new World(width, height))
  const player = game.addPlayer()
  return { game, player }
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

    for (let i = 0; i < 30 * 20; i++) game.tick(STEP)
    expect(tank.tile).toEqual({ x: 18, y: 12 })
    expect(parked?.tile).toEqual({ x: 11, y: 8 })
    expect(game.pathfinder.occupant(18, 12)).toBe(tank.id)
    expect(game.pathfinder.occupant(11, 8)).toBe(parked?.id)

    if (!parked) return
    expect(game.orderMove(ai.id, parked.id, { x: 18, y: 12 })).toBe(false)
    expect(parked.path).toEqual([])
  })

  it('places scouts, tanks, and heavies', () => {
    const { game, human, ai } = createSkirmish()
    expect(game.units.map((unit) => unit.typeId).sort()).toEqual([
      UnitTypeId.Scout,
      UnitTypeId.Scout,
      UnitTypeId.Tank,
      UnitTypeId.Tank,
      UnitTypeId.Tank,
      UnitTypeId.Heavy,
      UnitTypeId.Heavy,
    ])
    expect(SCOUT.speed).toBeGreaterThan(TANK.speed)
    expect(TANK.speed).toBeGreaterThan(HEAVY.speed)
    expect(SCOUT.hull.x).toBeLessThan(TANK.hull.x)
    expect(TANK.hull.x).toBeLessThan(HEAVY.hull.x)
    expect(SCOUT.label).toBe('Scout')
    expect(TANK.label).toBe('Tank')
    expect(HEAVY.label).toBe('Heavy')
    const snapshots = game.unitSnapshots()
    const colorsOf = (ownerId: number) =>
      snapshots.filter((unit) => unit.ownerId === ownerId).map((unit) => unit.color)
    expect(new Set(colorsOf(human.id)).size).toBe(1)
    expect(new Set(colorsOf(ai.id)).size).toBe(1)
    expect(colorsOf(human.id)[0]).not.toBe(colorsOf(ai.id)[0])
  })
})

describe('movement', () => {
  it('lets a faster scout pull ahead of a heavy', () => {
    const { game, player } = battle(20, 5)
    const scout = game.spawn(player, UnitTypeId.Scout, { x: 1, y: 1 })
    const heavy = game.spawn(player, UnitTypeId.Heavy, { x: 1, y: 3 })
    expect(game.orderMove(player.id, scout.id, { x: 16, y: 1 })).toBe(true)
    expect(game.orderMove(player.id, heavy.id, { x: 16, y: 3 })).toBe(true)

    for (let i = 0; i < 45; i++) game.tick(STEP)
    expect(scout.pos.x).toBeGreaterThan(heavy.pos.x + 1)
  })

  it('steps aside when two units meet head-on', () => {
    const { game, player } = battle(12, 5)
    const eastbound = game.spawn(player, UnitTypeId.Tank, { x: 2, y: 2 })
    const westbound = game.spawn(player, UnitTypeId.Tank, { x: 8, y: 2 })
    expect(game.orderMove(player.id, eastbound.id, { x: 9, y: 2 })).toBe(true)
    expect(game.orderMove(player.id, westbound.id, { x: 1, y: 2 })).toBe(true)

    for (let i = 0; i < 30 * 15; i++) {
      game.tick(STEP)
      const tiles = game.units.map((unit) => `${unit.tile.x},${unit.tile.y}`)
      expect(new Set(tiles).size).toBe(tiles.length)
    }

    expect(eastbound.tile).toEqual({ x: 9, y: 2 })
    expect(westbound.tile).toEqual({ x: 1, y: 2 })
  })

  it('follows a slower unit without cancelling the order', () => {
    const { game, player } = battle(14, 3)
    const lead = game.spawn(player, UnitTypeId.Heavy, { x: 2, y: 1 })
    const trail = game.spawn(player, UnitTypeId.Scout, { x: 1, y: 1 })
    expect(game.orderMove(player.id, lead.id, { x: 10, y: 1 })).toBe(true)
    expect(game.orderMove(player.id, trail.id, { x: 9, y: 1 })).toBe(true)

    for (let i = 0; i < 30 * 20; i++) game.tick(STEP)
    expect(lead.tile).toEqual({ x: 10, y: 1 })
    expect(trail.tile).toEqual({ x: 9, y: 1 })
  })
})
