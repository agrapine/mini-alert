import { describe, expect, it } from 'vitest'
import { ClientMessageKind } from '../shared/protocol.ts'
import { MED_TANK, SCOUT, UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { ServerHost } from './host.ts'
import { createSkirmish } from './skirmish.ts'
import { World } from './world.ts'

function seat(game: Game, playerId: number, x: number, y: number) {
  game.scenery = { coast: [], holes: [], roads: [], towns: [{ x: x + 0.5, y: y + 0.5 }], seed: 11 }
  game.bindCities()
  game.claimCity({ x: x + 0.5, y: y + 0.5 }, playerId)
}

describe('player commands', () => {
  it('accepts an order only from the connection that owns the unit', () => {
    const { game, human, ai } = createSkirmish()
    const host = new ServerHost(game)
    const humanPort = host.join(human)
    const aiPort = host.join(ai)

    const tank = game.units.find((unit) => unit.ownerId === human.id && unit.tile.x === 3)
    const enemy = game.units.find((unit) => unit.ownerId === ai.id && unit.tile.x === 11)
    expect(tank).toBeDefined()
    expect(enemy).toBeDefined()
    if (!tank || !enemy) return

    humanPort.send({ kind: ClientMessageKind.OrderMove, unitId: tank.id, tile: { x: 6, y: 12 } })
    expect(tank.path.length).toBeGreaterThan(0)
    expect(tank.path.at(-1)).toEqual({ x: 6, y: 12 })

    humanPort.send({ kind: ClientMessageKind.OrderMove, unitId: enemy.id, tile: { x: 14, y: 8 } })
    expect(enemy.path).toEqual([])

    aiPort.send({ kind: ClientMessageKind.OrderMove, unitId: tank.id, tile: { x: 4, y: 12 } })
    expect(tank.path.at(-1)).toEqual({ x: 6, y: 12 })

    aiPort.send({ kind: ClientMessageKind.OrderMove, unitId: enemy.id, tile: { x: 14, y: 8 } })
    expect(enemy.path.length).toBeGreaterThan(0)
    expect(enemy.path.at(-1)).toEqual({ x: 14, y: 8 })
  })

  it('spawns for the connected player beside a finished factory', () => {
    const game = new Game(new World(16, 16))
    const human = game.addPlayer()
    const host = new ServerHost(game)
    const humanPort = host.join(human)
    seat(game, human.id, 10, 4)
    expect(game.placeBuilding(human.id, UnitTypeId.Factory, { x: 4, y: 4 })).toBe(true)
    game.finishBuild(human.id)
    const before = game.units.length

    humanPort.send({ kind: ClientMessageKind.Spawn, typeId: UnitTypeId.Scout })
    game.tick(SCOUT.buildTime)
    const spawned = game.units[game.units.length - 1]
    expect(spawned?.ownerId).toBe(human.id)
    expect(spawned?.typeId).toBe(UnitTypeId.Scout)
    expect(spawned.tile.x < 4 || spawned.tile.x > 5 || spawned.tile.y < 4 || spawned.tile.y > 5).toBe(true)
    expect(spawned.path.length).toBeGreaterThan(0)

    humanPort.send({ kind: ClientMessageKind.Spawn, typeId: UnitTypeId.MedTank })
    game.tick(MED_TANK.buildTime)
    const second = game.units[game.units.length - 1]
    expect(second?.ownerId).toBe(human.id)
    expect(second.tile).not.toEqual(spawned.tile)
    expect(game.units.length).toBe(before + 2)
  })
})
