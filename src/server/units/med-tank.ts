import type { TileCoord } from '../../shared/tiles.ts'
import type { UnitType } from '../../shared/unit-types.ts'
import { Unit } from './unit.ts'

export class MedTank extends Unit {
  constructor(id: number, ownerId: number, type: UnitType, tile: TileCoord, facing: number) {
    super(id, ownerId, type, tile, facing)
  }
}
