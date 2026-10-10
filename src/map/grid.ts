export type Terrain = 'clear' | 'obstacle'

export type TileCoord = { x: number; y: number }

export type Cell = {
  terrain: Terrain
  occupantId: number | null
}

export const MAP_SIZE = 24

export class GridMap {
  readonly width: number
  readonly height: number
  private readonly cells: Cell[]

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.cells = Array.from({ length: width * height }, () => ({
      terrain: 'clear' as Terrain,
      occupantId: null,
    }))
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  get(x: number, y: number): Cell {
    if (!this.inBounds(x, y)) {
      throw new Error(`tile out of bounds: ${x},${y}`)
    }
    return this.cells[y * this.width + x]
  }

  setTerrain(x: number, y: number, terrain: Terrain) {
    this.get(x, y).terrain = terrain
  }

  setOccupant(x: number, y: number, occupantId: number | null) {
    this.get(x, y).occupantId = occupantId
  }

  isWalkable(x: number, y: number, ignoreUnitId: number): boolean {
    if (!this.inBounds(x, y)) return false
    const cell = this.cells[y * this.width + x]
    if (cell.terrain !== 'clear') return false
    return cell.occupantId === null || cell.occupantId === ignoreUnitId
  }
}

export function tileCenter(tile: TileCoord): { x: number; z: number } {
  return { x: tile.x + 0.5, z: tile.y + 0.5 }
}

export function createSkirmishMap(): GridMap {
  const map = new GridMap(MAP_SIZE, MAP_SIZE)

  for (let y = 3; y <= 20; y++) {
    if (y === 8 || y === 16) continue
    map.setTerrain(11, y, 'obstacle')
  }

  const rocks: TileCoord[] = [
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 6, y: 6 },
    { x: 2, y: 18 },
    { x: 3, y: 18 },
    { x: 16, y: 4 },
    { x: 17, y: 4 },
    { x: 18, y: 5 },
    { x: 20, y: 18 },
    { x: 19, y: 19 },
    { x: 8, y: 21 },
    { x: 15, y: 15 },
  ]
  for (const rock of rocks) map.setTerrain(rock.x, rock.y, 'obstacle')

  return map
}
