import type { Commander } from '../commander.ts'
import type { GameView } from '../render/view.ts'
import { typing } from './keys.ts'

const RECENTER_MS = 400

export function bindGroupKeys(player: Commander, view: GameView) {
  let lastSlot = -1
  let lastAt = 0

  window.addEventListener('keydown', (event) => {
    if (typing(event)) return
    const slot = groupSlot(event.code)
    if (slot === null || event.metaKey) return
    event.preventDefault()
    if (event.repeat) return
    if (event.ctrlKey || event.altKey) {
      player.assignGroup(slot)
      lastSlot = -1
      return
    }
    const units = player.recallGroup(slot, event.shiftKey)
    const twice = slot === lastSlot && event.timeStamp - lastAt < RECENTER_MS
    lastSlot = slot
    lastAt = event.timeStamp
    if (!twice || units.length === 0) return
    let x = 0
    let z = 0
    for (const unit of units) {
      x += unit.x
      z += unit.z
    }
    view.focus(x / units.length, z / units.length)
  })
}

function groupSlot(code: string): number | null {
  const match = /^Digit([0-9])$/.exec(code)
  return match ? Number(match[1]) : null
}
