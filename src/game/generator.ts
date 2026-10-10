import { createSkirmishMap } from '../map/generator.ts'
import { UnitTypeId } from '../units/types.ts'
import { Commander } from './commander.ts'
import { World } from './world.ts'

export function createSkirmish(): { world: World; player: Commander } {
  const world = new World(createSkirmishMap())
  const player = new Commander(world)
  const lead = world.spawn(UnitTypeId.Tank, { x: 3, y: 12 }, Math.PI / 2)
  world.spawn(UnitTypeId.Tank, { x: 11, y: 8 }, -Math.PI / 2)
  world.spawn(UnitTypeId.Scout, { x: 2, y: 6 }, Math.PI / 2)
  world.spawn(UnitTypeId.Scout, { x: 16, y: 2 }, 0)
  world.spawn(UnitTypeId.Heavy, { x: 4, y: 20 }, Math.PI / 2)
  world.spawn(UnitTypeId.Heavy, { x: 21, y: 6 }, -Math.PI / 2)
  world.spawn(UnitTypeId.Tank, { x: 19, y: 20 }, Math.PI)
  player.select(lead.id)
  return { world, player }
}
