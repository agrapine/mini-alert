import { SHIFT_ZERO } from '../shared/shift.ts'
import { Terrain, type TileCoord } from '../shared/tiles.ts'

export class World {
  readonly width: number
  readonly height: number
  private readonly terrain: Uint8Array
  private readonly shifts: Uint8Array

  constructor(width: number, height: number, obstacles: readonly TileCoord[] = []) {
    this.width = width
    this.height = height
    this.terrain = new Uint8Array(width * height)
    this.shifts = new Uint8Array(width * height)
    this.shifts.fill(SHIFT_ZERO)
    for (const tile of obstacles) {
      if (!this.inBounds(tile.x, tile.y)) continue
      this.terrain[tile.y * width + tile.x] = Terrain.Obstacle
    }
  }

  static fromTiles(width: number, height: number, tiles: Uint8Array, shifts?: Uint8Array): World {
    if (tiles.length !== width * height) throw new Error('terrain size')
    const world = new World(width, height)
    world.terrain.set(tiles)
    if (shifts && shifts.length === tiles.length) world.shifts.set(shifts)
    return world
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  terrainAt(x: number, y: number): Terrain {
    if (!this.inBounds(x, y)) throw new Error(`tile out of bounds: ${x},${y}`)
    return this.terrain[y * this.width + x] as Terrain
  }

  setTerrain(x: number, y: number, terrain: Terrain) {
    if (!this.inBounds(x, y)) return
    this.terrain[y * this.width + x] = terrain
  }

  shiftAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return SHIFT_ZERO
    return this.shifts[y * this.width + x]
  }
}
