import './style.css'
import { createSkirmish } from './game/generator.ts'
import { startLoop } from './game/loop.ts'
import { bindInput } from './input/pointer.ts'
import { GameView } from './render/view.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#view')
const status = document.querySelector<HTMLElement>('#status')
if (!canvas || !status) throw new Error('missing game canvas')

const { world, player } = createSkirmish()
const view = new GameView(canvas, status, world.map.width, world.map.height)
view.mountTerrain(world.map)
bindInput(canvas, world, player, view)
startLoop(world, player, view)
