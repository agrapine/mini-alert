import type { TileCoord } from '../../shared/tiles.ts'
import { UnitTypeId, type UnitType } from '../../shared/unit-types.ts'
import { Artillery } from './artillery.ts'
import { Cruiser, Gunship, Jet } from './craft.ts'
import { HeavyTank } from './heavy-tank.ts'
import { MedTank } from './med-tank.ts'
import { Scout } from './scout.ts'
import { Structure } from './structure.ts'
import type { Unit } from './unit.ts'

export function createUnit(
  id: number,
  ownerId: number,
  type: UnitType,
  tile: TileCoord,
  facing: number,
): Unit {
  switch (type.id) {
    case UnitTypeId.Scout:
      return new Scout(id, ownerId, type, tile, facing)
    case UnitTypeId.MedTank:
      return new MedTank(id, ownerId, type, tile, facing)
    case UnitTypeId.HeavyTank:
      return new HeavyTank(id, ownerId, type, tile, facing)
    case UnitTypeId.Artillery:
      return new Artillery(id, ownerId, type, tile, facing)
    case UnitTypeId.Jet:
      return new Jet(id, ownerId, type, tile, facing)
    case UnitTypeId.Gunship:
      return new Gunship(id, ownerId, type, tile, facing)
    case UnitTypeId.Cruiser:
      return new Cruiser(id, ownerId, type, tile, facing)
    case UnitTypeId.Factory:
    case UnitTypeId.Turret:
    case UnitTypeId.Airport:
    case UnitTypeId.Helipad:
    case UnitTypeId.Shipyard:
      return new Structure(id, ownerId, type, tile, facing)
  }
}
