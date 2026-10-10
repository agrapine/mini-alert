import { BodyKind, UnitTypeId, type UnitType } from './types.ts'

export const SCOUT: UnitType = {
  id: UnitTypeId.Scout,
  label: 'Scout',
  speed: 5.6,
  footprint: 1,
  maxHealth: 60,
  body: BodyKind.Mesh,
  color: 0x2f9ed8,
  hull: { x: 0.48, y: 0.32, z: 0.6 },
}
