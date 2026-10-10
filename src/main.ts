import './style.css'
import { Commander } from './client/commander.ts'
import { bindInput } from './client/input/pointer.ts'
import { Replica } from './client/replica.ts'
import { GameView } from './client/render/view.ts'
import { AiPlayer } from './server/ai.ts'
import { ServerHost } from './server/host.ts'
import { createIslandMatch } from './server/island-match.ts'
import { ARTILLERY, FACTORY, HEAVY_TANK, MED_TANK, SCOUT, TURRET, UnitTypeId } from './shared/unit-types.ts'

const STEP = 1 / 30

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
const spawnBar = document.querySelector<HTMLElement>('#spawn')
const buildBar = document.querySelector<HTMLElement>('#build')
const spawnButtons: { button: HTMLButtonElement; id: UnitTypeId; cost: number }[] = []
const buildButtons: { button: HTMLButtonElement; id: UnitTypeId; cost: number }[] = []
if (spawnBar) {
  for (const type of [SCOUT, MED_TANK, HEAVY_TANK, ARTILLERY]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.label = type.label
    button.textContent = `${type.label} ${type.cost}`
    button.addEventListener('click', () => {
      if (button.disabled) return
      player.spawn(type.id)
    })
    spawnBar.append(button)
    spawnButtons.push({ button, id: type.id, cost: type.cost })
  }
}
if (buildBar) {
  for (const type of [FACTORY, TURRET]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = `${type.label} ${type.cost}`
    button.addEventListener('click', () => {
      if (button.disabled) return
      player.armBuilding(type.id)
    })
    buildBar.append(button)
    buildButtons.push({ button, id: type.id, cost: type.cost })
  }
}

const COUNT_SECONDS = 0.15
let shownCredits = replica.credits

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
  const own = replica.units.filter((unit) => unit.ownerId === replica.playerId && unit.health > 0)
  const factoryReady = own.some((unit) => unit.typeId === UnitTypeId.Factory && unit.progress >= 1)
  for (const entry of spawnButtons) {
    entry.button.disabled = !factoryReady || replica.credits < entry.cost
    entry.button.textContent = trainLabel(entry.cost, entry.button.dataset.label ?? '', entry.id, replica.training)
  }
  const armed = player.placingType()
  for (const entry of buildButtons) {
    entry.button.disabled = replica.credits < entry.cost
    entry.button.classList.toggle('armed', armed === entry.id)
  }
}

function trainLabel(cost: number, label: string, typeId: UnitTypeId, queue: readonly { typeId: UnitTypeId; progress: number }[]): string {
  const mine = queue.filter((job) => job.typeId === typeId)
  if (mine.length === 0) return `${label} ${cost}`
  const active = queue[0]?.typeId === typeId ? ` · ${Math.floor(queue[0].progress * 100)}%` : ''
  const count = mine.length > 1 || queue[0]?.typeId !== typeId ? ` ×${mine.length}` : ''
  return `${label} ${cost}${active}${count}`
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
  view.render(replica.units, player.selected(), replica.takeShots(), replica.playerId)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
