import type { Terrain, TileCoord } from './tiles.ts'
import type { UnitTypeId } from './unit-types.ts'

export const enum ClientMessageKind {
  OrderMove = 1,
}

export const enum ServerMessageKind {
  Welcome = 1,
  World = 2,
  Units = 3,
}

export type OrderMove = {
  kind: ClientMessageKind.OrderMove
  unitId: number
  tile: TileCoord
}

export type ClientMessage = OrderMove

export type Welcome = {
  kind: ServerMessageKind.Welcome
  playerId: number
}

export type WorldSnapshot = {
  kind: ServerMessageKind.World
  width: number
  height: number
  terrain: Terrain[]
}

export type UnitSnapshot = {
  id: number
  typeId: UnitTypeId
  ownerId: number
  color: number
  x: number
  z: number
  facing: number
  tileX: number
  tileY: number
  goal: TileCoord | null
}

export type UnitsSnapshot = {
  kind: ServerMessageKind.Units
  units: UnitSnapshot[]
}

export type ServerMessage = Welcome | WorldSnapshot | UnitsSnapshot

export type ClientPort = {
  send(message: ClientMessage): void
  onServer(handler: (message: ServerMessage) => void): void
}

export type ServerPort = {
  readonly playerId: number
  send(message: ServerMessage): void
  onClient(handler: (message: ClientMessage) => void): void
}
