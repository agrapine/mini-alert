import type { Commander } from '../commander.ts'
import type { Replica } from '../replica.ts'
import type { GameView } from '../render/view.ts'

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
  if (hovered !== null) {
    const unit = replica.unit(hovered)
    if (unit && unit.ownerId === replica.playerId) return 'pointer'
  }
  const selected = player.selected()
  const tile = selected.length > 0 ? view.pickTile(clientX, clientY) : null
  if (selected.length === 0 || !tile) return 'default'
  return replica.isOpen(tile, selected.map((unit) => unit.id)) ? 'crosshair' : 'not-allowed'
}
