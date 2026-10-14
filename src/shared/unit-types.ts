import { ROCKET_ACCEL, ROCKET_SPEED } from './ballistics.ts'

export const enum BodyKind {
  Mesh = 0,
  Sprite = 1,
}

export const enum UnitTypeId {
  Scout = 0,
  MedTank = 1,
  HeavyTank = 2,
  Artillery = 3,
  Factory = 4,
  Turret = 5,
  Jet = 6,
  Gunship = 7,
  Cruiser = 8,
  Airport = 9,
  Helipad = 10,
  Shipyard = 11,
}

export const enum Locomotion {
  Tracks = 0,
  Wheels = 1,
  Plane = 2,
  Rotor = 3,
  Hull = 4,
}

export const enum MoveDomain {
  Ground = 0,
  Water = 1,
  Air = 2,
}

export const enum WeaponKind {
  Bullet = 0,
  Shell = 1,
  Rocket = 2,
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
  accel?: number
  splash: number
  turretRate: number
  lockAngle: number
  aimTolerance: number
}

export type UnitType = {
  id: UnitTypeId
  locomotion: Locomotion
  label: string
  topSpeed: number
  acceleration: number
  turnRate: number
  wheelbase: number
  maxSteer: number
  footprint: number
  spanX?: number
  spanY?: number
  maxHealth: number
  cost: number
  supply: number
  buildTime: number
  body: BodyKind
  hull: HullSize
  weapon: Weapon
}

export function buildStage(progress: number): number {
  if (progress >= 1) return 3
  if (progress >= 2 / 3) return 2
  if (progress >= 1 / 3) return 1
  return 0
}

export const SCOUT: UnitType = {
  id: UnitTypeId.Scout,
  locomotion: Locomotion.Wheels,
  label: 'Scout',
  topSpeed: 4.34,
  acceleration: 9,
  turnRate: 0,
  wheelbase: 0.36,
  maxSteer: 1.05,
  footprint: 1,
  maxHealth: 60,
  cost: 200,
  supply: 1,
  buildTime: 4,
  body: BodyKind.Mesh,
  hull: { x: 0.22, y: 0.16, z: 0.4 },
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
  locomotion: Locomotion.Tracks,
  label: 'Med Tank',
  topSpeed: 3.4,
  acceleration: 7,
  turnRate: 2.8,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 180,
  cost: 450,
  supply: 2,
  buildTime: 6,
  body: BodyKind.Mesh,
  hull: { x: 0.62, y: 0.4, z: 0.86 },
  weapon: {
    kind: WeaponKind.Shell,
    sight: 12,
    range: 7,
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
  locomotion: Locomotion.Tracks,
  label: 'Heavy Tank',
  topSpeed: 1.8,
  acceleration: 2.5,
  turnRate: 1.15,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 440,
  cost: 750,
  supply: 4,
  buildTime: 9,
  body: BodyKind.Mesh,
  hull: { x: 0.9, y: 0.52, z: 1.02 },
  weapon: {
    kind: WeaponKind.Shell,
    sight: 12,
    range: 8,
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
  locomotion: Locomotion.Tracks,
  label: 'Artillery',
  topSpeed: 2.2,
  acceleration: 3.2,
  turnRate: 1.4,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 40,
  cost: 550,
  supply: 3,
  buildTime: 7,
  body: BodyKind.Mesh,
  hull: { x: 0.44, y: 0.3, z: 0.62 },
  weapon: {
    kind: WeaponKind.Shell,
    sight: 8,
    range: 18.7,
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

const UNARMED: Weapon = {
  kind: WeaponKind.Bullet,
  sight: 0,
  range: 0,
  damage: 0,
  reload: 0,
  fireInterval: 0,
  magazine: 0,
  shellSpeed: 0,
  splash: 0,
  turretRate: 0,
  lockAngle: 0,
  aimTolerance: 0,
}

export const FACTORY: UnitType = {
  id: UnitTypeId.Factory,
  locomotion: Locomotion.Tracks,
  label: 'Factory',
  topSpeed: 0,
  acceleration: 0,
  turnRate: 0,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 2,
  maxHealth: 480,
  cost: 2500,
  supply: 4,
  buildTime: 8,
  body: BodyKind.Mesh,
  hull: { x: 1.8, y: 0.9, z: 1.8 },
  weapon: UNARMED,
}

export const TURRET: UnitType = {
  id: UnitTypeId.Turret,
  locomotion: Locomotion.Tracks,
  label: 'Turret',
  topSpeed: 0,
  acceleration: 0,
  turnRate: 0,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 100,
  cost: 800,
  supply: 2,
  buildTime: 5,
  body: BodyKind.Mesh,
  hull: { x: 0.8, y: 0.5, z: 0.8 },
  weapon: {
    kind: WeaponKind.Shell,
    sight: 14,
    range: 12,
    damage: 30,
    reload: 1.6,
    fireInterval: 0,
    magazine: 1,
    shellSpeed: 18,
    splash: 1.2,
    turretRate: 1.8,
    lockAngle: 0.8,
    aimTolerance: 0.08,
  },
}

export const JET: UnitType = {
  id: UnitTypeId.Jet,
  locomotion: Locomotion.Plane,
  label: 'Jet',
  topSpeed: 9,
  acceleration: 8,
  turnRate: 2.4,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 70,
  cost: 500,
  supply: 2,
  buildTime: 5,
  body: BodyKind.Mesh,
  hull: { x: 0.7, y: 0.16, z: 0.9 },
  weapon: {
    kind: WeaponKind.Rocket,
    sight: 21,
    range: 12,
    damage: 84,
    reload: 0,
    fireInterval: 0.6,
    magazine: 5,
    shellSpeed: ROCKET_SPEED,
    accel: ROCKET_ACCEL,
    splash: 3.6,
    turretRate: 0,
    lockAngle: 0,
    aimTolerance: 0.35,
  },
}

export const GUNSHIP: UnitType = {
  id: UnitTypeId.Gunship,
  locomotion: Locomotion.Rotor,
  label: 'Gunship',
  topSpeed: 5.2,
  acceleration: 4.5,
  turnRate: 2.4,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 150,
  cost: 650,
  supply: 3,
  buildTime: 6,
  body: BodyKind.Mesh,
  hull: { x: 0.55, y: 0.28, z: 0.85 },
  weapon: {
    kind: WeaponKind.Shell,
    sight: 12,
    range: 8,
    damage: 22,
    reload: 1.4,
    fireInterval: 0,
    magazine: 1,
    shellSpeed: 20,
    splash: 1.1,
    turretRate: 2.2,
    lockAngle: 0.9,
    aimTolerance: 0.1,
  },
}

export const CRUISER: UnitType = {
  id: UnitTypeId.Cruiser,
  locomotion: Locomotion.Hull,
  label: 'Cruiser',
  topSpeed: 3.4,
  acceleration: 0.35,
  turnRate: 0.825,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 360,
  cost: 800,
  supply: 2,
  buildTime: 8,
  body: BodyKind.Mesh,
  hull: { x: 0.7, y: 0.36, z: 1.35 },
  weapon: {
    kind: WeaponKind.Shell,
    sight: 13,
    range: 30,
    damage: 48,
    reload: 2.8,
    fireInterval: 0,
    magazine: 1,
    shellSpeed: 14,
    splash: 1.6,
    turretRate: 0.9,
    lockAngle: 0.7,
    aimTolerance: 0.08,
  },
}

export const AIRPORT: UnitType = {
  id: UnitTypeId.Airport,
  locomotion: Locomotion.Tracks,
  label: 'Airport',
  topSpeed: 0,
  acceleration: 0,
  turnRate: 0,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 3,
  maxHealth: 420,
  cost: 2800,
  supply: 12,
  buildTime: 8,
  body: BodyKind.Mesh,
  hull: { x: 2.8, y: 0.5, z: 2.8 },
  weapon: UNARMED,
}

export const HELIPAD: UnitType = {
  id: UnitTypeId.Helipad,
  locomotion: Locomotion.Tracks,
  label: 'Helipad',
  topSpeed: 0,
  acceleration: 0,
  turnRate: 0,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 1,
  maxHealth: 240,
  cost: 1600,
  supply: 4,
  buildTime: 6,
  body: BodyKind.Mesh,
  hull: { x: 0.9, y: 0.2, z: 0.9 },
  weapon: UNARMED,
}

export const SHIPYARD: UnitType = {
  id: UnitTypeId.Shipyard,
  locomotion: Locomotion.Tracks,
  label: 'Shipyard',
  topSpeed: 0,
  acceleration: 0,
  turnRate: 0,
  wheelbase: 0,
  maxSteer: 0,
  footprint: 2,
  maxHealth: 460,
  cost: 2600,
  supply: 8,
  buildTime: 8,
  body: BodyKind.Mesh,
  hull: { x: 1.8, y: 0.8, z: 1.8 },
  weapon: UNARMED,
}

export function spanOf(type: UnitType): { x: number; y: number } {
  return { x: type.spanX ?? type.footprint, y: type.spanY ?? type.footprint }
}

export function domainOf(type: UnitType): MoveDomain {
  if (type.locomotion === Locomotion.Hull) return MoveDomain.Water
  if (type.locomotion === Locomotion.Plane || type.locomotion === Locomotion.Rotor) return MoveDomain.Air
  return MoveDomain.Ground
}

export function yardOf(typeId: UnitTypeId): UnitTypeId {
  if (typeId === UnitTypeId.Jet) return UnitTypeId.Airport
  if (typeId === UnitTypeId.Gunship) return UnitTypeId.Helipad
  if (typeId === UnitTypeId.Cruiser) return UnitTypeId.Shipyard
  return UnitTypeId.Factory
}

export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {
  [UnitTypeId.Scout]: SCOUT,
  [UnitTypeId.MedTank]: MED_TANK,
  [UnitTypeId.HeavyTank]: HEAVY_TANK,
  [UnitTypeId.Artillery]: ARTILLERY,
  [UnitTypeId.Factory]: FACTORY,
  [UnitTypeId.Turret]: TURRET,
  [UnitTypeId.Jet]: JET,
  [UnitTypeId.Gunship]: GUNSHIP,
  [UnitTypeId.Cruiser]: CRUISER,
  [UnitTypeId.Airport]: AIRPORT,
  [UnitTypeId.Helipad]: HELIPAD,
  [UnitTypeId.Shipyard]: SHIPYARD,
}
