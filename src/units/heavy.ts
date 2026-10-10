import { BodyKind, UnitTypeId, type UnitType } from './types.ts'

export const HEAVY: UnitType = {
  id: UnitTypeId.Heavy,
  label: 'Heavy',
  speed: 1.7,
  footprint: 1,
  maxHealth: 220,
  body: BodyKind.Mesh,
  color: 0xd64545,
  hull: { x: 0.9, y: 0.56, z: 0.92 },
}
