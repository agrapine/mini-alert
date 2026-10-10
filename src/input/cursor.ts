import type { Commander } from '../game/commander.ts'
import type { World } from '../game/world.ts'
import type { GameView } from '../render/view.ts'

export function cursorFor(
  dragging: boolean,
  world: World,
  player: Commander,
  view: GameView,
  clientX: number,
  clientY: number,
): string {
  if (dragging) return 'grabbing'
  if (view.pickUnit(clientX, clientY) !== null) return 'pointer'
  const selected = player.selected()
  const tile = selected ? view.pickTile(clientX, clientY) : null
  if (!selected || !tile) return 'default'
  return world.pathfinder.isWalkable(tile.x, tile.y, selected.id) ? 'crosshair' : 'not-allowed'
}
