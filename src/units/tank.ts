import { BodyKind, UnitTypeId, type UnitType } from './types.ts'

export const TANK: UnitType = {
  id: UnitTypeId.Tank,
  label: 'Tank',
  speed: 3.2,
  footprint: 1,
  maxHealth: 120,
  body: BodyKind.Mesh,
  color: 0xe6a317,
  hull: { x: 0.66, y: 0.44, z: 0.86 },
}
