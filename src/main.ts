import './style.css'
import { startLoop } from './game/loop.ts'
import { createWorld } from './game/world.ts'
import { bindInput } from './input/pointer.ts'
import { GameView } from './render/view.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')
const status = document.querySelector<HTMLElement>('#status')
if (!canvas || !status) throw new Error('missing game canvas')

const world = createWorld()
const view = new GameView(canvas, status, world.map.width, world.map.height)
view.buildTerrain(world)
bindInput(canvas, world, view)
startLoop(world, view)
