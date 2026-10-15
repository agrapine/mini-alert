import './style.css'
import { adminEnabled } from './client/admin.ts'
import { Alarm } from './client/alarm.ts'
import { Commander } from './client/commander.ts'
import { CreditCounter, focusLabel, functionSlot, hudModel, PingState, TileKind, Trend, type HudInput, type HudTile } from './client/hud-model.ts'
import { LobbyView } from './client/lobby-ui.ts'
import { Music } from './client/music.ts'
import { rememberedName, rememberName } from './client/player-name.ts'
import { bindMenu } from './client/menu.ts'
import { Net } from './client/net.ts'
import { bindInput, orderAt } from './client/input/pointer.ts'
import { typing } from './client/input/keys.ts'
import { Replica } from './client/replica.ts'
import { seatLink } from './client/seat.ts'
import { GameView } from './client/render/view.ts'
import { bindTrace } from './client/trace-pie.ts'
import { HALL_SPAN } from './shared/cities.ts'
import { LobbyClientKind, LobbyServerKind, RoomStatus, type Faction, type MapPreview } from './shared/lobby.ts'
import { ClientMessageKind, ServerEventKind, type ClientPort } from './shared/protocol.ts'
import { Locomotion, UNIT_TYPES, UnitTypeId } from './shared/unit-types.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')
const lobbyRoot = document.querySelector<HTMLElement>('#lobby')
const traceRoot = document.querySelector<HTMLElement>('#trace')
const vision = document.querySelector<HTMLElement>('#vision')
const legend = document.querySelector<HTMLElement>('#legend')
const outcome = document.querySelector<HTMLElement>('#outcome')
const outcomeTitle = document.querySelector<HTMLElement>('#outcome-title')
const outcomeText = document.querySelector<HTMLElement>('#outcome-text')
const outcomeClose = document.querySelector<HTMLButtonElement>('#outcome-close')
if (!canvas || !lobbyRoot || !traceRoot || !vision || !legend || !outcome || !outcomeTitle || !outcomeText || !outcomeClose) {
  throw new Error('missing game canvas')
}
const viewCanvas = canvas
const tracePie = bindTrace(traceRoot)
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
const alarm = new Alarm()
bindMenu({
  onMusic(on) {
    music.setMuted(!on)
  },
  onSounds(on) {
    alarm.setOn(on)
  },
  onMusicVolume(volume) {
    music.setVolume(volume)
  },
  onSoundsVolume(volume) {
    alarm.setVolume(volume)
  },
  onSurrender() {
    net.sendLobby({ kind: LobbyClientKind.LeaveRoom })
  },
})
document.body.classList.add('lobby')
window.addEventListener('pointerdown', () => music.resume())
alarm.listen(window)

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
  setLandform(landform) {
    lobby.setBusy(true)
    net.sendLobby({ kind: LobbyClientKind.SetLandform, landform })
  },
  setLakes(lakes) {
    lobby.setBusy(true)
    net.sendLobby({ kind: LobbyClientKind.SetLakes, lakes })
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
  for (const event of frame.events) {
    if (event.kind === ServerEventKind.Trace) tracePie.paint(event)
  }
  if (frame.events.length > 0 && frame.events.every((event) => event.kind === ServerEventKind.Trace)) return
  const previous = replica.playerId
  const hadWorld = replica.world
  replica.apply(frame)
  const welcome = frame.events.find((event) => event.kind === ServerEventKind.Welcome)
  if (welcome && spectating && welcome.playerId !== previous) {
    live.view?.forgetVision(replica.world?.known)
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
  tracePie.hide()
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
  view.setAlert((kind) => alarm.sound(kind))
  view.resize()
  aimed = false
  creditCounter.snap(replica.credits)
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
const cityFocus = document.querySelector<HTMLElement>('#city-focus')
const cityFocusLabel = document.querySelector<HTMLElement>('#city-focus-label')
const cityFocusRange = document.querySelector<HTMLInputElement>('#city-focus-range')
const fullscreen = document.querySelector<HTMLButtonElement>('#fullscreen')
const tiles: OrderTile[] = []
let queueSplit: HTMLElement | null = null
if (orders) {
  for (const tile of hudModel(hudInput()).tiles) {
    if (tile.kind === TileKind.Queued && !queueSplit) {
      queueSplit = document.createElement('div')
      queueSplit.className = 'queue-split'
      queueSplit.textContent = 'Queued: '
      queueSplit.hidden = true
      orders.append(queueSplit)
    }
    tiles.push(createTile(orders, tile))
  }
  window.addEventListener('keydown', (event) => {
    if (typing(event) || event.repeat || orders.hidden) return
    const slot = functionSlot(event.code)
    if (slot === null) return
    const entry = tiles.find((tile) => tile.slot === slot)
    if (!entry) return
    event.preventDefault()
    if (event.shiftKey) entry.onRemove?.()
    else if (entry.button.classList.contains('ready')) entry.onAdd()
  })
}
cityFocusRange?.addEventListener('input', () => {
  const step = Number(cityFocusRange.value)
  if (cityFocusLabel) cityFocusLabel.textContent = focusLabel(step)
  player.setCityFocus(step)
})
fullscreen?.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen()
})

const PING_MS = 2000
const STALL_MS = 6000
const creditCounter = new CreditCounter()

function hudInput(): HudInput {
  const raising = player.raisingCity()
  return {
    playerId: replica.playerId,
    units: replica.units,
    queue: replica.queue(),
    cities: replica.cities,
    layouts: replica.settledLayouts(),
    yard: player.productionYard(),
    placing: player.placingType(),
    raising,
    hall: player.selectedCity(),
    quote: raising ? replica.cityBuildCost(player.aimedTile()) : null,
    rtt: net.rtt,
    spectating,
  }
}

const refreshHud = (dt: number) => {
  creditCounter.ease(replica.credits, dt)
  if (credits) {
    credits.textContent = Math.round(creditCounter.shown).toLocaleString('en-US')
    credits.classList.toggle('up', creditCounter.trend === Trend.Up)
    credits.classList.toggle('down', creditCounter.trend === Trend.Down)
  }
  const model = hudModel(hudInput())
  if (forces) {
    forces.textContent = String(model.army)
    forces.classList.toggle('over', model.over)
  }
  if (population) population.textContent = String(model.population)
  if (cities) cities.textContent = String(model.cities)
  if (orders) orders.hidden = model.hall !== null
  if (cityFocus) cityFocus.hidden = model.hall === null
  if (model.hall !== null && cityFocusRange && cityFocusLabel && document.activeElement !== cityFocusRange) {
    cityFocusRange.value = String(model.hall.focus)
    cityFocusLabel.textContent = model.hall.label
  }
  if (ping) {
    const shown = model.ping
    ping.textContent = shown.state === PingState.None ? '–' : `${shown.ms} ms`
    ping.classList.toggle('slow', shown.state === PingState.Slow || shown.state === PingState.Bad)
    ping.classList.toggle('bad', shown.state === PingState.Bad)
  }
  if (queueSplit) queueSplit.hidden = !model.queued
  for (let i = 0; i < tiles.length; i++) paintTile(tiles[i], model.tiles[i])
}

type OrderTile = {
  slot: number | null
  button: HTMLButtonElement
  ring: HTMLElement
  badge: HTMLElement
  hotkey: HTMLElement
  cost: HTMLElement
  onAdd: () => void
  onRemove?: () => void
}

function createTile(bar: HTMLElement, tile: HudTile): OrderTile {
  const queue = tile.kind === TileKind.Queued
  const name = tile.kind === TileKind.City ? 'Building' : UNIT_TYPES[tile.type].label
  const { onAdd, onRemove } = tileActions(tile)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `tile ${tileClass(tile.kind === TileKind.City ? null : tile.type)}`
  button.title = name
  button.hidden = !tile.visible
  const pie = document.createElement('span')
  pie.className = 'pie'
  const label = document.createElement('span')
  label.className = 'name'
  label.textContent = name
  const price = document.createElement('span')
  price.className = 'cost'
  price.textContent = tile.cost
  const badge = document.createElement('span')
  badge.className = 'badge'
  badge.hidden = true
  const hotkey = document.createElement('span')
  hotkey.className = 'hotkey'
  button.append(pie, label, price, badge, hotkey)
  button.addEventListener('click', (event) => {
    if (queue || event.shiftKey) {
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
  return { slot: null, button, ring: pie, badge, hotkey, cost: price, onAdd, onRemove }
}

function tileActions(tile: HudTile): { onAdd: () => void; onRemove?: () => void } {
  if (tile.kind === TileKind.City) return { onAdd: () => player.armCity() }
  const type = tile.type
  if (tile.kind === TileKind.Structure) return { onAdd: () => player.armBuilding(type), onRemove: () => player.cancelBuild(type) }
  if (tile.kind === TileKind.Queued) return { onAdd: () => player.cancelSpawn(type), onRemove: () => player.cancelSpawn(type) }
  return {
    onAdd: () => player.spawn(type),
    onRemove: () => {
      const yard = player.productionYard()
      if (yard) player.cancelSpawn(type, yard.id)
    },
  }
}

function paintTile(entry: OrderTile, tile: HudTile) {
  entry.button.hidden = !tile.visible
  const amount = Math.max(0, Math.min(1, tile.progress))
  entry.ring.style.setProperty('--p', String(amount))
  entry.ring.classList.toggle('on', amount > 0)
  entry.badge.hidden = !tile.badge
  entry.badge.textContent = tile.badge ? String(tile.count) : ''
  entry.button.classList.toggle('ready', tile.ready)
  entry.button.classList.toggle('live', tile.count > 0 || tile.progress > 0 || tile.armed)
  entry.button.classList.toggle('armed', tile.armed)
  if (entry.cost.textContent !== tile.cost) entry.cost.textContent = tile.cost
  entry.slot = tile.slot
  const hotkey = tile.slot === null ? '' : `F${tile.slot}`
  if (entry.hotkey.textContent !== hotkey) entry.hotkey.textContent = hotkey
}

function tileClass(id: UnitTypeId | null): 'structure' | 'vehicle' | 'air' | 'boat' {
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
    const hallIndex = player.selectedCity()
    const hallLayout = hallIndex === null ? null : replica.settledLayouts()[hallIndex]
    const hallBuilding = hallLayout?.buildings.find((building) => building.keep) ?? null
    view.showHall(hallBuilding ? { x: hallBuilding.x + HALL_SPAN / 2, z: hallBuilding.y + HALL_SPAN / 2 } : null)
    view.render(
      replica.drawn(),
      player.selected(),
      replica.takeShots(),
      replica.takeHits(),
      replica.playerId,
      replica.cities,
      replica.settledLayouts(),
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
