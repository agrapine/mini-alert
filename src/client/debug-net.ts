import { LobbyClientKind, LobbyServerKind, type LobbyClientMessage, type LobbyServerMessage } from '../shared/lobby.ts'
import { ClientMessageKind, ServerEventKind, type ClientMessage, type MapData, type ServerEvent, type ServerFrame, type UnitSnapshot } from '../shared/protocol.ts'
import { UnitTypeId, WeaponKind } from '../shared/unit-types.ts'

declare global {
  interface Window {
    debugNet: boolean
  }
}

const IN = 'color:#6dcc8a'
const OUT = 'color:#7eb6ff'

const CLIENT_KIND: Record<number, string> = {
  [ClientMessageKind.OrderMove]: 'OrderMove',
  [ClientMessageKind.Spawn]: 'Spawn',
  [ClientMessageKind.OrderAttack]: 'OrderAttack',
  [ClientMessageKind.PlaceBuilding]: 'PlaceBuilding',
  [ClientMessageKind.CancelSpawn]: 'CancelSpawn',
  [ClientMessageKind.CancelBuilding]: 'CancelBuilding',
  [ClientMessageKind.SetRally]: 'SetRally',
  [ClientMessageKind.OrderAttackGround]: 'OrderAttackGround',
  [ClientMessageKind.PlaceCity]: 'PlaceCity',
  [ClientMessageKind.RequestSnapshot]: 'RequestSnapshot',
}

const SERVER_KIND: Record<number, string> = {
  [ServerEventKind.Welcome]: 'Welcome',
  [ServerEventKind.Snapshot]: 'Snapshot',
  [ServerEventKind.UnitMotion]: 'UnitMotion',
  [ServerEventKind.UnitHealth]: 'UnitHealth',
  [ServerEventKind.UnitProgress]: 'UnitProgress',
  [ServerEventKind.UnitHidden]: 'UnitHidden',
  [ServerEventKind.ShotSpawn]: 'ShotSpawn',
  [ServerEventKind.ShotHit]: 'ShotHit',
  [ServerEventKind.MapPatch]: 'MapPatch',
  [ServerEventKind.CityUpdate]: 'CityUpdate',
  [ServerEventKind.Credits]: 'Credits',
  [ServerEventKind.Training]: 'Training',
  [ServerEventKind.Rally]: 'Rally',
  [ServerEventKind.Yields]: 'Yields',
  [ServerEventKind.Trace]: 'Trace',
}

const LOBBY_CLIENT_KIND: Record<number, string> = {
  [LobbyClientKind.SetName]: 'SetName',
  [LobbyClientKind.CreateGame]: 'CreateGame',
  [LobbyClientKind.JoinGame]: 'JoinGame',
  [LobbyClientKind.LeaveRoom]: 'LeaveRoom',
  [LobbyClientKind.TakeSlot]: 'TakeSlot',
  [LobbyClientKind.SetSlotAi]: 'SetSlotAi',
  [LobbyClientKind.ClearSlot]: 'ClearSlot',
  [LobbyClientKind.SetMapSize]: 'SetMapSize',
  [LobbyClientKind.StartGame]: 'StartGame',
  [LobbyClientKind.Chat]: 'Chat',
  [LobbyClientKind.ViewAs]: 'ViewAs',
  [LobbyClientKind.Regenerate]: 'Regenerate',
  [LobbyClientKind.SetAiPace]: 'SetAiPace',
  [LobbyClientKind.ClaimAdmin]: 'ClaimAdmin',
  [LobbyClientKind.DestroyGame]: 'DestroyGame',
  [LobbyClientKind.SetLandform]: 'SetLandform',
  [LobbyClientKind.SetLakes]: 'SetLakes',
}

const LOBBY_SERVER_KIND: Record<number, string> = {
  [LobbyServerKind.Waiting]: 'Waiting',
  [LobbyServerKind.GameLobby]: 'GameLobby',
  [LobbyServerKind.Preview]: 'Preview',
}

const UNIT_TYPE: Record<number, string> = {
  [UnitTypeId.Scout]: 'Scout',
  [UnitTypeId.MedTank]: 'MedTank',
  [UnitTypeId.HeavyTank]: 'HeavyTank',
  [UnitTypeId.Artillery]: 'Artillery',
  [UnitTypeId.Factory]: 'Factory',
  [UnitTypeId.Turret]: 'Turret',
  [UnitTypeId.Jet]: 'Jet',
  [UnitTypeId.Gunship]: 'Gunship',
  [UnitTypeId.Cruiser]: 'Cruiser',
  [UnitTypeId.Airport]: 'Airport',
  [UnitTypeId.Helipad]: 'Helipad',
  [UnitTypeId.Shipyard]: 'Shipyard',
}

const WEAPON: Record<number, string> = {
  [WeaponKind.Bullet]: 'Bullet',
  [WeaponKind.Shell]: 'Shell',
  [WeaponKind.Rocket]: 'Rocket',
}

if (window.debugNet === undefined) window.debugNet = false

export function logGameIn(frame: ServerFrame) {
  if (!window.debugNet) return
  print('←', 'game', frameLabel(frame), presentFrame(frame))
}

export function logGameOut(message: ClientMessage) {
  if (!window.debugNet) return
  print('→', 'game', name(message.kind, CLIENT_KIND), presentClient(message))
}

export function logLobbyIn(message: LobbyServerMessage) {
  if (!window.debugNet) return
  print('←', 'lobby', name(message.kind, LOBBY_SERVER_KIND), presentLobby(message))
}

export function logLobbyOut(message: LobbyClientMessage) {
  if (!window.debugNet) return
  print('→', 'lobby', name(message.kind, LOBBY_CLIENT_KIND), { ...message, kind: name(message.kind, LOBBY_CLIENT_KIND) })
}

export function logGameUndecodable(bytes: number) {
  if (!window.debugNet) return
  print('←', 'game', `undecodable ${bytes}b`, null)
}

function print(arrow: '←' | '→', channel: string, label: string, payload: unknown) {
  const style = arrow === '←' ? IN : OUT
  if (payload === null) {
    console.log(`%c${arrow} ${channel} ${label}`, style)
    return
  }
  console.groupCollapsed(`%c${arrow} ${channel} ${label}`, style)
  console.log(payload)
  console.groupEnd()
}

function frameLabel(frame: ServerFrame): string {
  if (frame.events.length === 0) return `t=${frame.tick} · keepalive`
  const counts = new Map<string, number>()
  for (const event of frame.events) {
    const label = name(event.kind, SERVER_KIND)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const summary = [...counts].map(([label, count]) => (count > 1 ? `${label} ×${count}` : label)).join(', ')
  return `t=${frame.tick} · ${summary}`
}

function presentFrame(frame: ServerFrame) {
  return { tick: frame.tick, events: frame.events.map(presentEvent) }
}

function presentEvent(event: ServerEvent) {
  const kind = name(event.kind, SERVER_KIND)
  if (event.kind === ServerEventKind.Snapshot) {
    return {
      kind,
      map: briefMap(event.map),
      units: event.units.map(presentUnit),
      cities: event.cities.length,
      credits: event.credits,
      training: event.training,
      rally: event.rally,
    }
  }
  if (event.kind === ServerEventKind.UnitMotion) return { kind, unit: presentUnit(event.unit) }
  if (event.kind === ServerEventKind.ShotSpawn) return { kind, shot: { ...event.shot, kind: name(event.shot.kind, WEAPON) } }
  if (event.kind === ServerEventKind.ShotHit) return { kind, hit: { ...event.hit, kind: name(event.hit.kind, WEAPON) } }
  if (event.kind === ServerEventKind.MapPatch) return { kind, map: briefMap(event.map) }
  if (event.kind === ServerEventKind.Training) {
    return { kind, training: event.training.map((job) => ({ ...job, typeId: name(job.typeId, UNIT_TYPE) })) }
  }
  return { ...event, kind }
}

function presentClient(message: ClientMessage) {
  const kind = name(message.kind, CLIENT_KIND)
  if (
    message.kind === ClientMessageKind.Spawn ||
    message.kind === ClientMessageKind.PlaceBuilding ||
    message.kind === ClientMessageKind.CancelSpawn ||
    message.kind === ClientMessageKind.CancelBuilding
  ) {
    return { ...message, kind, typeId: name(message.typeId, UNIT_TYPE) }
  }
  return { ...message, kind }
}

function presentUnit(unit: UnitSnapshot) {
  return {
    ...unit,
    typeId: name(unit.typeId, UNIT_TYPE),
    x: round(unit.x),
    z: round(unit.z),
    facing: round(unit.facing),
    turretYaw: round(unit.turretYaw),
    speed: round(unit.speed),
    health: round(unit.health),
    progress: round(unit.progress),
  }
}

function briefMap(map: MapData) {
  return {
    width: map.width,
    height: map.height,
    cells: map.cells.length,
    coast: map.coast.length,
    holes: map.holes.length,
    roads: map.roads.length,
    towns: map.towns.length,
    cleared: map.cleared,
  }
}

function presentLobby(message: LobbyServerMessage) {
  const kind = name(message.kind, LOBBY_SERVER_KIND)
  if (message.kind === LobbyServerKind.Preview) return { ...message, kind, terrain: `${message.terrain.length} chars` }
  return { ...message, kind }
}

function name(kind: number, table: Record<number, string>): string {
  return table[kind] ?? String(kind)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
