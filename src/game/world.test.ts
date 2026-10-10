import { describe, expect, it } from 'vitest'
import { Map } from '../map/map.ts'
import { HEAVY, SCOUT, TANK } from '../units/catalog.ts'
import { UnitTypeId } from '../units/types.ts'
import { Commander } from './commander.ts'
import { createSkirmish } from './generator.ts'
import { World } from './world.ts'

const STEP = 1 / 30

function battle(width: number, height: number) {
  const world = new World(new Map(width, height))
  const player = new Commander(world)
  return { world, player }
}

describe('skirmish orders', () => {
  it('routes through the open gate and around the parked tank', () => {
    const { world, player } = createSkirmish()
    const tank = player.selected()
    expect(tank).not.toBeNull()
    if (!tank) return

    player.orderMove({ x: 18, y: 12 })
    expect(tank.path.length).toBeGreaterThan(0)
    expect(tank.path.some((tile) => tile.x === 11 && tile.y === 16)).toBe(true)
    expect(tank.path.some((tile) => tile.x === 11 && tile.y !== 16)).toBe(false)

    const parked = world.units.find((unit) => unit.tile.x === 11 && unit.tile.y === 8)
    expect(parked).toBeDefined()
    player.orderMove({ x: 11, y: 8 })
    expect(tank.path.at(-1)).toEqual({ x: 18, y: 12 })

    for (let i = 0; i < 30 * 20; i++) world.tick(STEP)
    expect(tank.tile).toEqual({ x: 18, y: 12 })
    expect(parked?.tile).toEqual({ x: 11, y: 8 })
    expect(world.pathfinder.occupant(18, 12)).toBe(tank.id)
    expect(world.pathfinder.occupant(11, 8)).toBe(parked?.id)

    if (!parked) return
    player.select(parked.id)
    player.orderMove({ x: 18, y: 12 })
    expect(parked.path).toEqual([])
  })

  it('places scouts, tanks, and heavies', () => {
    const { world } = createSkirmish()
    expect(world.units.map((unit) => unit.typeId).sort()).toEqual([
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
    expect(new Set([SCOUT.color, TANK.color, HEAVY.color]).size).toBe(3)
  })
})

describe('movement', () => {
  it('lets a faster scout pull ahead of a heavy', () => {
    const { world, player } = battle(20, 5)
    const scout = world.spawn(UnitTypeId.Scout, { x: 1, y: 1 })
    const heavy = world.spawn(UnitTypeId.Heavy, { x: 1, y: 3 })
    player.select(scout.id)
    player.orderMove({ x: 16, y: 1 })
    player.select(heavy.id)
    player.orderMove({ x: 16, y: 3 })

    for (let i = 0; i < 45; i++) world.tick(STEP)
    expect(scout.pos.x).toBeGreaterThan(heavy.pos.x + 1)
  })

  it('steps aside when two units meet head-on', () => {
    const { world, player } = battle(12, 5)
    const eastbound = world.spawn(UnitTypeId.Tank, { x: 2, y: 2 })
    const westbound = world.spawn(UnitTypeId.Tank, { x: 8, y: 2 })
    player.select(eastbound.id)
    player.orderMove({ x: 9, y: 2 })
    player.select(westbound.id)
    player.orderMove({ x: 1, y: 2 })

    for (let i = 0; i < 30 * 15; i++) {
      world.tick(STEP)
      const tiles = world.units.map((unit) => `${unit.tile.x},${unit.tile.y}`)
      expect(new Set(tiles).size).toBe(tiles.length)
    }

    expect(eastbound.tile).toEqual({ x: 9, y: 2 })
    expect(westbound.tile).toEqual({ x: 1, y: 2 })
  })

  it('follows a slower unit without cancelling the order', () => {
    const { world, player } = battle(14, 3)
    const lead = world.spawn(UnitTypeId.Heavy, { x: 2, y: 1 })
    const trail = world.spawn(UnitTypeId.Scout, { x: 1, y: 1 })
    player.select(lead.id)
    player.orderMove({ x: 10, y: 1 })
    player.select(trail.id)
    player.orderMove({ x: 9, y: 1 })

    for (let i = 0; i < 30 * 20; i++) world.tick(STEP)
    expect(lead.tile).toEqual({ x: 10, y: 1 })
    expect(trail.tile).toEqual({ x: 9, y: 1 })
  })
})
