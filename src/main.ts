import './style.css'
import { adminEnabled } from './client/admin.ts'
import { Commander } from './client/commander.ts'
import { LobbyView } from './client/lobby-ui.ts'
import { Music } from './client/music.ts'
import { rememberedName, rememberName } from './client/player-name.ts'
import { bindMenu } from './client/menu.ts'
import { Net } from './client/net.ts'
import { bindInput, orderAt } from './client/input/pointer.ts'
import { Replica } from './client/replica.ts'
import { seatLink } from './client/seat.ts'
import { GameView } from './client/render/view.ts'
import { populationOf } from './shared/cities.ts'
import { baysFree } from './shared/flight.ts'
import { LobbyClientKind, LobbyServerKind, RoomStatus, type Faction, type MapPreview } from './shared/lobby.ts'
import { ClientMessageKind, ServerEventKind, type ClientPort, type TrainJob, type UnitSnapshot } from './shared/protocol.ts'
import type { TileCoord } from './shared/tiles.ts'
import { AIRPORT, ARTILLERY, CRUISER, FACTORY, GUNSHIP, HEAVY_TANK, HELIPAD, JET, Locomotion, MED_TANK, SCOUT, SHIPYARD, TURRET, UNIT_TYPES, UnitTypeId, yardOf } from './shared/unit-types.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')
const lobbyRoot = document.querySelector<HTMLElement>('#lobby')
const vision = document.querySelector<HTMLElement>('#vision')
const legend = document.querySelector<HTMLElement>('#legend')
const outcome = document.querySelector<HTMLElement>('#outcome')
const outcomeTitle = document.querySelector<HTMLElement>('#outcome-title')
const outcomeText = document.querySelector<HTMLElement>('#outcome-text')
const outcomeClose = document.querySelector<HTMLButtonElement>('#outcome-close')
if (!canvas || !lobbyRoot || !vision || !legend || !outcome || !outcomeTitle || !outcomeText || !outcomeClose) {
  throw new Error('missing game canvas')
}
const viewCanvas = canvas
const visionBar = vision
const legendBar = legend
const outcomeLayer = outcome
const outcomeHeading = outcomeTitle
const outcomeCopy = outcomeText
outcomeClose.addEventListener('click', () => {
  outcomeLayer.hidden = true
})
outcomeLayer.addEventListener('click', (event) => {
  if (event.target === outcomeLayer) outcomeLayer.hidden = true
})

const replica = new Replica({ rollback: true })
const net = new Net()
const port: ClientPort = {
  send(message) {
    return net.sendGame(message, replica.localTick)
  },
  onServer() {},
}
const player = new Commander(replica, port)
const live: { view: GameView | null } = { view: null }
const viewApi = new Proxy({} as GameView, {
  get(_target, key) {
    const current = live.view
    if (!current) return () => undefined
    const value = current[key as keyof GameView]
    return typeof value === 'function' ? value.bind(current) : value
  },
})
bindInput(canvas, replica, player, viewApi)

let spectating = false
let factions: Faction[] = []
let seatId = 0
let toldDefeat = false
let toldWin = false
let preview: MapPreview | null = null
let aimed = false

const music = new Music()
bindMenu({
  onMusic(on) {
    music.setMuted(!on)
  },
  onSurrender() {
    net.sendLobby({ kind: LobbyClientKind.LeaveRoom })
  },
})
document.body.classList.add('lobby')
window.addEventListener('pointerdown', () => music.resume())

let claimedName: string | null = null
const admin = adminEnabled(location.search)

const lobby = new LobbyView(lobbyRoot, {
  setName(name) {
    rememberName(name)
    const saved = rememberedName()
    if (!saved) return
    claimedName = saved
    net.sendLobby({ kind: LobbyClientKind.SetName, name: saved })
  },
  async copyLink() {
    await navigator.clipboard.writeText(seatLink(net.seat))
  },
  createGame() {
    music.lobby()
    net.sendLobby({ kind: LobbyClientKind.CreateGame })
  },
  joinGame(id) {
    music.lobby()
    net.sendLobby({ kind: LobbyClientKind.JoinGame, gameId: id })
  },
  leave() {
    net.sendLobby({ kind: LobbyClientKind.LeaveRoom })
  },
  takeSlot(index) {
    net.sendLobby({ kind: LobbyClientKind.TakeSlot, index })
  },
  setSlotAi(index) {
    net.sendLobby({ kind: LobbyClientKind.SetSlotAi, index })
  },
  clearSlot(index) {
    net.sendLobby({ kind: LobbyClientKind.ClearSlot, index })
  },
  setMapSize(size) {
    lobby.setBusy(true)
    net.sendLobby({ kind: LobbyClientKind.SetMapSize, size })
  },
  regenerate() {
    lobby.setBusy(true)
    net.sendLobby({ kind: LobbyClientKind.Regenerate })
  },
  start() {
    net.sendLobby({ kind: LobbyClientKind.StartGame })
  },
  setAiPace(pace) {
    net.sendLobby({ kind: LobbyClientKind.SetAiPace, pace })
  },
  chat(text) {
    net.sendLobby({ kind: LobbyClientKind.Chat, text })
  },
  destroyGame(id) {
    net.sendLobby({ kind: LobbyClientKind.DestroyGame, gameId: id })
  },
  postRequest(text) {
    net.sendLobby({ kind: LobbyClientKind.PostRequest, text })
  },
  toggleVote(id) {
    net.sendLobby({ kind: LobbyClientKind.ToggleVote, requestId: id })
  },
  markRequestDone(id) {
    net.sendLobby({ kind: LobbyClientKind.MarkRequestDone, requestId: id })
  },
  deleteRequest(id) {
    net.sendLobby({ kind: LobbyClientKind.DeleteRequest, requestId: id })
  },
  playHere() {
    net.connect()
  },
}, admin)

net.onOpen = () => {
  lobby.setConnected(true)
  if (admin) net.sendLobby({ kind: LobbyClientKind.ClaimAdmin })
}
net.onClose = () => {
  claimedName = null
  lobby.setConnected(false)
}
net.onLobby = (message) => {
  if (message.kind === LobbyServerKind.Replaced) {
    net.pause()
    leaveMatch()
    music.silent()
    lobby.showReplaced()
    return
  }
  if (message.kind === LobbyServerKind.Preview) {
    preview = message
    lobby.showPreview(message)
    return
  }
  if (message.kind === LobbyServerKind.Waiting) {
    leaveMatch()
    music.silent()
    preview = null
    lobby.showWaiting(message)
    claimName(message.you.name)
    return
  }
  factions = message.factions
  seatId = message.seatId
  if (message.spectating !== spectating) {
    spectating = message.spectating
    player.setSpectating(spectating)
  }
  if (message.status === RoomStatus.Playing) {
    showMatch()
    music.match()
    paintVision()
    paintLegend()
    noteOutcome()
    return
  }
  leaveMatch()
  music.lobby()
  lobby.showGame(message, preview)
  claimName(message.you.name)
}

function claimName(serverName: string) {
  const saved = rememberedName()
  if (!saved || saved === serverName) return
  lobby.holdName(saved)
  if (claimedName === saved) return
  claimedName = saved
  net.sendLobby({ kind: LobbyClientKind.SetName, name: saved })
}
net.onGame = (frame) => {
  const previous = replica.playerId
  const hadWorld = replica.world
  replica.apply(frame)
  const welcome = frame.events.find((event) => event.kind === ServerEventKind.Welcome)
  if (welcome && spectating && welcome.playerId !== previous) {
    live.view?.forgetVision()
    player.select(null)
    aimed = false
    paintVision()
    if (replica.world) mountWorld()
    return
  }
  if (!hadWorld && replica.world) mountWorld()
  if (frame.events.some((event) => event.kind === ServerEventKind.Snapshot)) aimOnce()
  if (replica.advance(0)) net.sendGame({ kind: ClientMessageKind.RequestSnapshot }, replica.localTick)
}
net.connect()

function showMatch() {
  document.body.classList.add('match')
  document.body.classList.remove('lobby')
  document.body.classList.toggle('spectate', spectating)
  lobby.hide()
}

function leaveMatch() {
  spectating = false
  factions = []
  seatId = 0
  toldDefeat = false
  toldWin = false
  aimed = false
  player.setSpectating(false)
  player.reset()
  replica.reset()
  live.view?.dispose()
  live.view = null
  document.body.classList.add('lobby')
  document.body.classList.remove('match', 'spectate')
  visionBar.hidden = true
  visionBar.replaceChildren()
  legendBar.hidden = true
  legendBar.replaceChildren()
  outcomeLayer.hidden = true
}

function mountWorld() {
  const world = replica.world
  if (!world) return
  showMatch()
  live.view?.dispose()
  const view = new GameView(viewCanvas, world.width, world.height)
  live.view = view
  view.mountTerrain(world, replica.terrainRevision, replica.knownTiles)
  view.setMinimapCommand((tile, mods) => orderAt(tile, replica, player, view, mods))
  view.setMinimapHover((tile) => {
    if (player.raisingCity()) player.setAim(tile)
  })
  view.resize()
  aimed = false
  shownCredits = replica.credits
  aimOnce()
  paintVision()
  paintLegend()
}

function aimOnce() {
  if (aimed || !live.view) return
  const lead = replica.units.find((unit) => unit.ownerId === replica.playerId && unit.health > 0)
  if (!lead) return
  aimed = true
  if (!spectating) player.select(lead.id)
  live.view.focus(lead.x, lead.z)
}

function paintVision() {
  visionBar.hidden = !spectating
  visionBar.replaceChildren()
  if (!spectating) return
  for (const faction of factions) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = faction.name
    button.style.color = cssColor(faction.color)
    button.classList.toggle('on', faction.playerId === replica.playerId)
    button.addEventListener('click', () => {
      net.sendLobby({ kind: LobbyClientKind.ViewAs, playerId: faction.playerId })
    })
    visionBar.append(button)
  }
  const leave = document.createElement('button')
  leave.type = 'button'
  leave.textContent = 'Leave'
  leave.addEventListener('click', () => net.sendLobby({ kind: LobbyClientKind.LeaveRoom }))
  visionBar.append(leave)
}

function paintLegend() {
  legendBar.hidden = false
  legendBar.replaceChildren()
  for (const faction of factions) {
    const row = document.createElement('div')
    row.className = 'legend-row'
    row.classList.toggle('defeated', faction.defeated)
    const swatch = document.createElement('i')
    swatch.style.background = cssColor(faction.color)
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = faction.name
    row.append(swatch, name)
    if (faction.defeated) {
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = 'defeated'
      row.append(tag)
    }
    legendBar.append(row)
  }
}

function noteOutcome() {
  const mine = factions.find((faction) => faction.playerId === seatId)
  if (mine?.defeated && !toldDefeat) {
    toldDefeat = true
    showOutcome('Defeated', 'Your forces are gone.')
  }
  const alive = factions.filter((faction) => !faction.defeated)
  if (mine && !mine.defeated && !toldWin && alive.length === 1 && factions.some((faction) => faction.defeated)) {
    toldWin = true
    showOutcome('Victory', 'You are the last player.')
  }
}

function showOutcome(title: string, text: string) {
  outcomeHeading.textContent = title
  outcomeCopy.textContent = text
  outcomeLayer.hidden = false
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

const credits = document.querySelector<HTMLElement>('#credits')
const forces = document.querySelector<HTMLElement>('#forces')
const population = document.querySelector<HTMLElement>('#population')
const cities = document.querySelector<HTMLElement>('#cities')
const ping = document.querySelector<HTMLElement>('#ping')
const orders = document.querySelector<HTMLElement>('#orders')
const fullscreen = document.querySelector<HTMLButtonElement>('#fullscreen')
const NEEDS_FACTORY = new Set<UnitTypeId>([UnitTypeId.Airport, UnitTypeId.Helipad, UnitTypeId.Shipyard])
const tiles: OrderTile[] = []
if (orders) {
  for (const type of [FACTORY, TURRET, AIRPORT, HELIPAD, SHIPYARD]) {
    tiles.push(createTile(orders, type.id, false, type.label, type.cost, () => player.armBuilding(type.id), () => player.cancelBuild(type.id)))
  }
  tiles.push(createTile(orders, null, false, 'Building', 0, () => player.armCity()))
  for (const type of [SCOUT, MED_TANK, HEAVY_TANK, ARTILLERY, JET, GUNSHIP, CRUISER]) {
    tiles.push(createTile(orders, type.id, true, type.label, type.cost, () => player.spawn(type.id), () => player.cancelSpawn(type.id)))
  }
}
fullscreen?.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen()
})

const COUNT_SECONDS = 0.15
const PING_MS = 2000
const STALL_MS = 6000
const SLOW_PING_MS = 150
const BAD_PING_MS = 300
let shownCredits = replica.credits

function heldCities(): { cities: number; population: number } {
  const playerId = replica.playerId
  if (playerId === null || !replica.world) return { cities: 0, population: 0 }
  const settled = replica.settledLayouts()
  let cities = 0
  let population = 0
  for (let i = 0; i < settled.length; i++) {
    const state = replica.cities[i]
    const layout = settled[i]
    if (!state || !layout || state.ownerId !== playerId) continue
    cities += 1
    population += populationOf(layout, state.ruins)
  }
  return { cities, population }
}

const refreshHud = (dt: number) => {
  const target = replica.credits
  const blend = dt <= 0 ? 1 : 1 - Math.exp(-dt / COUNT_SECONDS)
  shownCredits += (target - shownCredits) * blend
  if (Math.abs(target - shownCredits) < 0.5) shownCredits = target
  if (credits) {
    credits.textContent = Math.round(shownCredits).toLocaleString('en-US')
    const gap = target - shownCredits
    credits.classList.toggle('up', gap > 30)
    credits.classList.toggle('down', gap < -30)
  }
  const held = heldCities()
  const own = replica.units.filter((unit) => unit.ownerId === replica.playerId && unit.health > 0)
  let army = 0
  for (const unit of own) army += UNIT_TYPES[unit.typeId].supply
  let queued = 0
  const queue = replica.queue()
  for (const job of queue) queued += UNIT_TYPES[job.typeId].supply
  if (forces) {
    forces.textContent = String(army)
    forces.classList.toggle('over', army > held.population)
  }
  if (population) population.textContent = String(held.population)
  if (cities) cities.textContent = String(held.cities)
  if (ping) {
    const rtt = net.rtt
    ping.textContent = rtt === null ? '–' : `${Math.round(rtt)} ms`
    ping.classList.toggle('slow', rtt !== null && rtt > SLOW_PING_MS)
    ping.classList.toggle('bad', rtt !== null && rtt > BAD_PING_MS)
  }
  const ready = new Set<number>()
  for (const unit of own) {
    if (unit.progress >= 1 && UNIT_TYPES[unit.typeId].topSpeed <= 0) ready.add(unit.typeId)
  }
  const head = queue[0]
  const armed = player.placingType()
  const pending = structureQueue()
  const quoted = player.raisingCity() ? replica.cityBuildCost(player.aimedTile()) : null
  for (const entry of tiles) {
    if (entry.id === null) {
      entry.cost.textContent = costLine(quoted ?? 0, 1)
      paintTile(entry, 0, 0, true, true, player.raisingCity())
      continue
    }
    const training = entry.train
    let count = 0
    let progress = 0
    if (training) {
      for (const job of queue) if (job.typeId === entry.id) count += 1
      progress = head?.typeId === entry.id ? head.progress : 0
    } else {
      const site = pending.get(entry.id)
      count = site?.count ?? 0
      progress = site?.progress ?? 0
    }
    const gate = training ? ready.has(yardOf(entry.id)) : !NEEDS_FACTORY.has(entry.id) || ready.has(UnitTypeId.Factory)
    const supplyRoom = army + queued + UNIT_TYPES[entry.id].supply <= held.population
    const room = supplyRoom && (entry.id !== UnitTypeId.Jet || jetApron(own, queue) > 0)
    paintTile(entry, count, progress, gate && room, gate || count > 0 || progress > 0, !training && armed === entry.id)
  }
}

type OrderTile = {
  id: UnitTypeId | null
  train: boolean
  button: HTMLButtonElement
  ring: HTMLElement
  badge: HTMLElement
  cost: HTMLElement
}

function createTile(
  bar: HTMLElement,
  id: UnitTypeId | null,
  train: boolean,
  name: string,
  cost: number,
  onAdd: () => void,
  onRemove?: () => void,
): OrderTile {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `tile ${tileKind(id)}`
  button.title = name
  button.hidden = train || (id !== null && NEEDS_FACTORY.has(id))
  const pie = document.createElement('span')
  pie.className = 'pie'
  const label = document.createElement('span')
  label.className = 'name'
  label.textContent = name
  const price = document.createElement('span')
  price.className = 'cost'
  price.textContent = costLine(cost, id === null ? 1 : UNIT_TYPES[id].supply)
  const badge = document.createElement('span')
  badge.className = 'badge'
  badge.hidden = true
  button.append(pie, label, price, badge)
  button.addEventListener('click', (event) => {
    if (event.shiftKey) {
      onRemove?.()
      return
    }
    if (!button.classList.contains('ready')) return
    onAdd()
  })
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    onRemove?.()
  })
  bar.append(button)
  return { id, train, button, ring: pie, badge, cost: price }
}

function paintTile(entry: OrderTile, count: number, progress: number, enabled: boolean, visible: boolean, armed = false) {
  entry.button.hidden = !visible
  const amount = Math.max(0, Math.min(1, progress))
  entry.ring.style.setProperty('--p', String(amount))
  entry.ring.classList.toggle('on', amount > 0)
  const marked = count > 1 || (count === 1 && amount <= 0)
  entry.badge.hidden = !marked
  entry.badge.textContent = marked ? String(count) : ''
  entry.button.classList.toggle('ready', enabled)
  entry.button.classList.toggle('live', count > 0 || progress > 0 || armed)
  entry.button.classList.toggle('armed', armed)
}

function jetApron(own: readonly UnitSnapshot[], training: readonly TrainJob[]): number {
  const pads: TileCoord[] = []
  const parked: { x: number; y: number; bay: number }[] = []
  for (const unit of own) {
    if (unit.health <= 0) continue
    if (unit.typeId === UnitTypeId.Airport && unit.progress >= 1) pads.push({ x: unit.tileX, y: unit.tileY })
    if (unit.typeId === UnitTypeId.Jet && unit.home && (unit.bay ?? -1) >= 0) {
      parked.push({ x: unit.home.x, y: unit.home.y, bay: unit.bay ?? -1 })
    }
  }
  let queued = 0
  for (const job of training) if (job.typeId === UnitTypeId.Jet) queued += 1
  return baysFree(pads, parked) - queued
}

function structureQueue(): Map<UnitTypeId, { count: number; progress: number }> {
  const queue = new Map<UnitTypeId, { count: number; progress: number }>()
  for (const unit of replica.units) {
    if (unit.ownerId !== replica.playerId || unit.health <= 0 || unit.progress >= 1) continue
    if (UNIT_TYPES[unit.typeId].topSpeed > 0) continue
    const site = queue.get(unit.typeId) ?? { count: 0, progress: 0 }
    site.count += 1
    if (unit.progress > site.progress) site.progress = unit.progress
    queue.set(unit.typeId, site)
  }
  return queue
}

function costLine(credits: number, supply: number): string {
  const price = credits > 0 ? credits.toLocaleString('en-US') : ''
  if (supply <= 0) return price
  return price ? `${price} · ${supply}` : String(supply)
}

function tileKind(id: UnitTypeId | null): 'structure' | 'vehicle' | 'air' | 'boat' {
  if (id === null) return 'structure'
  const type = UNIT_TYPES[id]
  if (type.topSpeed <= 0) return 'structure'
  if (type.locomotion === Locomotion.Plane || type.locomotion === Locomotion.Rotor) return 'air'
  if (type.locomotion === Locomotion.Hull) return 'boat'
  return 'vehicle'
}

let last = performance.now()
const frame = (now: number) => {
  const frameDt = Math.min(0.1, (now - last) / 1000)
  last = now
  const view = live.view
  if (view) {
    if (replica.advance(frameDt)) net.sendGame({ kind: ClientMessageKind.RequestSnapshot }, replica.localTick)
    if (replica.world) view.syncTerrain(replica.world, replica.terrainRevision, replica.knownTiles)
    view.syncCities(replica.settledLayouts(), replica.cityRevision)
    view.update(frameDt)
    refreshHud(frameDt)
    view.showExpectedSites(replica.expectedSiteList())
    view.render(
      replica.drawn(),
      player.selected(),
      replica.takeShots(),
      replica.takeHits(),
      replica.playerId,
      replica.cities,
      replica.settledLayouts(),
      replica.shownPrimary(),
      replica.shownRally(),
      replica.cleared,
      replica.takeYields(),
    )
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

window.setInterval(() => {
  if (!live.view) return
  const quiet = net.quietFor()
  if (quiet !== null && quiet > STALL_MS) {
    net.drop()
    return
  }
  if (!document.hidden) net.sendGame({ kind: ClientMessageKind.Ping }, replica.localTick)
}, PING_MS)
