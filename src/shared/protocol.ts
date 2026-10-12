import type { CityLayout } from './cities.ts'
import type { Terrain, TileCoord } from './tiles.ts'
import type { UnitTypeId, WeaponKind } from './unit-types.ts'

export const enum ClientMessageKind {
  OrderMove = 1,
  Spawn = 2,
  OrderAttack = 3,
  PlaceBuilding = 4,
  CancelSpawn = 5,
  CancelBuilding = 6,
  SetPrimary = 7,
  SetRally = 8,
  OrderAttackGround = 9,
  PlaceCity = 10,
  RequestSnapshot = 11,
}

export const enum ServerEventKind {
  Welcome = 1,
  Snapshot = 2,
  UnitMotion = 3,
  UnitHealth = 4,
  UnitProgress = 5,
  UnitHidden = 6,
  ShotSpawn = 7,
  ShotHit = 8,
  MapPatch = 9,
  CityUpdate = 10,
  Credits = 11,
  Training = 12,
  Rally = 13,
  Primary = 14,
  Yields = 15,
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

export type OrderAttackGround = {
  kind: ClientMessageKind.OrderAttackGround
  unitId: number
  tile: TileCoord
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

export type SetPrimary = {
  kind: ClientMessageKind.SetPrimary
  unitId: number
}

export type SetRally = {
  kind: ClientMessageKind.SetRally
  tile: TileCoord
}

export type PlaceCity = {
  kind: ClientMessageKind.PlaceCity
  tile: TileCoord
}

export type RequestSnapshot = {
  kind: ClientMessageKind.RequestSnapshot
}

export type ClientMessage =
  | OrderMove
  | OrderSpawn
  | OrderAttack
  | OrderAttackGround
  | PlaceBuilding
  | CancelSpawn
  | CancelBuilding
  | SetPrimary
  | SetRally
  | PlaceCity
  | RequestSnapshot

export type WelcomeEvent = {
  kind: ServerEventKind.Welcome
  playerId: number
}

export type MapPoint = { x: number; y: number }

export type MapCell = {
  x: number
  y: number
  terrain: Terrain
  shift: number
}

export type MapData = {
  width: number
  height: number
  cells: MapCell[]
  coast: MapPoint[]
  holes: MapPoint[][]
  roads: MapPoint[][]
  towns: MapPoint[]
  cleared: TileCoord[]
}

export type WorldSnapshot = {
  width: number
  height: number
  terrain: Terrain[]
  known: Uint8Array
  shifts: Uint8Array
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
  speed: number
  health: number
  tileX: number
  tileY: number
  path: TileCoord[]
  goal: TileCoord | null
  attackId: number | null
  attackPoint: { x: number; z: number } | null
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

export type ShotHit = {
  kind: WeaponKind
  aimX: number
  aimZ: number
}

export type TrainJob = {
  typeId: UnitTypeId
  progress: number
}

export type CitySite = {
  x: number
  y: number
  model: number
  yaw: number
  at: number
}

export type CityState = {
  ownerId: number
  color: number
  progress: number
  challengerId: number
  challengerColor: number
  grown: number
  ruins: TileCoord[]
  sites: CitySite[]
}

export type CityRecord = {
  index: number
  state: CityState
  layout: CityLayout
}

export type UnitMotionEvent = {
  kind: ServerEventKind.UnitMotion
  unit: UnitSnapshot
}

export type UnitHealthEvent = {
  kind: ServerEventKind.UnitHealth
  id: number
  health: number
}

export type UnitProgressEvent = {
  kind: ServerEventKind.UnitProgress
  id: number
  progress: number
}

export type UnitHiddenEvent = {
  kind: ServerEventKind.UnitHidden
  id: number
}

export type ShotSpawnEvent = {
  kind: ServerEventKind.ShotSpawn
  shot: ShotEvent
}

export type ShotHitEvent = {
  kind: ServerEventKind.ShotHit
  hit: ShotHit
}

export type MapPatchEvent = {
  kind: ServerEventKind.MapPatch
  map: MapData
}

export type CityUpdateEvent = {
  kind: ServerEventKind.CityUpdate
  city: CityRecord
}

export type CreditsEvent = {
  kind: ServerEventKind.Credits
  credits: number
}

export type TrainingEvent = {
  kind: ServerEventKind.Training
  training: TrainJob[]
}

export type RallyEvent = {
  kind: ServerEventKind.Rally
  rally: TileCoord | null
}

export type PrimaryEvent = {
  kind: ServerEventKind.Primary
  primaryFactoryId: number
}

export type YieldsEvent = {
  kind: ServerEventKind.Yields
  yields: MapPoint[]
}

export type SnapshotEvent = {
  kind: ServerEventKind.Snapshot
  map: MapData
  units: UnitSnapshot[]
  cities: CityRecord[]
  credits: number
  training: TrainJob[]
  primaryFactoryId: number
  rally: TileCoord | null
}

export type ServerEvent =
  | WelcomeEvent
  | SnapshotEvent
  | UnitMotionEvent
  | UnitHealthEvent
  | UnitProgressEvent
  | UnitHiddenEvent
  | ShotSpawnEvent
  | ShotHitEvent
  | MapPatchEvent
  | CityUpdateEvent
  | CreditsEvent
  | TrainingEvent
  | RallyEvent
  | PrimaryEvent
  | YieldsEvent

export type ServerFrame = {
  tick: number
  events: ServerEvent[]
}

export type ClientPort = {
  send(message: ClientMessage): void
  onServer(handler: (message: ServerFrame) => void): void
}

export type ServerPort = {
  readonly playerId: number
  send(message: ServerFrame): void
  onClient(handler: (message: ClientMessage) => void): void
}
