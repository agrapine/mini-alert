import type { Game } from './game.ts'

const INTERVAL = 2

export class AiPlayer {
  private elapsed = 0

  constructor(
    private readonly playerId: number,
    private readonly game: Game,
  ) {}

  update(dt: number) {
    this.elapsed += dt
    if (this.elapsed < INTERVAL) return
    this.elapsed = 0
    const player = this.game.player(this.playerId)
    if (!player || player.unitIds.length === 0) return
    const unitId = player.unitIds[Math.floor(Math.random() * player.unitIds.length)]
    const tile = {
      x: Math.floor(Math.random() * this.game.world.width),
      y: Math.floor(Math.random() * this.game.world.height),
    }
    this.game.orderMove(this.playerId, unitId, tile)
  }
}
