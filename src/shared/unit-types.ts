export const enum BodyKind {
  Mesh = 0,
  Sprite = 1,
}

export const enum UnitTypeId {
  Scout = 0,
  MedTank = 1,
  HeavyTank = 2,
}

export type HullSize = { x: number; y: number; z: number }

export type UnitType = {
  id: UnitTypeId
  label: string
  topSpeed: number
  acceleration: number
  turnRate: number
  wheelbase: number
  maxSteer: number
  footprint: number
  maxHealth: number
  body: BodyKind
  hull: HullSize
}

export const SCOUT: UnitType = {
  id: UnitTypeId.Scout,
  label: 'Scout',
  topSpeed: 6.2,
  acceleration: 9,
  turnRate: 0,
  wheelbase: 0.55,
  maxSteer: 0.85,
  footprint: 1,
  maxHealth: 60,
  body: BodyKind.Mesh,
  hull: { x: 0.4, y: 0.28, z: 0.78 },
}

export const MED_TANK: UnitType = {
  id: UnitTypeId.MedTank,
  label: 'Med Tank',
  topSpeed: 3.4,
  acceleration: 7,
  turnRate: 2.8,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 120,
  body: BodyKind.Mesh,
  hull: { x: 0.62, y: 0.4, z: 0.86 },
}

export const HEAVY_TANK: UnitType = {
  id: UnitTypeId.HeavyTank,
  label: 'Heavy Tank',
  topSpeed: 1.8,
  acceleration: 2.5,
  turnRate: 1.15,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 220,
  body: BodyKind.Mesh,
  hull: { x: 0.9, y: 0.52, z: 1.02 },
}

export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {
  [UnitTypeId.Scout]: SCOUT,
  [UnitTypeId.MedTank]: MED_TANK,
  [UnitTypeId.HeavyTank]: HEAVY_TANK,
}
