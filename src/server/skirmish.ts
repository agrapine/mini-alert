import { UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import type { Player } from './player.ts'
import { createSkirmishWorld } from './world-generator.ts'

export function createSkirmish(): { game: Game; human: Player; ai: Player } {
  const game = new Game(createSkirmishWorld())
  const human = game.addPlayer()
  const ai = game.addPlayer()
  game.spawn(human, UnitTypeId.MedTank, { x: 3, y: 12 }, Math.PI / 2)
  game.spawn(human, UnitTypeId.Scout, { x: 2, y: 6 }, Math.PI / 2)
  game.spawn(human, UnitTypeId.HeavyTank, { x: 4, y: 20 }, Math.PI / 2)
  game.spawn(ai, UnitTypeId.MedTank, { x: 11, y: 8 }, -Math.PI / 2)
  game.spawn(ai, UnitTypeId.Scout, { x: 16, y: 2 }, 0)
  game.spawn(ai, UnitTypeId.HeavyTank, { x: 21, y: 6 }, -Math.PI / 2)
  game.spawn(ai, UnitTypeId.MedTank, { x: 19, y: 20 }, Math.PI)
  return { game, human, ai }
}
