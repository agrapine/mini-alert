export const enum BodyKind {
  Mesh = 0,
  Sprite = 1,
}

export const enum UnitTypeId {
  Scout = 0,
  Tank = 1,
  Heavy = 2,
}

export type HullSize = { x: number; y: number; z: number }

export type UnitType = {
  id: UnitTypeId
  label: string
  speed: number
  footprint: number
  maxHealth: number
  body: BodyKind
  hull: HullSize
}

export const SCOUT: UnitType = {
  id: UnitTypeId.Scout,
  label: 'Scout',
  speed: 5.6,
  footprint: 1,
  maxHealth: 60,
  body: BodyKind.Mesh,
  hull: { x: 0.48, y: 0.32, z: 0.6 },
}

export const TANK: UnitType = {
  id: UnitTypeId.Tank,
  label: 'Tank',
  speed: 3.2,
  footprint: 1,
  maxHealth: 120,
  body: BodyKind.Mesh,
  hull: { x: 0.66, y: 0.44, z: 0.86 },
}

export const HEAVY: UnitType = {
  id: UnitTypeId.Heavy,
  label: 'Heavy',
  speed: 1.7,
  footprint: 1,
  maxHealth: 220,
  body: BodyKind.Mesh,
  hull: { x: 0.9, y: 0.56, z: 0.92 },
}

export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {
  [UnitTypeId.Scout]: SCOUT,
  [UnitTypeId.Tank]: TANK,
  [UnitTypeId.Heavy]: HEAVY,
}
