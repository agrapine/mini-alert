import './style.css'
import { Commander } from './client/commander.ts'
import { LobbyView } from './client/lobby-ui.ts'
import { Music } from './client/music.ts'
import { rememberedName, rememberName } from './client/player-name.ts'
import { bindMenu } from './client/menu.ts'
import { Net } from './client/net.ts'
import { bindInput } from './client/input/pointer.ts'
import { Replica } from './client/replica.ts'
import { GameView } from './client/render/view.ts'
import { layoutCities, projectCity, type CityLayout } from './shared/cities.ts'
import { LobbyClientKind, LobbyServerKind, RoomStatus, type Faction, type MapPreview } from './shared/lobby.ts'
import { ServerMessageKind, type ClientPort, type WorldSnapshot } from './shared/protocol.ts'
import { ARTILLERY, FACTORY, HEAVY_TANK, MED_TANK, SCOUT, TURRET, UNIT_TYPES, UnitTypeId } from './shared/unit-types.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')
const status = document.querySelector<HTMLElement>('#status')
const lobbyRoot = document.querySelector<HTMLElement>('#lobby')
const vision = document.querySelector<HTMLElement>('#vision')
const legend = document.querySelector<HTMLElement>('#legend')
const outcome = document.querySelector<HTMLElement>('#outcome')
const outcomeTitle = document.querySelector<HTMLElement>('#outcome-title')
const outcomeText = document.querySelector<HTMLElement>('#outcome-text')
const outcomeClose = document.querySelector<HTMLButtonElement>('#outcome-close')
if (!canvas || !status || !lobbyRoot || !vision || !legend || !outcome || !outcomeTitle || !outcomeText || !outcomeClose) {
  throw new Error('missing game canvas')
}
const viewCanvas = canvas
const viewStatus = status
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

const replica = new Replica()
const net = new Net()
const port: ClientPort = {
  send(message) {
    net.sendGame(message)
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
})
document.body.classList.add('lobby')
window.addEventListener('pointerdown', () => music.resume())

let claimedName: string | null = null

const lobby = new LobbyView(lobbyRoot, {
  setName(name) {
    rememberName(name)
    const saved = rememberedName()
    if (!saved) return
    claimedName = saved
    net.sendLobby({ kind: LobbyClientKind.SetName, name: saved })
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
})

net.onOpen = () => lobby.setConnected(true)
net.onClose = () => {
  claimedName = null
  lobby.setConnected(false)
}
net.onLobby = (message) => {
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
net.onGame = (message) => {
  const previous = replica.playerId
  replica.apply(message)
  if (message.kind === ServerMessageKind.Welcome && spectating && message.playerId !== previous) {
    live.view?.forgetVision()
    player.select(null)
    aimed = false
    paintVision()
  }
  if (message.kind === ServerMessageKind.World) mountWorld()
  else if (message.kind === ServerMessageKind.Units) aimOnce()
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
  const view = new GameView(viewCanvas, viewStatus, world.width, world.height)
  live.view = view
  view.mountTerrain(world)
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
const realm = document.querySelector<HTMLElement>('#realm')
const spawnBar = document.querySelector<HTMLElement>('#spawn')
const buildBar = document.querySelector<HTMLElement>('#build')
const spawnButtons: UnitOrder[] = []
const buildButtons: BuildButton[] = []
if (spawnBar) {
  for (const type of [SCOUT, MED_TANK, HEAVY_TANK, ARTILLERY]) {
    spawnButtons.push(createUnitOrder(spawnBar, type.id, type.label, type.cost, () => player.spawn(type.id), () => player.cancelSpawn(type.id)))
  }
}
if (buildBar) {
  for (const type of [FACTORY, TURRET]) {
    buildButtons.push(createBuild(buildBar, type.id, type.label, type.cost, () => player.armBuilding(type.id)))
  }
}

const COUNT_SECONDS = 0.15
let shownCredits = replica.credits
let cityLayouts: CityLayout[] = []
let evolvedCities: CityLayout[] = []
let shownGrown: number[] = []
let laidOut: WorldSnapshot | null = null

function heldCities(): { cities: number; population: number } {
  const playerId = replica.playerId
  const world = replica.world
  if (playerId === null || !world) return { cities: 0, population: 0 }
  if (world !== laidOut) {
    laidOut = world
    cityLayouts = layoutCities(world.towns, world.seed, world.terrain, world.width, world.height)
    evolvedCities = cityLayouts.slice()
    shownGrown = cityLayouts.map(() => -1)
  }
  let cities = 0
  let population = 0
  for (let i = 0; i < cityLayouts.length; i++) {
    const grown = replica.cities[i]?.grown ?? 0
    if (shownGrown[i] !== grown) {
      evolvedCities[i] = projectCity(cityLayouts[i], grown, world.terrain, world.width, world.height)
      shownGrown[i] = grown
    }
    if (replica.cities[i]?.ownerId !== playerId) continue
    cities += 1
    population += evolvedCities[i].tiles.length
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
  if (realm) {
    const held = heldCities()
    const label = held.cities === 1 ? 'city' : 'cities'
    realm.textContent = `${held.cities} ${label} · pop ${held.population}`
  }
  const own = replica.units.filter((unit) => unit.ownerId === replica.playerId && unit.health > 0)
  const factoryReady = own.some((unit) => unit.typeId === UnitTypeId.Factory && unit.progress >= 1)
  const head = replica.training[0]
  for (const entry of spawnButtons) {
    let count = 0
    for (const job of replica.training) if (job.typeId === entry.id) count += 1
    const progress = head?.typeId === entry.id ? head.progress : 0
    paintUnit(entry, count, progress, factoryReady)
  }
  const armed = player.placingType()
  const pending = structureProgress()
  for (const entry of buildButtons) {
    paintBuild(entry, pending.get(entry.id) ?? 0, armed === entry.id)
  }
}

type UnitOrder = {
  id: UnitTypeId
  main: HTMLButtonElement
  fill: HTMLElement
  count: HTMLElement
  minus: HTMLButtonElement
  plus: HTMLButtonElement
}

type BuildButton = {
  id: UnitTypeId
  button: HTMLButtonElement
  fill: HTMLElement
}

function createUnitOrder(
  bar: HTMLElement,
  id: UnitTypeId,
  name: string,
  cost: number,
  onAdd: () => void,
  onRemove: () => void,
): UnitOrder {
  const row = document.createElement('div')
  row.className = 'order'
  const main = document.createElement('button')
  main.type = 'button'
  main.className = 'meter'
  const fill = document.createElement('span')
  fill.className = 'fill'
  const face = document.createElement('span')
  face.className = 'face'
  const label = document.createElement('span')
  label.className = 'label'
  label.textContent = `${name} ${cost}`
  const count = document.createElement('span')
  count.className = 'count'
  face.append(label, count)
  main.append(fill, face)
  main.addEventListener('click', () => {
    if (main.disabled) return
    onAdd()
  })
  const minus = document.createElement('button')
  minus.type = 'button'
  minus.className = 'nudge minus'
  minus.textContent = '[-]'
  minus.addEventListener('click', () => {
    if (!minus.classList.contains('on')) return
    onRemove()
  })
  const plus = document.createElement('button')
  plus.type = 'button'
  plus.className = 'nudge plus'
  plus.textContent = '[+]'
  plus.addEventListener('click', () => {
    if (!plus.classList.contains('on')) return
    onAdd()
  })
  row.append(main, minus, plus)
  bar.append(row)
  return { id, main, fill, count, minus, plus }
}

function createBuild(bar: HTMLElement, id: UnitTypeId, name: string, cost: number, onAdd: () => void): BuildButton {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'meter'
  const fill = document.createElement('span')
  fill.className = 'fill'
  const label = document.createElement('span')
  label.className = 'label'
  label.textContent = `${name} ${cost}`
  button.append(fill, label)
  button.addEventListener('click', () => {
    if (button.disabled) return
    onAdd()
  })
  bar.append(button)
  return { id, button, fill }
}

function paintUnit(entry: UnitOrder, count: number, progress: number, enabled: boolean) {
  entry.fill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`
  entry.count.textContent = count > 0 ? `×${count}` : ''
  entry.main.disabled = !enabled
  entry.plus.classList.toggle('on', enabled)
  entry.minus.classList.toggle('on', count > 0)
}

function paintBuild(entry: BuildButton, progress: number, armed: boolean) {
  entry.fill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`
  entry.button.classList.toggle('armed', armed)
}

function structureProgress(): Map<UnitTypeId, number> {
  const progress = new Map<UnitTypeId, number>()
  let active: { id: number; typeId: UnitTypeId; progress: number } | null = null
  for (const unit of replica.units) {
    if (unit.ownerId !== replica.playerId || unit.health <= 0 || unit.progress >= 1) continue
    if (UNIT_TYPES[unit.typeId].topSpeed > 0) continue
    if (!active || unit.id < active.id) active = unit
  }
  if (active) progress.set(active.typeId, active.progress)
  return progress
}

let last = performance.now()
const frame = (now: number) => {
  const frameDt = Math.min(0.1, (now - last) / 1000)
  last = now
  const view = live.view
  if (view) {
    view.update(frameDt)
    refreshHud(frameDt)
    view.render(
      replica.units,
      player.selected(),
      replica.takeShots(),
      replica.playerId,
      replica.cities,
      replica.primaryFactoryId,
      replica.rally,
    )
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
