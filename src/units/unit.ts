import { tileCenter, type TileCoord } from '../map/grid.ts'
import type { UnitType, UnitTypeId } from './types.ts'

export type Unit = {
  id: number
  typeId: UnitTypeId
  pos: { x: number; z: number }
  tile: TileCoord
  facing: number
  health: number
  path: TileCoord[]
  selected: boolean
}

export function createUnit(id: number, type: UnitType, tile: TileCoord, facing: number): Unit {
  return {
    id,
    typeId: type.id,
    pos: tileCenter(tile),
    tile: { x: tile.x, y: tile.y },
    facing,
    health: type.maxHealth,
    path: [],
    selected: false,
  }
}
