import { describe, expect, it } from 'vitest'
import { AiPlayer } from './player.ts'
import { Game } from '../server/game.ts'
import { ServerHost } from '../server/host.ts'
import { UnitTypeId } from '../shared/unit-types.ts'
import { World } from '../server/world.ts'

function boot(game: Game, aiId: number) {
  const host = new ServerHost(game)
  const player = game.player(aiId)
  if (!player) throw new Error('missing player')
  const port = host.join(player)
  const bot = new AiPlayer(port)
  host.addAi(bot)
  host.sync(aiId)
  return bot
}

describe('ai', () => {
  it('fights the contact in front of it and leaves the other flank alone', () => {
    const game = new Game(new World(48, 48))
    const human = game.addPlayer()
    const ai = game.addPlayer()
    const foe = game.spawn(human, UnitTypeId.MedTank, { x: 12, y: 4 })
    const near = game.spawn(ai, UnitTypeId.MedTank, { x: 4, y: 4 })
    const far = game.spawn(ai, UnitTypeId.MedTank, { x: 40, y: 40 })
    const bot = boot(game, ai.id)

    bot.update(0.4)
    expect(near.attackId).toBeNull()
    bot.setPace(1)
    bot.update(2)

    expect(near.attackId).toBe(foe.id)
    expect(far.attackId).toBeNull()
    expect(far.path).toEqual([])
  })

  it('places a factory through the build command when it has a city and no workshop', () => {
    const game = new Game(new World(24, 24))
    const ai = game.addPlayer()
    game.scenery = { coast: [], holes: [], roads: [], towns: [{ x: 10.5, y: 8.5 }], seed: 4 }
    game.bindCities()
    game.claimCity({ x: 10.5, y: 8.5 }, ai.id)
    const bot = boot(game, ai.id)

    bot.update(2)

    const workshop = game.units.find((unit) => unit.ownerId === ai.id && unit.typeId === UnitTypeId.Factory)
    expect(workshop).toBeDefined()
    expect(workshop?.progress).toBe(0)
  })

  it('waits longer between actions when the pace is turned down', () => {
    const game = new Game(new World(48, 48))
    const human = game.addPlayer()
    const ai = game.addPlayer()
    const foe = game.spawn(human, UnitTypeId.MedTank, { x: 12, y: 4 })
    const near = game.spawn(ai, UnitTypeId.MedTank, { x: 4, y: 4 })
    const bot = boot(game, ai.id)
    bot.setPace(0.25)

    bot.update(2)
    expect(near.attackId).toBeNull()
    bot.update(5)
    expect(near.attackId).toBe(foe.id)
  })
})
