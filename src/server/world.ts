import { Terrain, type TileCoord } from '../shared/tiles.ts'

export class World {
  readonly width: number
  readonly height: number
  private readonly terrain: Uint8Array

  constructor(width: number, height: number, obstacles: readonly TileCoord[] = []) {
    this.width = width
    this.height = height
    this.terrain = new Uint8Array(width * height)
    for (const tile of obstacles) {
      if (!this.inBounds(tile.x, tile.y)) continue
      this.terrain[tile.y * width + tile.x] = Terrain.Obstacle
    }
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  terrainAt(x: number, y: number): Terrain {
    if (!this.inBounds(x, y)) throw new Error(`tile out of bounds: ${x},${y}`)
    return this.terrain[y * this.width + x] as Terrain
  }
}
