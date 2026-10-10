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
  color: number
  hull: HullSize
}
