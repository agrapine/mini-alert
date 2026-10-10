export type BodyKind = 'mesh' | 'sprite'

export type UnitTypeId = 'tank'

export type UnitType = {
  id: UnitTypeId
  speed: number
  footprint: number
  maxHealth: number
  body: BodyKind
}

export const TANK: UnitType = {
  id: 'tank',
  speed: 3.2,
  footprint: 1,
  maxHealth: 100,
  body: 'mesh',
}

export const UNIT_TYPES: Record<UnitTypeId, UnitType> = {
  tank: TANK,
}
