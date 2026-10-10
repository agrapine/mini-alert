const PLAYER_COLORS = [0x2f7edb, 0xd64545]

export const STARTING_CREDITS = 10_000

export class Player {
  readonly id: number
  readonly color: number
  readonly unitIds: number[] = []
  credits = STARTING_CREDITS

  constructor(id: number) {
    this.id = id
    this.color = PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length]
  }

  owns(unitId: number): boolean {
    return this.unitIds.includes(unitId)
  }

  addUnit(unitId: number) {
    this.unitIds.push(unitId)
  }
}
