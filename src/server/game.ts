import type { TileCoord } from '../shared/tiles.ts'
import type { UnitSnapshot } from '../shared/protocol.ts'
import { UNIT_TYPES, type UnitTypeId } from '../shared/unit-types.ts'
import { PathFinder } from './path/pathfinder.ts'
import { Player } from './player.ts'
import { stepUnit } from './sim/movement.ts'
import { Unit } from './units/unit.ts'
import type { World } from './world.ts'

export class Game {
  readonly world: World
  readonly pathfinder: PathFinder
  readonly units: Unit[] = []
  private readonly players = new Map<number, Player>()
  private nextUnitId = 1
  private nextPlayerId = 1

  constructor(world: World) {
    this.world = world
    this.pathfinder = new PathFinder(world)
  }

  addPlayer(): Player {
    const player = new Player(this.nextPlayerId++)
    this.players.set(player.id, player)
    return player
  }

  player(id: number): Player | undefined {
    return this.players.get(id)
  }

  spawn(owner: Player, typeId: UnitTypeId, tile: TileCoord, facing = 0): Unit {
    const type = UNIT_TYPES[typeId]
    if (!this.pathfinder.isWalkable(tile.x, tile.y, -1)) {
      throw new Error(`cannot spawn on ${tile.x},${tile.y}`)
    }
    const unit = new Unit(this.nextUnitId++, owner.id, type, tile, facing)
    this.units.push(unit)
    owner.addUnit(unit.id)
    this.pathfinder.setOccupant(tile.x, tile.y, unit.id)
    return unit
  }

  orderMove(playerId: number, unitId: number, tile: TileCoord): boolean {
    const player = this.players.get(playerId)
    if (!player?.owns(unitId)) return false
    const unit = this.units.find((candidate) => candidate.id === unitId)
    if (!unit) return false
    return unit.orderMove(tile, this.pathfinder)
  }

  tick(dt: number) {
    for (const unit of this.units) {
      stepUnit(unit, dt, UNIT_TYPES[unit.typeId], this.pathfinder, this.units)
    }
  }

  unitSnapshots(): UnitSnapshot[] {
    return this.units.map((unit) => ({
      id: unit.id,
      typeId: unit.typeId,
      ownerId: unit.ownerId,
      color: this.player(unit.ownerId)?.color ?? 0xffffff,
      x: unit.pos.x,
      z: unit.pos.z,
      facing: unit.facing,
      tileX: unit.tile.x,
      tileY: unit.tile.y,
      goal: unit.path.length > 0 ? unit.path[unit.path.length - 1] : null,
    }))
  }
}
