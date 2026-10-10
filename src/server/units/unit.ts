import { tileCenter, type TileCoord } from '../../shared/tiles.ts'
import type { PathFinder } from '../path/pathfinder.ts'
import type { UnitType } from '../../shared/unit-types.ts'

export class Unit {
  id: number
  ownerId: number
  typeId: UnitType['id']
  pos: { x: number; z: number }
  tile: TileCoord
  facing: number
  health: number
  path: TileCoord[] = []

  constructor(id: number, ownerId: number, type: UnitType, tile: TileCoord, facing: number) {
    this.id = id
    this.ownerId = ownerId
    this.typeId = type.id
    this.pos = tileCenter(tile)
    this.tile = { x: tile.x, y: tile.y }
    this.facing = facing
    this.health = type.maxHealth
  }

  orderMove(tile: TileCoord, paths: PathFinder): boolean {
    const path = paths.findPath(this.tile, tile, this.id)
    if (path === null) return false
    this.path = path
    return true
  }
}
