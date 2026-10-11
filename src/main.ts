import './style.css'
import { Commander } from './client/commander.ts'
import { bindMenu } from './client/menu.ts'
import { bindInput } from './client/input/pointer.ts'
import { Replica } from './client/replica.ts'
import { GameView } from './client/render/view.ts'
import { AiPlayer } from './server/ai.ts'
import { ServerHost } from './server/host.ts'
import { createIslandMatch } from './server/island-match.ts'
import { ARTILLERY, FACTORY, HEAVY_TANK, MED_TANK, SCOUT, TURRET, UNIT_TYPES, UnitTypeId } from './shared/unit-types.ts'
import { layoutCities, projectCity, type CityLayout } from './shared/cities.ts'

const STEP = 1 / 30

bindMenu()

const canvas = document.querySelector<HTMLCanvasElement>('#view')
const status = document.querySelector<HTMLElement>('#status')
if (!canvas || !status) throw new Error('missing game canvas')

const { game, human, ai } = createIslandMatch()
const host = new ServerHost(game, new AiPlayer(ai.id, game))
const port = host.join(human)
const replica = new Replica()
port.onServer((message) => replica.apply(message))
host.sync(human.id)
if (!replica.world) throw new Error('missing world snapshot')

const player = new Commander(replica, port)
const lead = replica.units.find((unit) => unit.ownerId === replica.playerId)
if (lead) player.select(lead.id)

const view = new GameView(canvas, status, replica.world.width, replica.world.height)
view.mountTerrain(replica.world)
if (lead) view.focus(lead.x, lead.z)
bindInput(canvas, replica, player, view)

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
const cityLayouts: CityLayout[] = replica.world
  ? layoutCities(replica.world.towns, replica.world.seed, replica.world.terrain, replica.world.width, replica.world.height)
  : []
const evolvedCities = cityLayouts.slice()
const shownGrown = cityLayouts.map(() => -1)

function heldCities(): { cities: number; population: number } {
  const playerId = replica.playerId
  const world = replica.world
  if (playerId === null || !world) return { cities: 0, population: 0 }
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
let acc = 0
const frame = (now: number) => {
  const frameDt = Math.min(0.1, (now - last) / 1000)
  last = now
  acc += frameDt
  while (acc >= STEP) {
    host.tick(STEP)
    acc -= STEP
  }
  view.update(frameDt)
  refreshHud(frameDt)
  view.render(replica.units, player.selected(), replica.takeShots(), replica.playerId, replica.cities)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
