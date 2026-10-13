import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import type { CityLayout } from './cities.ts'
import {
  ClientMessageKind,
  ServerEventKind,
  type CityRecord,
  type CityState,
  type ClientMessage,
  type MapData,
  type MapPoint,
  type ServerEvent,
  type ServerFrame,
  type UnitSnapshot,
} from './protocol.ts'
import type { TileCoord } from './tiles.ts'
import { Terrain } from './tiles.ts'
import type { UnitTypeId, WeaponKind } from './unit-types.ts'
import {
  ClientCommandSchema,
  ServerFrameSchema,
  type CityLayoutMsg,
  type CityStateMsg,
  type CityUpdateMsg,
  type MapData as WireMap,
  type ServerEvent as WireEvent,
  type SnapshotMsg,
  type UnitMotionMsg,
  type WireFrame,
} from './wire.ts'

export function encodeServerFrame(frame: ServerFrame): Uint8Array {
  return toBinary(ServerFrameSchema, create(ServerFrameSchema, {
    tick: frame.tick,
    events: frame.events.map(encodeEvent),
  }))
}

export function decodeServerFrame(bytes: Uint8Array): ServerFrame | null {
  try {
    const wire = fromBinary(ServerFrameSchema, bytes)
    return {
      tick: wire.tick,
      events: wire.events.flatMap(decodeEvent),
    }
  } catch {
    return null
  }
}

export function encodeClientMessage(message: ClientMessage): Uint8Array {
  return toBinary(ClientCommandSchema, create(ClientCommandSchema, { body: encodeClient(message) } as Parameters<typeof create<typeof ClientCommandSchema>>[1]))
}

export function decodeClientMessage(bytes: Uint8Array): ClientMessage | null {
  try {
    return decodeClient(fromBinary(ClientCommandSchema, bytes))
  } catch {
    return null
  }
}

function encodeEvent(event: ServerEvent): WireFrame['events'][number] {
  switch (event.kind) {
    case ServerEventKind.Welcome:
      return packed('welcome', { playerId: event.playerId })
    case ServerEventKind.Snapshot:
      return packed('snapshot', encodeSnapshot(event))
    case ServerEventKind.UnitMotion:
      return packed('motion', encodeUnit(event.unit))
    case ServerEventKind.UnitHealth:
      return packed('health', { id: event.id, health: event.health })
    case ServerEventKind.UnitProgress:
      return packed('progress', { id: event.id, progress: event.progress })
    case ServerEventKind.UnitHidden:
      return packed('hidden', { id: event.id })
    case ServerEventKind.ShotSpawn:
      return packed('shotSpawn', {
        kind: event.shot.kind,
        shooterId: event.shot.shooterId,
        x: event.shot.x,
        z: event.shot.z,
        aimX: event.shot.aimX,
        aimZ: event.shot.aimZ,
        flight: event.shot.flight,
      })
    case ServerEventKind.ShotHit:
      return packed('shotHit', { kind: event.hit.kind, aimX: event.hit.aimX, aimZ: event.hit.aimZ })
    case ServerEventKind.MapPatch:
      return packed('mapPatch', encodeMap(event.map))
    case ServerEventKind.CityUpdate:
      return packed('city', encodeCity(event.city))
    case ServerEventKind.Credits:
      return packed('credits', { credits: event.credits })
    case ServerEventKind.Training:
      return packed('training', { jobs: event.training.map((job) => ({ typeId: job.typeId, progress: job.progress })) })
    case ServerEventKind.Rally:
      return packed('rally', event.rally ? { set: true, x: event.rally.x, y: event.rally.y } : { set: false, x: 0, y: 0 })
    case ServerEventKind.Primary:
      return packed('primary', { id: event.primaryFactoryId })
    case ServerEventKind.Yields:
      return packed('yields', { points: event.yields.map(encodePoint) })
  }
}

function packed(kind: string, value: object): WireFrame['events'][number] {
  return { body: { case: kind, value } } as WireFrame['events'][number]
}

function decodeEvent(event: WireEvent): ServerEvent[] {
  const body = event.body
  switch (body.case) {
    case 'welcome':
      return [{ kind: ServerEventKind.Welcome, playerId: body.value.playerId }]
    case 'snapshot':
      return [{ kind: ServerEventKind.Snapshot, ...decodeSnapshot(body.value) }]
    case 'motion':
      return [{ kind: ServerEventKind.UnitMotion, unit: decodeUnit(body.value) }]
    case 'health':
      return [{ kind: ServerEventKind.UnitHealth, id: body.value.id, health: body.value.health }]
    case 'progress':
      return [{ kind: ServerEventKind.UnitProgress, id: body.value.id, progress: body.value.progress }]
    case 'hidden':
      return [{ kind: ServerEventKind.UnitHidden, id: body.value.id }]
    case 'shotSpawn':
      return [{
        kind: ServerEventKind.ShotSpawn,
        shot: {
          kind: body.value.kind as WeaponKind,
          shooterId: body.value.shooterId,
          x: body.value.x,
          z: body.value.z,
          aimX: body.value.aimX,
          aimZ: body.value.aimZ,
          flight: body.value.flight,
        },
      }]
    case 'shotHit':
      return [{ kind: ServerEventKind.ShotHit, hit: { kind: body.value.kind as WeaponKind, aimX: body.value.aimX, aimZ: body.value.aimZ } }]
    case 'mapPatch':
      return [{ kind: ServerEventKind.MapPatch, map: decodeMap(body.value) }]
    case 'city':
      return [{ kind: ServerEventKind.CityUpdate, city: decodeCity(body.value) }]
    case 'credits':
      return [{ kind: ServerEventKind.Credits, credits: body.value.credits }]
    case 'training':
      return [{
        kind: ServerEventKind.Training,
        training: body.value.jobs.map((job) => ({ typeId: job.typeId as UnitTypeId, progress: job.progress })),
      }]
    case 'rally':
      return [{ kind: ServerEventKind.Rally, rally: body.value.set ? { x: body.value.x, y: body.value.y } : null }]
    case 'primary':
      return [{ kind: ServerEventKind.Primary, primaryFactoryId: body.value.id }]
    case 'yields':
      return [{ kind: ServerEventKind.Yields, yields: body.value.points.map(decodePoint) }]
    default:
      return []
  }
}

function encodeClient(message: ClientMessage): { case: 'orderMove'; value: { unitIds: number[]; x: number; y: number } } | { case: 'spawn'; value: { typeId: number } } | { case: 'orderAttack'; value: { unitIds: number[]; targetId: number } } | { case: 'placeBuilding'; value: { typeId: number; x: number; y: number } } | { case: 'cancelSpawn'; value: { typeId: number } } | { case: 'cancelBuilding'; value: { typeId: number } } | { case: 'setPrimary'; value: { unitId: number } } | { case: 'setRally'; value: { x: number; y: number } } | { case: 'orderAttackGround'; value: { unitIds: number[]; x: number; y: number } } | { case: 'placeCity'; value: { x: number; y: number } } | { case: 'requestSnapshot'; value: Record<string, never> } {
  switch (message.kind) {
    case ClientMessageKind.OrderMove:
      return { case: 'orderMove', value: { unitIds: message.unitIds, x: message.tile.x, y: message.tile.y } }
    case ClientMessageKind.Spawn:
      return { case: 'spawn', value: { typeId: message.typeId } }
    case ClientMessageKind.OrderAttack:
      return { case: 'orderAttack', value: { unitIds: message.unitIds, targetId: message.targetId } }
    case ClientMessageKind.PlaceBuilding:
      return { case: 'placeBuilding', value: { typeId: message.typeId, x: message.tile.x, y: message.tile.y } }
    case ClientMessageKind.CancelSpawn:
      return { case: 'cancelSpawn', value: { typeId: message.typeId } }
    case ClientMessageKind.CancelBuilding:
      return { case: 'cancelBuilding', value: { typeId: message.typeId } }
    case ClientMessageKind.SetPrimary:
      return { case: 'setPrimary', value: { unitId: message.unitId } }
    case ClientMessageKind.SetRally:
      return { case: 'setRally', value: { x: message.tile.x, y: message.tile.y } }
    case ClientMessageKind.OrderAttackGround:
      return { case: 'orderAttackGround', value: { unitIds: message.unitIds, x: message.tile.x, y: message.tile.y } }
    case ClientMessageKind.PlaceCity:
      return { case: 'placeCity', value: { x: message.tile.x, y: message.tile.y } }
    case ClientMessageKind.RequestSnapshot:
      return { case: 'requestSnapshot', value: {} }
  }
}

function decodeClient(command: { body: { case: string | undefined; value?: unknown } }): ClientMessage | null {
  const body = command.body
  if (body.case === 'orderMove') {
    const value = body.value as { unitIds: number[]; x: number; y: number }
    return { kind: ClientMessageKind.OrderMove, unitIds: [...value.unitIds], tile: { x: value.x, y: value.y } }
  }
  if (body.case === 'spawn') {
    const value = body.value as { typeId: number }
    return { kind: ClientMessageKind.Spawn, typeId: value.typeId as UnitTypeId }
  }
  if (body.case === 'orderAttack') {
    const value = body.value as { unitIds: number[]; targetId: number }
    return { kind: ClientMessageKind.OrderAttack, unitIds: [...value.unitIds], targetId: value.targetId }
  }
  if (body.case === 'placeBuilding') {
    const value = body.value as { typeId: number; x: number; y: number }
    return { kind: ClientMessageKind.PlaceBuilding, typeId: value.typeId as UnitTypeId, tile: { x: value.x, y: value.y } }
  }
  if (body.case === 'cancelSpawn') {
    const value = body.value as { typeId: number }
    return { kind: ClientMessageKind.CancelSpawn, typeId: value.typeId as UnitTypeId }
  }
  if (body.case === 'cancelBuilding') {
    const value = body.value as { typeId: number }
    return { kind: ClientMessageKind.CancelBuilding, typeId: value.typeId as UnitTypeId }
  }
  if (body.case === 'setPrimary') {
    const value = body.value as { unitId: number }
    return { kind: ClientMessageKind.SetPrimary, unitId: value.unitId }
  }
  if (body.case === 'setRally') {
    const value = body.value as { x: number; y: number }
    return { kind: ClientMessageKind.SetRally, tile: { x: value.x, y: value.y } }
  }
  if (body.case === 'orderAttackGround') {
    const value = body.value as { unitIds: number[]; x: number; y: number }
    return { kind: ClientMessageKind.OrderAttackGround, unitIds: [...value.unitIds], tile: { x: value.x, y: value.y } }
  }
  if (body.case === 'placeCity') {
    const value = body.value as { x: number; y: number }
    return { kind: ClientMessageKind.PlaceCity, tile: { x: value.x, y: value.y } }
  }
  if (body.case === 'requestSnapshot') return { kind: ClientMessageKind.RequestSnapshot }
  return null
}

function encodeSnapshot(event: Extract<ServerEvent, { kind: ServerEventKind.Snapshot }>): SnapshotMsg {
  return {
    map: encodeMap(event.map),
    units: event.units.map(encodeUnit),
    cities: event.cities.map(encodeCity),
    credits: event.credits,
    training: event.training.map((job) => ({ typeId: job.typeId, progress: job.progress })),
    primaryFactoryId: event.primaryFactoryId,
    rallySet: event.rally !== null,
    rallyX: event.rally?.x ?? 0,
    rallyY: event.rally?.y ?? 0,
  } as SnapshotMsg
}

function decodeSnapshot(message: SnapshotMsg): Omit<Extract<ServerEvent, { kind: ServerEventKind.Snapshot }>, 'kind'> {
  return {
    map: message.map ? decodeMap(message.map) : emptyMap(),
    units: message.units.map(decodeUnit),
    cities: message.cities.map(decodeCity),
    credits: message.credits,
    training: message.training.map((job) => ({ typeId: job.typeId as UnitTypeId, progress: job.progress })),
    primaryFactoryId: message.primaryFactoryId,
    rally: message.rallySet ? { x: message.rallyX, y: message.rallyY } : null,
  }
}

function encodeUnit(unit: UnitSnapshot): UnitMotionMsg {
  return {
    id: unit.id,
    typeId: unit.typeId,
    ownerId: unit.ownerId,
    color: unit.color,
    x: unit.x,
    z: unit.z,
    facing: unit.facing,
    turretYaw: unit.turretYaw,
    speed: unit.speed,
    health: unit.health,
    progress: unit.progress,
    tileX: unit.tileX,
    tileY: unit.tileY,
    path: unit.path.map(encodeTile),
    goal: unit.goal ? encodeTile(unit.goal) : undefined,
    attackId: unit.attackId ?? 0,
    attackX: unit.attackPoint?.x ?? 0,
    attackZ: unit.attackPoint?.z ?? 0,
    attackingGround: unit.attackPoint !== null,
    homeSet: unit.home != null,
    homeX: unit.home?.x ?? 0,
    homeY: unit.home?.y ?? 0,
    returning: unit.returning ?? false,
    flight: unit.flight ?? 0,
    altitude: unit.altitude ?? 0,
    orbitSet: unit.orbit != null,
    orbitX: unit.orbit?.x ?? 0,
    orbitY: unit.orbit?.y ?? 0,
    bay: unit.bay ?? -1,
  } as UnitMotionMsg
}

function decodeUnit(unit: UnitMotionMsg): UnitSnapshot {
  return {
    id: unit.id,
    typeId: unit.typeId as UnitTypeId,
    ownerId: unit.ownerId,
    color: unit.color,
    x: unit.x,
    z: unit.z,
    facing: unit.facing,
    turretYaw: unit.turretYaw,
    speed: unit.speed,
    health: unit.health,
    progress: unit.progress,
    tileX: unit.tileX,
    tileY: unit.tileY,
    path: unit.path.map(decodeTile),
    goal: unit.goal ? decodeTile(unit.goal) : null,
    attackId: unit.attackId > 0 ? unit.attackId : null,
    attackPoint: unit.attackingGround ? { x: unit.attackX, z: unit.attackZ } : null,
    home: unit.homeSet ? { x: unit.homeX, y: unit.homeY } : null,
    returning: unit.returning,
    flight: unit.flight,
    altitude: unit.altitude,
    orbit: unit.orbitSet ? { x: unit.orbitX, y: unit.orbitY } : null,
    bay: unit.bay,
  }
}

function encodeCity(city: CityRecord): CityUpdateMsg {
  return {
    index: city.index,
    state: encodeCityState(city.state),
    layout: encodeLayout(city.layout),
  } as CityUpdateMsg
}

function decodeCity(city: CityUpdateMsg): CityRecord {
  return {
    index: city.index,
    state: city.state ? decodeCityState(city.state) : emptyCity(),
    layout: city.layout ? decodeLayout(city.layout) : emptyLayout(),
  }
}

function encodeCityState(state: CityState): CityStateMsg {
  return {
    ownerId: state.ownerId,
    color: state.color,
    progress: state.progress,
    challengerId: state.challengerId,
    challengerColor: state.challengerColor,
    grown: state.grown,
    ruins: state.ruins.map(encodeTile),
    sites: state.sites.map((site) => ({ x: site.x, y: site.y, model: site.model, yaw: site.yaw, at: site.at })),
  } as CityStateMsg
}

function decodeCityState(state: CityStateMsg): CityState {
  return {
    ownerId: state.ownerId,
    color: state.color,
    progress: state.progress,
    challengerId: state.challengerId,
    challengerColor: state.challengerColor,
    grown: state.grown,
    ruins: state.ruins.map(decodeTile),
    sites: state.sites.map((site) => ({ x: site.x, y: site.y, model: site.model, yaw: site.yaw, at: site.at })),
  }
}

function encodeLayout(layout: CityLayout): CityLayoutMsg {
  return {
    x: layout.x,
    y: layout.y,
    span: layout.span,
    seed: layout.seed,
    tiles: layout.tiles.map(encodeTile),
    buildings: layout.buildings.map((building) => ({
      x: building.x,
      y: building.y,
      model: building.model,
      yaw: building.yaw,
      keep: building.keep,
    })),
    streets: layout.streets.map((street) => ({
      x: street.x,
      y: street.y,
      kind: street.kind,
      yaw: street.yaw,
      ox: street.ox,
      oz: street.oz,
    })),
  } as CityLayoutMsg
}

function decodeLayout(layout: CityLayoutMsg): CityLayout {
  return {
    x: layout.x,
    y: layout.y,
    span: layout.span,
    seed: layout.seed,
    tiles: layout.tiles.map(decodeTile),
    buildings: layout.buildings.map((building) => ({
      x: building.x,
      y: building.y,
      model: building.model,
      yaw: building.yaw,
      keep: building.keep,
    })),
    streets: layout.streets.map((street) => ({
      x: street.x,
      y: street.y,
      kind: street.kind,
      yaw: street.yaw,
      ox: street.ox,
      oz: street.oz,
    })),
  }
}

function encodeMap(map: MapData): WireMap {
  return {
    width: map.width,
    height: map.height,
    cells: map.cells.map((cell) => ({ x: cell.x, y: cell.y, terrain: cell.terrain, shift: cell.shift })),
    coast: map.coast.map(encodePoint),
    holes: map.holes.map((hole) => ({ points: hole.map(encodePoint) })),
    roads: map.roads.map((road) => ({ points: road.map(encodePoint) })),
    towns: map.towns.map(encodePoint),
    cleared: map.cleared.map(encodeTile),
  } as WireMap
}

function decodeMap(map: WireMap): MapData {
  return {
    width: map.width,
    height: map.height,
    cells: map.cells.map((cell) => ({ x: cell.x, y: cell.y, terrain: cell.terrain as Terrain, shift: cell.shift })),
    coast: map.coast.map(decodePoint),
    holes: map.holes.map((hole) => hole.points.map(decodePoint)),
    roads: map.roads.map((road) => road.points.map(decodePoint)),
    towns: map.towns.map(decodePoint),
    cleared: map.cleared.map(decodeTile),
  }
}

function encodeTile(tile: TileCoord): { x: number; y: number } {
  return { x: tile.x, y: tile.y }
}

function decodeTile(tile: { x: number; y: number }): TileCoord {
  return { x: tile.x, y: tile.y }
}

function encodePoint(point: MapPoint): { x: number; y: number } {
  return { x: point.x, y: point.y }
}

function decodePoint(point: { x: number; y: number }): MapPoint {
  return { x: point.x, y: point.y }
}

function emptyMap(): MapData {
  return { width: 0, height: 0, cells: [], coast: [], holes: [], roads: [], towns: [], cleared: [] }
}

function emptyCity(): CityState {
  return { ownerId: 0, color: 0, progress: 0, challengerId: 0, challengerColor: 0, grown: 0, ruins: [], sites: [] }
}

function emptyLayout(): CityLayout {
  return { x: 0, y: 0, span: 0, seed: 0, tiles: [], buildings: [], streets: [] }
}
