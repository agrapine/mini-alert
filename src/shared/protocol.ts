import type { Terrain, TileCoord } from './tiles.ts'
import type { UnitTypeId, WeaponKind } from './unit-types.ts'

export const enum ClientMessageKind {
  OrderMove = 1,
  Spawn = 2,
  OrderAttack = 3,
  PlaceBuilding = 4,
  CancelSpawn = 5,
  CancelBuilding = 6,
}

export const enum ServerMessageKind {
  Welcome = 1,
  World = 2,
  Units = 3,
  Shots = 4,
}

export type OrderMove = {
  kind: ClientMessageKind.OrderMove
  unitId: number
  tile: TileCoord
}

export type OrderSpawn = {
  kind: ClientMessageKind.Spawn
  typeId: UnitTypeId
}

export type OrderAttack = {
  kind: ClientMessageKind.OrderAttack
  unitId: number
  targetId: number
}

export type PlaceBuilding = {
  kind: ClientMessageKind.PlaceBuilding
  typeId: UnitTypeId
  tile: TileCoord
}

export type CancelSpawn = {
  kind: ClientMessageKind.CancelSpawn
  typeId: UnitTypeId
}

export type CancelBuilding = {
  kind: ClientMessageKind.CancelBuilding
  typeId: UnitTypeId
}

export type ClientMessage = OrderMove | OrderSpawn | OrderAttack | PlaceBuilding | CancelSpawn | CancelBuilding

export type Welcome = {
  kind: ServerMessageKind.Welcome
  playerId: number
}

export type MapPoint = { x: number; y: number }

export type WorldSnapshot = {
  kind: ServerMessageKind.World
  width: number
  height: number
  terrain: Terrain[]
  coast: MapPoint[]
  holes: MapPoint[][]
  roads: MapPoint[][]
  towns: MapPoint[]
  seed: number
}

export type UnitSnapshot = {
  id: number
  typeId: UnitTypeId
  ownerId: number
  color: number
  x: number
  z: number
  facing: number
  turretYaw: number
  health: number
  tileX: number
  tileY: number
  goal: TileCoord | null
  progress: number
}

export type ShotEvent = {
  kind: WeaponKind
  shooterId: number
  x: number
  z: number
  aimX: number
  aimZ: number
  flight: number
}

export type ShotsSnapshot = {
  kind: ServerMessageKind.Shots
  shots: ShotEvent[]
}

export type TrainJob = {
  typeId: UnitTypeId
  progress: number
}

export type CityState = {
  ownerId: number
  color: number
  progress: number
  challengerId: number
  challengerColor: number
  grown: number
}

export type UnitsSnapshot = {
  kind: ServerMessageKind.Units
  units: UnitSnapshot[]
  credits: number
  training: TrainJob[]
  cities: CityState[]
}

export type ServerMessage = Welcome | WorldSnapshot | UnitsSnapshot | ShotsSnapshot

export type ClientPort = {
  send(message: ClientMessage): void
  onServer(handler: (message: ServerMessage) => void): void
}

export type ServerPort = {
  readonly playerId: number
  send(message: ServerMessage): void
  onClient(handler: (message: ClientMessage) => void): void
}
