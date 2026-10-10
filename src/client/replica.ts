import {
  ServerMessageKind,
  type ServerMessage,
  type ShotEvent,
  type UnitSnapshot,
  type WorldSnapshot,
} from '../shared/protocol.ts'
import { isWalkableTerrain, type TileCoord } from '../shared/tiles.ts'

export class Replica {
  playerId: number | null = null
  world: WorldSnapshot | null = null
  units: UnitSnapshot[] = []
  private pendingShots: ShotEvent[] = []

  apply(message: ServerMessage) {
    if (message.kind === ServerMessageKind.Welcome) this.playerId = message.playerId
    else if (message.kind === ServerMessageKind.World) this.world = message
    else if (message.kind === ServerMessageKind.Shots) this.pendingShots.push(...message.shots)
    else this.units = message.units
  }

  takeShots(): ShotEvent[] {
    const shots = this.pendingShots
    this.pendingShots = []
    return shots
  }

  unit(id: number): UnitSnapshot | undefined {
    return this.units.find((unit) => unit.id === id)
  }

  isOpen(tile: TileCoord, ignore: number | readonly number[]): boolean {
    const world = this.world
    if (!world) return false
    if (tile.x < 0 || tile.y < 0 || tile.x >= world.width || tile.y >= world.height) return false
    if (!isWalkableTerrain(world.terrain[tile.y * world.width + tile.x])) return false
    const skip = typeof ignore === 'number' ? [ignore] : ignore
    return !this.units.some(
      (unit) => unit.tileX === tile.x && unit.tileY === tile.y && !skip.includes(unit.id),
    )
  }
}
