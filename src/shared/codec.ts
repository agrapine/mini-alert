import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import type { CityLayout } from './cities.ts'
import {
  ClientMessageKind,
  ServerEventKind,
  type CityRecord,
  type CityState,
  type ClientMessage,
  type MapCell,
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

const ORIGIN: TileCoord = { x: 0, y: 0 }

export function encodeServerFrame(frame: ServerFrame): Uint8Array {
  return toBinary(ServerFrameSchema, create(ServerFrameSchema, {
    tick: frame.tick,
    events: frame.events.map(encodeEvent),
    ack: frame.ack,
  }))
}

export function decodeServerFrame(bytes: Uint8Array): ServerFrame | null {
  try {
    const wire = fromBinary(ServerFrameSchema, bytes)
    return {
      tick: wire.tick,
      events: wire.events.flatMap(decodeEvent),
      ack: wire.ack,
    }
  } catch {
    return null
  }
}

export function encodeClientMessage(message: ClientMessage, seq: number, tick: number): Uint8Array {
  return toBinary(ClientCommandSchema, create(ClientCommandSchema, { body: encodeClient(message), seq, tick } as Parameters<typeof create<typeof ClientCommandSchema>>[1]))
}

export function decodeClientMessage(bytes: Uint8Array): { seq: number; tick: number; message: ClientMessage } | null {
  try {
    const command = fromBinary(ClientCommandSchema, bytes)
    const message = decodeClient(command)
    return message ? { seq: command.seq, tick: command.tick, message } : null
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
    case ServerEventKind.Trace:
      return packed('trace', {
        budget: event.budget,
        samples: event.samples.map((sample) => ({ slot: sample.slot, ms: sample.ms })),
      })
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
    case 'trace':
      return [{
        kind: ServerEventKind.Trace,
        budget: body.value.budget,
        samples: body.value.samples.map((sample) => ({ slot: sample.slot, ms: sample.ms })),
      }]
    default:
      return []
  }
}

function encodeClient(message: ClientMessage): { case: 'orderMove'; value: { unitIds: number[]; x: number; y: number } } | { case: 'spawn'; value: { typeId: number } } | { case: 'orderAttack'; value: { unitIds: number[]; targetId: number } } | { case: 'placeBuilding'; value: { typeId: number; x: number; y: number } } | { case: 'cancelSpawn'; value: { typeId: number } } | { case: 'cancelBuilding'; value: { typeId: number } } | { case: 'setPrimary'; value: { unitId: number } } | { case: 'setRally'; value: { x: number; y: number } } | { case: 'orderAttackGround'; value: { unitIds: number[]; x: number; y: number } } | { case: 'placeCity'; value: { x: number; y: number } } | { case: 'requestSnapshot'; value: Record<string, never> } | { case: 'ping'; value: Record<string, never> } {
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
    case ClientMessageKind.Ping:
      return { case: 'ping', value: {} }
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
  if (body.case === 'ping') return { kind: ClientMessageKind.Ping }
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
    path: packTiles(unit.path, { x: unit.tileX, y: unit.tileY }),
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
  const path = unpackTiles(unit.path, { x: unit.tileX, y: unit.tileY })
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
    path,
    goal: path.length > 0 ? { ...path[path.length - 1] } : null,
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
    layout: city.layout ? encodeLayout(city.layout) : undefined,
  } as CityUpdateMsg
}

function decodeCity(city: CityUpdateMsg): CityRecord {
  return {
    index: city.index,
    state: city.state ? decodeCityState(city.state) : emptyCity(),
    layout: city.layout ? decodeLayout(city.layout) : null,
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
    ruins: packTiles(state.ruins),
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
    ruins: unpackTiles(state.ruins),
    sites: state.sites.map((site) => ({ x: site.x, y: site.y, model: site.model, yaw: site.yaw, at: site.at })),
  }
}

function encodeLayout(layout: CityLayout): CityLayoutMsg {
  return {
    x: layout.x,
    y: layout.y,
    span: layout.span,
    seed: layout.seed,
    tiles: packTiles(layout.tiles),
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
    tiles: unpackTiles(layout.tiles),
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
  const cells = map.cells
    .map((cell) => ({ index: cell.y * map.width + cell.x, terrain: cell.terrain, shift: cell.shift }))
    .sort((a, b) => a.index - b.index)
  const steps: number[] = []
  const terrain = new Uint8Array(cells.length)
  const shifts = new Uint8Array(cells.length)
  let previous = 0
  cells.forEach((cell, i) => {
    steps.push(cell.index - previous)
    previous = cell.index
    terrain[i] = cell.terrain
    shifts[i] = cell.shift
  })
  return {
    width: map.width,
    height: map.height,
    cellSteps: steps,
    cellTerrain: terrain,
    cellShifts: shifts,
    coast: map.coast.map(encodePoint),
    holes: map.holes.map((hole) => ({ points: hole.map(encodePoint) })),
    roads: map.roads.map((road) => ({ points: road.map(encodePoint) })),
    towns: map.towns.map(encodePoint),
    cleared: packTiles(map.cleared),
  } as unknown as WireMap
}

function decodeMap(map: WireMap): MapData {
  const cells: MapCell[] = []
  let index = 0
  map.cellSteps.forEach((step, i) => {
    index += step
    const x = index % map.width
    cells.push({ x, y: (index - x) / map.width, terrain: map.cellTerrain[i] as Terrain, shift: map.cellShifts[i] })
  })
  return {
    width: map.width,
    height: map.height,
    cells,
    coast: map.coast.map(decodePoint),
    holes: map.holes.map((hole) => hole.points.map(decodePoint)),
    roads: map.roads.map((road) => road.points.map(decodePoint)),
    towns: map.towns.map(decodePoint),
    cleared: unpackTiles(map.cleared),
  }
}

function packTiles(tiles: readonly TileCoord[], from: TileCoord = ORIGIN): number[] {
  const steps: number[] = []
  let x = from.x
  let y = from.y
  for (const tile of tiles) {
    steps.push(tile.x - x, tile.y - y)
    x = tile.x
    y = tile.y
  }
  return steps
}

function unpackTiles(steps: readonly number[], from: TileCoord = ORIGIN): TileCoord[] {
  const tiles: TileCoord[] = []
  let x = from.x
  let y = from.y
  for (let i = 0; i + 1 < steps.length; i += 2) {
    x += steps[i]
    y += steps[i + 1]
    tiles.push({ x, y })
  }
  return tiles
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
