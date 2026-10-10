import { HEAVY } from './heavy.ts'
import { SCOUT } from './scout.ts'
import { TANK } from './tank.ts'
import { UnitTypeId, type UnitType } from './types.ts'

export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {
  [UnitTypeId.Scout]: SCOUT,
  [UnitTypeId.Tank]: TANK,
  [UnitTypeId.Heavy]: HEAVY,
}

export { HEAVY, SCOUT, TANK }
