export const enum BodyKind {
  Mesh = 0,
  Sprite = 1,
}

export const enum UnitTypeId {
  Scout = 0,
  MedTank = 1,
  HeavyTank = 2,
  Artillery = 3,
}

export const enum WeaponKind {
  Bullet = 0,
  Shell = 1,
}

export type HullSize = { x: number; y: number; z: number }

export type Weapon = {
  kind: WeaponKind
  sight: number
  range: number
  damage: number
  reload: number
  fireInterval: number
  magazine: number
  shellSpeed: number
  splash: number
  turretRate: number
  lockAngle: number
  aimTolerance: number
}

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
  weapon: Weapon
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
  weapon: {
    kind: WeaponKind.Bullet,
    sight: 12,
    range: 9,
    damage: 5,
    reload: 5,
    fireInterval: 0.08,
    magazine: 24,
    shellSpeed: 0,
    splash: 0,
    turretRate: 0,
    lockAngle: 0,
    aimTolerance: 0.2,
  },
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
  weapon: {
    kind: WeaponKind.Shell,
    sight: 16,
    range: 11,
    damage: 34,
    reload: 1.8,
    fireInterval: 0,
    magazine: 1,
    shellSpeed: 16,
    splash: 1.5,
    turretRate: 2.4,
    lockAngle: 0.7,
    aimTolerance: 0.08,
  },
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
  weapon: {
    kind: WeaponKind.Shell,
    sight: 18,
    range: 13,
    damage: 70,
    reload: 3.2,
    fireInterval: 0,
    magazine: 1,
    shellSpeed: 12,
    splash: 2,
    turretRate: 1.2,
    lockAngle: 0.6,
    aimTolerance: 0.08,
  },
}

export const ARTILLERY: UnitType = {
  id: UnitTypeId.Artillery,
  label: 'Artillery',
  topSpeed: 2.2,
  acceleration: 3.2,
  turnRate: 1.4,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 40,
  body: BodyKind.Mesh,
  hull: { x: 0.44, y: 0.3, z: 0.62 },
  weapon: {
    kind: WeaponKind.Shell,
    sight: 26,
    range: 22,
    damage: 46,
    reload: 6,
    fireInterval: 0.4,
    magazine: 2,
    shellSpeed: 18,
    splash: 1.8,
    turretRate: 1,
    lockAngle: 0.5,
    aimTolerance: 0.06,
  },
}

export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {
  [UnitTypeId.Scout]: SCOUT,
  [UnitTypeId.MedTank]: MED_TANK,
  [UnitTypeId.HeavyTank]: HEAVY_TANK,
  [UnitTypeId.Artillery]: ARTILLERY,
}
