import './style.css'
import { Commander } from './client/commander.ts'
import { bindInput } from './client/input/pointer.ts'
import { Replica } from './client/replica.ts'
import { GameView } from './client/render/view.ts'
import { AiPlayer } from './server/ai.ts'
import { ServerHost } from './server/host.ts'
import { createIslandMatch } from './server/island-match.ts'
import { HEAVY_TANK, MED_TANK, SCOUT } from './shared/unit-types.ts'

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

const spawnBar = document.querySelector<HTMLElement>('#spawn')
if (spawnBar) {
  for (const type of [SCOUT, MED_TANK, HEAVY_TANK]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = type.label
    button.addEventListener('click', () => player.spawn(type.id))
    spawnBar.append(button)
  }
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
  view.render(replica.units, player.selected())
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
