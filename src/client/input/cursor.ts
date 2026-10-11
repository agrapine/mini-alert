import type { Commander } from '../commander.ts'
import type { Replica } from '../replica.ts'
import type { GameView } from '../render/view.ts'

const MOVE_CURSOR = reticle('#3cde73')
const ATTACK_CURSOR = reticle('#d64545')

export function cursorFor(
  dragging: boolean,
  replica: Replica,
  player: Commander,
  view: GameView,
  clientX: number,
  clientY: number,
): string {
  if (dragging) return 'grabbing'
  const hovered = view.pickUnit(clientX, clientY)
  const selected = player.selected()
  if (hovered !== null) {
    const unit = replica.unit(hovered)
    if (unit && unit.ownerId === replica.playerId) return 'pointer'
    if (unit && player.commanding()) return ATTACK_CURSOR
  }
  const tile = selected.length > 0 ? view.pickTile(clientX, clientY) : null
  if (player.factorySelected()) {
    if (!tile) return 'default'
    return replica.isOpen(tile, []) ? MOVE_CURSOR : 'not-allowed'
  }
  if (selected.length === 0 || !tile) return 'default'
  const standing = replica.occupant(tile)
  if (standing && standing.ownerId !== replica.playerId) return ATTACK_CURSOR
  return replica.isOpen(tile, selected.map((unit) => unit.id)) ? MOVE_CURSOR : 'not-allowed'
}

function reticle(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="6.5" fill="none" stroke="${color}" stroke-width="2"/><path d="M16 3v6M16 23v6M3 16h6M23 16h6" stroke="${color}" stroke-width="2"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, crosshair`
}
