import { playerColor } from '../shared/players.ts'

export const STARTING_CREDITS = 10_000
export const CREDIT_PER_POPULATION = 5
export const CREDIT_CAP_PER_POPULATION = 500
export const INCOME_SECONDS = 5

export function creditCap(population: number): number {
  return STARTING_CREDITS + CREDIT_CAP_PER_POPULATION * Math.max(0, population)
}

export class Player {
  readonly id: number
  readonly color: number
  readonly unitIds: number[] = []
  credits = STARTING_CREDITS

  constructor(id: number, color = playerColor(id)) {
    this.id = id
    this.color = color
  }

  owns(unitId: number): boolean {
    return this.unitIds.includes(unitId)
  }

  addUnit(unitId: number) {
    this.unitIds.push(unitId)
  }
}
