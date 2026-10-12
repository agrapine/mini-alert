import type { MapPoint } from './protocol.ts'
import { tileVertex } from './shift.ts'
import { Terrain } from './tiles.ts'

const SIDES = [
  { dx: 1, dy: 0, x0: 1, y0: 0, x1: 1, y1: 1 },
  { dx: -1, dy: 0, x0: 0, y0: 1, x1: 0, y1: 0 },
  { dx: 0, dy: -1, x0: 0, y0: 0, x1: 1, y1: 0 },
  { dx: 0, dy: 1, x0: 1, y0: 1, x1: 0, y1: 1 },
]

export type LayerLoop = {
  points: MapPoint[]
  bank: boolean[]
}

export function landLoops(
  terrain: ArrayLike<number>,
  known: ArrayLike<number>,
  shifts: ArrayLike<number>,
  width: number,
  height: number,
): LayerLoop[] {
  return layerContour(terrain, known, shifts, width, height, (tile) => tile !== Terrain.Water && tile !== Terrain.Lake)
}

export function forestLoops(
  terrain: ArrayLike<number>,
  known: ArrayLike<number>,
  shifts: ArrayLike<number>,
  width: number,
  height: number,
): LayerLoop[] {
  return layerContour(terrain, known, shifts, width, height, (tile) => tile === Terrain.Forest || tile === Terrain.Tree)
}

export function roadLines(
  terrain: ArrayLike<number>,
  known: ArrayLike<number>,
  shifts: ArrayLike<number>,
  width: number,
  height: number,
): MapPoint[][] {
  const road = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const index = y * width + x
    return known[index] === 1 && terrain[index] === Terrain.Road
  }
  const vertex = (x: number, y: number) => tileVertex(x, y, shifts[y * width + x])
  const seen = new Uint8Array(width * height)
  const lines: MapPoint[][] = []
  const consider = (x: number, y: number) => {
    if (!road(x, y) || seen[y * width + x]) return
    const degree = neighbors(x, y, road).length
    if (degree === 2) return
    const line = walkRoad(x, y, road, vertex, seen, width)
    if (line.length >= 2) lines.push(line)
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) consider(x, y)
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!road(x, y) || seen[y * width + x]) continue
      const line = walkRoad(x, y, road, vertex, seen, width)
      if (line.length >= 2) lines.push(line)
    }
  }
  return lines
}

export function bankRuns(loop: LayerLoop): { points: MapPoint[]; closed: boolean }[] {
  const count = loop.points.length
  if (count < 2 || loop.bank.length !== count) return []
  if (loop.bank.every(Boolean)) return [{ points: loop.points, closed: true }]
  const runs: MapPoint[][] = []
  let index = 0
  while (index < count) {
    if (!loop.bank[index]) {
      index += 1
      continue
    }
    const points = [loop.points[index]]
    while (index < count && loop.bank[index]) {
      points.push(loop.points[(index + 1) % count])
      index += 1
    }
    if (points.length >= 2) runs.push(points)
  }
  if (loop.bank[0] && loop.bank[count - 1] && runs.length >= 2) {
    const last = runs[runs.length - 1]
    const first = runs[0]
    runs[0] = last.slice(0, -1).concat(first)
    runs.pop()
  }
  return runs.map((points) => ({ points, closed: false }))
}

function layerContour(
  terrain: ArrayLike<number>,
  known: ArrayLike<number>,
  shifts: ArrayLike<number>,
  width: number,
  height: number,
  inside: (tile: number) => boolean,
): LayerLoop[] {
  const solid = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const index = y * width + x
    return known[index] === 1 && inside(terrain[index])
  }
  const edges: Edge[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue
      for (const side of SIDES) {
        const nx = x + side.dx
        const ny = y + side.dy
        if (solid(nx, ny)) continue
        const bank = nx >= 0 && ny >= 0 && nx < width && ny < height && known[ny * width + nx] === 1
        const sx = x + side.x0
        const sy = y + side.y0
        const ex = x + side.x1
        const ey = y + side.y1
        edges.push({
          sx,
          sy,
          ex,
          ey,
          bank,
          used: false,
          points: bank ? [curvePoint(x, y, nx, ny, shifts, width)] : [{ x: sx, y: sy }, { x: ex, y: ey }],
        })
      }
    }
  }
  return trace(edges).filter((loop) => loop.points.length >= 3 && Math.abs(signedArea(loop.points)) > 0.2)
}

type Edge = {
  sx: number
  sy: number
  ex: number
  ey: number
  bank: boolean
  used: boolean
  points: MapPoint[]
}

function trace(edges: Edge[]): LayerLoop[] {
  const at = new Map<string, Edge[]>()
  for (const edge of edges) {
    const key = `${edge.sx},${edge.sy}`
    const list = at.get(key)
    if (list) list.push(edge)
    else at.set(key, [edge])
  }
  const loops: LayerLoop[] = []
  for (const start of edges) {
    if (start.used) continue
    const points: MapPoint[] = []
    const bank: boolean[] = []
    let prevBank = false
    let current: Edge | undefined = start
    let closed = false
    let guard = edges.length + 2
    while (current && !current.used && guard > 0) {
      guard -= 1
      current.used = true
      for (const point of current.points) {
        if (points.length > 0 && near(points[points.length - 1], point)) continue
        if (points.length > 0) bank.push(prevBank && current.bank)
        points.push(point)
        prevBank = current.bank
      }
      const list: Edge[] = at.get(`${current.ex},${current.ey}`) ?? []
      const unused: Edge | undefined = list.find((edge) => !edge.used)
      const next: Edge | undefined = unused ?? (list.includes(start) ? start : undefined)
      if (!next) break
      if (next === start) {
        closed = true
        break
      }
      current = next
    }
    if (!closed || points.length < 3) continue
    if (near(points[points.length - 1], points[0])) points.pop()
    else bank.push(prevBank && start.bank)
    if (points.length >= 3 && bank.length === points.length) loops.push({ points, bank })
  }
  return loops
}

function curvePoint(
  x: number,
  y: number,
  nx: number,
  ny: number,
  shifts: ArrayLike<number>,
  width: number,
): MapPoint {
  const a = tileVertex(x, y, shifts[y * width + x])
  const b = tileVertex(nx, ny, shifts[ny * width + nx])
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function walkRoad(
  sx: number,
  sy: number,
  road: (x: number, y: number) => boolean,
  vertex: (x: number, y: number) => MapPoint,
  seen: Uint8Array,
  width: number,
): MapPoint[] {
  const line = [vertex(sx, sy)]
  seen[sy * width + sx] = 1
  let x = sx
  let y = sy
  let prevX = -1
  let prevY = -1
  for (;;) {
    const next = neighbors(x, y, road).filter(([nx, ny]) => nx !== prevX || ny !== prevY)
    if (next.length !== 1) break
    const step = next[0]
    if (seen[step[1] * width + step[0]] && (step[0] !== sx || step[1] !== sy)) break
    line.push(vertex(step[0], step[1]))
    seen[step[1] * width + step[0]] = 1
    prevX = x
    prevY = y
    x = step[0]
    y = step[1]
    if (x === sx && y === sy) break
  }
  return line
}

function neighbors(x: number, y: number, road: (x: number, y: number) => boolean): [number, number][] {
  const found: [number, number][] = []
  if (road(x + 1, y)) found.push([x + 1, y])
  if (road(x - 1, y)) found.push([x - 1, y])
  if (road(x, y + 1)) found.push([x, y + 1])
  if (road(x, y - 1)) found.push([x, y - 1])
  return found
}

function near(a: MapPoint, b: MapPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < 1e-4
}

export function signedArea(loop: readonly MapPoint[]): number {
  let area = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

export function loopContains(loop: readonly MapPoint[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]
    const b = loop[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
