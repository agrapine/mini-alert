import {
  ServerMessageKind,
  type ServerMessage,
  type UnitSnapshot,
  type WorldSnapshot,
} from '../shared/protocol.ts'
import { Terrain, type TileCoord } from '../shared/tiles.ts'

export class Replica {
  playerId: number | null = null
  world: WorldSnapshot | null = null
  units: UnitSnapshot[] = []

  apply(message: ServerMessage) {
    if (message.kind === ServerMessageKind.Welcome) this.playerId = message.playerId
    else if (message.kind === ServerMessageKind.World) this.world = message
    else this.units = message.units
  }

  unit(id: number): UnitSnapshot | undefined {
    return this.units.find((unit) => unit.id === id)
  }

  isOpen(tile: TileCoord, ignoreUnitId: number): boolean {
    const world = this.world
    if (!world) return false
    if (tile.x < 0 || tile.y < 0 || tile.x >= world.width || tile.y >= world.height) return false
    if (world.terrain[tile.y * world.width + tile.x] !== Terrain.Clear) return false
    return !this.units.some(
      (unit) => unit.tileX === tile.x && unit.tileY === tile.y && unit.id !== ignoreUnitId,
    )
  }
}
