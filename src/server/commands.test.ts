import { describe, expect, it } from 'vitest'
import { ClientMessageKind } from '../shared/protocol.ts'
import { UnitTypeId } from '../shared/unit-types.ts'
import { AiPlayer } from './ai.ts'
import { Game } from './game.ts'
import { ServerHost } from './host.ts'
import { createSkirmish } from './skirmish.ts'
import { World } from './world.ts'

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

  it('lets the AI order only its own units', () => {
    const game = new Game(new World(8, 8))
    const human = game.addPlayer()
    const ai = game.addPlayer()
    const humanUnit = game.spawn(human, UnitTypeId.Tank, { x: 1, y: 1 })
    const aiUnit = game.spawn(ai, UnitTypeId.Tank, { x: 6, y: 6 })
    const aiPlayer = new AiPlayer(ai.id, game)

    let ordered = false
    for (let i = 0; i < 30; i++) {
      aiPlayer.update(2)
      expect(humanUnit.path).toEqual([])
      if (aiUnit.path.length > 0) ordered = true
    }
    expect(ordered).toBe(true)
  })
})
