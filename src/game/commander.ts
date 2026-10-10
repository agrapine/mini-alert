import type { TileCoord } from '../map/map.ts'
import type { Unit } from '../units/unit.ts'
import type { World } from './world.ts'

export class Commander {
  selectedId: number | null = null
  private readonly world: World

  constructor(world: World) {
    this.world = world
  }

  select(id: number | null) {
    this.selectedId = id
  }

  selected(): Unit | null {
    if (this.selectedId === null) return null
    return this.world.units.find((unit) => unit.id === this.selectedId) ?? null
  }

  // 
  orderMove(tile: TileCoord) {
    const unit = this.selected()
    if (!unit) return
    unit.orderMove(tile, this.world.pathfinder)
  }
}
