import type { World } from './world.ts'
import type { GameView } from '../render/view.ts'

const STEP = 1 / 30

export function startLoop(world: World, view: GameView) {
  let last = performance.now()
  let acc = 0

  const frame = (now: number) => {
    const frameDt = Math.min(0.1, (now - last) / 1000)
    last = now
    acc += frameDt
    while (acc >= STEP) {
      world.tick(STEP)
      acc -= STEP
    }
    view.update(frameDt)
    view.render(world)
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}
