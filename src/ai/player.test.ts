import { describe, expect, it } from 'vitest'
import { AiPlayer } from './player.ts'
import { Scenario } from './scenarios.ts'
import { Game } from '../server/game.ts'
import { ServerHost } from '../server/host.ts'
import { FACTORY, SCOUT, UnitTypeId } from '../shared/unit-types.ts'
import { CREDIT_PER_POPULATION } from '../server/player.ts'
import type { TileCoord } from '../shared/tiles.ts'
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

function padPop(game: Game, playerId: number, people: number) {
  let added = 0
  while (game.creditIncome(playerId) / CREDIT_PER_POPULATION < people && added < 8) {
    added += 1
    game.scenery.towns.push({ x: game.world.width - 1.5, y: 0.5 + (added - 1) * 5 })
    game.bindCities()
    for (const town of game.scenery.towns) game.claimCity(town, playerId)
  }
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
    padPop(game, ai.id, FACTORY.supply)
    const bot = boot(game, ai.id)

    bot.update(2)

    const workshop = game.units.find((unit) => unit.ownerId === ai.id && unit.typeId === UnitTypeId.Factory)
    expect(workshop).toBeDefined()
    expect(workshop?.progress).toBe(0)
  })

  it('garrisons or explores when population blocks the factory', () => {
    const game = new Game(new World(24, 24))
    const ai = game.addPlayer()
    game.scenery = { coast: [], holes: [], roads: [], towns: [{ x: 10.5, y: 8.5 }], seed: 4 }
    game.bindCities()
    game.claimCity({ x: 10.5, y: 8.5 }, ai.id)
    const people = game.creditIncome(ai.id) / CREDIT_PER_POPULATION
    const tiles = openNear(game, { x: 10, y: 8 })
    let spawned = 0
    while ((spawned * SCOUT.supply + FACTORY.supply <= people || spawned === 0) && spawned < tiles.length) {
      game.spawn(ai, UnitTypeId.Scout, tiles[spawned])
      spawned += 1
    }
    expect(spawned * SCOUT.supply + FACTORY.supply).toBeGreaterThan(people)
    const bot = boot(game, ai.id)

    bot.update(2)

    expect(game.units.some((unit) => unit.ownerId === ai.id && unit.typeId === UnitTypeId.Factory)).toBe(false)
    const thought = bot.lastThought
    expect(thought?.candidates.some((candidate) => candidate.scenario === Scenario.Build && candidate.blocked === 'pop')).toBe(true)
    expect(thought?.candidates.some((candidate) => candidate.blocked === '' && (candidate.scenario === Scenario.Garrison || candidate.scenario === Scenario.Scout))).toBe(true)
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

function openNear(game: Game, origin: TileCoord): TileCoord[] {
  const tiles: TileCoord[] = []
  for (let radius = 0; radius <= 8; radius++) {
    for (let y = origin.y - radius; y <= origin.y + radius; y++) {
      for (let x = origin.x - radius; x <= origin.x + radius; x++) {
        if (Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y)) !== radius) continue
        if (!game.world.inBounds(x, y) || !game.pathfinder.isWalkable(x, y, -1)) continue
        tiles.push({ x, y })
      }
    }
  }
  return tiles
}
