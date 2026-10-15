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
  SetRally = 8,
  OrderAttackGround = 9,
  PlaceCity = 10,
  RequestSnapshot = 11,
  Ping = 12,
  SetCityFocus = 13,
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
  Yields = 15,
  Trace = 16,
}

export type OrderMove = {
  kind: ClientMessageKind.OrderMove
  unitIds: number[]
  tile: TileCoord
}

export type OrderSpawn = {
  kind: ClientMessageKind.Spawn
  typeId: UnitTypeId
  yardId: number
}

export type OrderAttack = {
  kind: ClientMessageKind.OrderAttack
  unitIds: number[]
  targetId: number
}

export type OrderAttackGround = {
  kind: ClientMessageKind.OrderAttackGround
  unitIds: number[]
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
  yardId: number
}

export type CancelBuilding = {
  kind: ClientMessageKind.CancelBuilding
  typeId: UnitTypeId
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

export type Ping = {
  kind: ClientMessageKind.Ping
}

export type SetCityFocus = {
  kind: ClientMessageKind.SetCityFocus
  index: number
  focus: number
}

export type ClientMessage =
  | OrderMove
  | OrderSpawn
  | OrderAttack
  | OrderAttackGround
  | PlaceBuilding
  | CancelSpawn
  | CancelBuilding
  | SetRally
  | PlaceCity
  | RequestSnapshot
  | Ping
  | SetCityFocus

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
  home?: TileCoord | null
  returning?: boolean
  flight?: number
  altitude?: number
  orbit?: TileCoord | null
  bay?: number
  rounds?: number
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
  yardId: number
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
  /** -2..2. Missing on older snapshots means the center step. */
  focus?: number
  ruins: TileCoord[]
  sites: CitySite[]
}

export type CityRecord = {
  index: number
  state: CityState
  layout: CityLayout | null
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

export type YieldsEvent = {
  kind: ServerEventKind.Yields
  yields: MapPoint[]
}

export type TraceSample = {
  slot: number
  ms: number
}

export type TraceEvent = {
  kind: ServerEventKind.Trace
  budget: number
  samples: TraceSample[]
}

export type SnapshotEvent = {
  kind: ServerEventKind.Snapshot
  map: MapData
  units: UnitSnapshot[]
  cities: CityRecord[]
  credits: number
  training: TrainJob[]
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
  | YieldsEvent
  | TraceEvent

export type ServerFrame = {
  tick: number
  events: ServerEvent[]
  ack: number
}

export type ClientPort = {
  /** Sends a command and returns its sequence number, or null when there is no connection to send on. */
  send(message: ClientMessage): number | null
  onServer(handler: (message: ServerFrame) => void): void
}

export type ServerPort = {
  readonly playerId: number
  send(message: ServerFrame): void
  onClient(handler: (message: ClientMessage) => void): void
}
