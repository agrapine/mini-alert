import { describe, expect, it } from 'vitest'
import { ClientMessageKind } from '../shared/protocol.ts'
import { HEAVY_TANK, MED_TANK, SCOUT, UnitTypeId } from '../shared/unit-types.ts'
import { AI_MAX_UNITS, AiPlayer } from './ai.ts'
import { Game } from './game.ts'
import { ServerHost } from './host.ts'
import { createSkirmish } from './skirmish.ts'
import { World } from './world.ts'

function seat(game: Game, x: number, y: number) {
  game.scenery = { coast: [], holes: [], roads: [], towns: [{ x: x + 0.5, y: y + 0.5 }], seed: 4 }
  game.bindCities()
}

describe('player commands', () => {
  it('accepts an order only from the connection that owns the unit', () => {
    const { game, human, ai } = createSkirmish()
    const host = new ServerHost(game, new AiPlayer(ai.id, game))
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
    const ai = game.addPlayer()
    const host = new ServerHost(game, new AiPlayer(ai.id, game))
    const humanPort = host.join(human)
    seat(game, 10, 4)
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

  it('lets the AI order only its own units', () => {
    const game = new Game(new World(8, 8))
    const human = game.addPlayer()
    const ai = game.addPlayer()
    const humanUnit = game.spawn(human, UnitTypeId.MedTank, { x: 1, y: 1 })
    const aiUnit = game.spawn(ai, UnitTypeId.MedTank, { x: 6, y: 6 })
    const aiPlayer = new AiPlayer(ai.id, game)

    let ordered = false
    for (let i = 0; i < 30; i++) {
      aiPlayer.update(2)
      expect(humanUnit.path).toEqual([])
      if (aiUnit.path.length > 0) ordered = true
    }
    expect(ordered).toBe(true)
  })

  it('spawns an AI unit every five seconds until the cap', () => {
    const game = new Game(new World(16, 16))
    const ai = game.addPlayer()
    game.setSpawnAnchor(ai.id, { x: 4, y: 4 })
    seat(game, 10, 4)
    expect(game.placeBuilding(ai.id, UnitTypeId.Factory, { x: 4, y: 4 })).toBe(true)
    game.finishBuild(ai.id)
    ai.credits = 100_000
    const aiPlayer = new AiPlayer(ai.id, game)

    for (let i = 0; i < AI_MAX_UNITS; i++) {
      aiPlayer.update(5)
      game.tick(HEAVY_TANK.buildTime)
    }
    const owned = () => game.units.filter((unit) => unit.ownerId === ai.id && unit.type.topSpeed > 0)
    expect(owned()).toHaveLength(AI_MAX_UNITS)

    aiPlayer.update(5)
    expect(owned()).toHaveLength(AI_MAX_UNITS)
  })
})
