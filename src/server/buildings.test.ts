import { describe, expect, it } from 'vitest'
import { UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { World } from './world.ts'

describe('buildings', () => {
  it('rejects a building the player cannot afford', () => {
    const game = new Game(new World(12, 12))
    const human = game.addPlayer()
    human.credits = 100
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 2, y: 2 })).toBe(false)
    expect(human.credits).toBe(100)
    expect(game.units).toHaveLength(0)
  })

  it('builds one structure at a time and frees the slot when it finishes', () => {
    const game = new Game(new World(16, 16))
    const human = game.addPlayer()
    expect(game.placeBuilding(human.id, UnitTypeId.Turret, { x: 2, y: 2 })).toBe(true)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 6, y: 6 })).toBe(false)
    expect(human.credits).toBe(10_000 - 800)
    const turret = game.units[0]
    game.tick(2.5)
    expect(turret.progress).toBeCloseTo(0.5)
    expect(turret.tile).toEqual({ x: 2, y: 2 })
    game.tick(2.5)
    expect(turret.progress).toBe(1)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 6, y: 6 })).toBe(true)
    expect(game.pathfinder.occupant(6, 6)).toBe(game.units[1].id)
    expect(game.pathfinder.occupant(7, 7)).toBe(game.units[1].id)
  })

  it('rejects a footprint that overlaps an occupied tile', () => {
    const game = new Game(new World(12, 12))
    const human = game.addPlayer()
    game.spawn(human, UnitTypeId.Scout, { x: 4, y: 4 })
    const credits = human.credits
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 4, y: 4 })).toBe(false)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 3, y: 3 })).toBe(false)
    expect(human.credits).toBe(credits)
  })

  it('holds a finished turret in place while it fires', () => {
    const game = new Game(new World(24, 24))
    const human = game.addPlayer()
    const enemy = game.addPlayer()
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
