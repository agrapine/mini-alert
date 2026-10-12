import type { TileCoord } from '../shared/tiles.ts'
import { UNIT_TYPES, type UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { registerKind } from './persist.ts'
import { Player } from './player.ts'
import { createUnit } from './units/create.ts'
import { Unit } from './units/unit.ts'
import { World } from './world.ts'

registerKind({
  tag: 'world',
  test: (value) => value instanceof World,
  revive(fields) {
    const terrain = fields.terrain
    const shifts = fields.shifts
    if (!(terrain instanceof Uint8Array) || !(shifts instanceof Uint8Array)) throw new Error('saved world')
    return World.fromTiles(fields.width as number, fields.height as number, terrain, shifts)
  },
})

registerKind({
  tag: 'player',
  test: (value) => value instanceof Player,
  revive(fields) {
    const player = new Player(fields.id as number, fields.color as number | undefined)
    const target = player as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(fields)) target[key] = value
    return player
  },
})

registerKind({
  tag: 'unit',
  test: (value) => value instanceof Unit,
  skip: ['type'],
  revive(fields) {
    const type = UNIT_TYPES[fields.typeId as UnitTypeId]
    if (!type) throw new Error(`unknown unit type ${String(fields.typeId)}`)
    const unit = createUnit(
      fields.id as number,
      fields.ownerId as number,
      type,
      fields.tile as TileCoord,
      typeof fields.facing === 'number' ? fields.facing : 0,
    )
    const target = unit as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'type') continue
      target[key] = value
    }
    return unit
  },
})

registerKind({
  tag: 'game',
  test: (value) => value instanceof Game,
  skip: ['pathfinder'],
  revive: (fields) => Game.fromState(fields),
})
