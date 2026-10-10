import type { MapPoint } from './protocol.ts'
import { valueNoise } from './noise.ts'
import { Terrain } from './tiles.ts'

const ISO = 0.5
const BLUR_RADIUS = 2
const BLUR_PASSES = 2
const NOISE_SCALE = 0.05
const NOISE_AMP = 0.2
const SAMPLE = 1

const SEGMENTS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[0, 3]],
  [[1, 0]],
  [[1, 3]],
  [[2, 1]],
  [[0, 3], [2, 1]],
  [[2, 0]],
  [[2, 3]],
  [[3, 2]],
  [[0, 2]],
  [[1, 0], [3, 2]],
  [[1, 2]],
  [[3, 1]],
  [[0, 1]],
  [[3, 0]],
  [],
]

const SADDLE_SOLID: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  5: [
    [0, 1],
    [2, 3],
  ],
  10: [
    [3, 0],
    [1, 2],
  ],
}

export type ShoreLoops = {
  coast: MapPoint[]
  holes: MapPoint[][]
}

export function smoothShore(
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  seed: number,
): ShoreLoops {
  const coastField = blurredField(terrain, width, height, (tile) => tile !== Terrain.Water)
  disturbShore(coastField, width + 1, height + 1, seed)
  const coastLoops = contour(coastField, width, height)
    .map((loop) => resample(loop, SAMPLE))
    .filter((loop) => loop.length >= 3 && Math.abs(signedArea(loop)) > 2)
  let coast: MapPoint[] = []
  let best = 0
  for (const loop of coastLoops) {
    const area = signedArea(loop)
    if (area > best) {
      best = area
      coast = loop
    }
  }

  const lakeField = blurredField(terrain, width, height, (tile) => tile !== Terrain.Lake)
  disturbShore(lakeField, width + 1, height + 1, seed + 17)
  const holes = contour(lakeField, width, height)
    .map((loop) => resample(loop, SAMPLE))
    .filter((loop) => signedArea(loop) < -2)

  return { coast, holes }
}

export function blockerTiles(
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  coast: readonly MapPoint[],
): MapPoint[] {
  if (coast.length < 3) return []
  const tiles: MapPoint[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = terrain[y * width + x]
      if (tile === Terrain.Lake && contains(coast, x + 0.5, y + 0.5)) tiles.push({ x, y })
      else if (tile === Terrain.Water && nearLand(terrain, width, height, x, y) && squareInside(coast, x, y))
        tiles.push({ x, y })
    }
  }
  return tiles
}

export function blockerHoles(
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  coast: readonly MapPoint[],
  seed = 0,
): MapPoint[][] {
  const blocked = new Uint8Array(width * height)
  for (const tile of blockerTiles(terrain, width, height, coast)) blocked[tile.y * width + tile.x] = 1
  const cols = width + 1
  const rows = height + 1
  const field: Float32Array<ArrayBufferLike> = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) field[y * cols + x] = cornerBlocked(blocked, width, height, x, y) ? 1 : 0
  }
  const holes: MapPoint[][] = []
  for (const loop of contour(field, width, height)) {
    let rounded = resample(loop, 0.5)
    rounded = expand(wobble(chaikin(chaikin(rounded)), seed), 0.28)
    if (rounded.length < 3 || Math.abs(signedArea(rounded)) < 1.5) continue
    const fitted = rounded.map((point) => pullInside(point, coast, blocked, width, height))
    if (!fitted.every((point) => contains(coast, point.x, point.y))) continue
    if (signedArea(fitted) > 0) fitted.reverse()
    if (signedArea(fitted) < -0.5) holes.push(fitted)
  }
  return holes
}

function wobble(loop: readonly MapPoint[], seed: number): MapPoint[] {
  return loop.map((point, index) => {
    const prev = loop[(index - 1 + loop.length) % loop.length]
    const next = loop[(index + 1) % loop.length]
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    const n = (valueNoise(point.x, point.y, seed, 0.18) - 0.5) * 0.45
    return { x: point.x - dy * n, y: point.y + dx * n }
  })
}

function expand(loop: readonly MapPoint[], amount: number): MapPoint[] {
  const sign = signedArea(loop) >= 0 ? 1 : -1
  return loop.map((point, index) => {
    const prev = loop[(index - 1 + loop.length) % loop.length]
    const next = loop[(index + 1) % loop.length]
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    return { x: point.x + dy * amount * sign, y: point.y - dx * amount * sign }
  })
}

function chaikin(loop: readonly MapPoint[]): MapPoint[] {
  const out: MapPoint[] = []
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
    out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
  }
  return out
}

function cornerBlocked(blocked: Uint8Array, width: number, height: number, cx: number, cy: number): boolean {
  const tiles = [
    [cx - 1, cy - 1],
    [cx, cy - 1],
    [cx - 1, cy],
    [cx, cy],
  ]
  for (const [tx, ty] of tiles) {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
    if (blocked[ty * width + tx]) return true
  }
  return false
}

function pullInside(
  point: MapPoint,
  coast: readonly MapPoint[],
  blocked: Uint8Array,
  width: number,
  height: number,
): MapPoint {
  if (contains(coast, point.x, point.y)) return point
  let bestX = -1
  let bestY = -1
  let best = Infinity
  const x0 = Math.max(0, Math.floor(point.x) - 3)
  const x1 = Math.min(width - 1, Math.floor(point.x) + 3)
  const y0 = Math.max(0, Math.floor(point.y) - 3)
  const y1 = Math.min(height - 1, Math.floor(point.y) + 3)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!blocked[y * width + x]) continue
      const dist = (x + 0.5 - point.x) ** 2 + (y + 0.5 - point.y) ** 2
      if (dist >= best) continue
      best = dist
      bestX = x
      bestY = y
    }
  }
  if (bestX < 0) return point
  const towardX = bestX + 0.5
  const towardY = bestY + 0.5
  for (let step = 1; step <= 20; step++) {
    const t = step / 20
    const next = { x: point.x + (towardX - point.x) * t, y: point.y + (towardY - point.y) * t }
    if (contains(coast, next.x, next.y)) return next
  }
  return { x: towardX, y: towardY }
}

function nearLand(
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const tile = terrain[ny * width + nx]
      if (tile !== Terrain.Water && tile !== Terrain.Lake) return true
    }
  }
  return false
}

function squareInside(loop: readonly MapPoint[], x: number, y: number): boolean {
  return (
    contains(loop, x + 0.08, y + 0.08) &&
    contains(loop, x + 0.92, y + 0.08) &&
    contains(loop, x + 0.08, y + 0.92) &&
    contains(loop, x + 0.92, y + 0.92)
  )
}

function contains(loop: readonly MapPoint[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]
    const b = loop[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
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

function blurredField(
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  solid: (tile: number) => boolean,
): Float32Array {
  const cols = width + 1
  const rows = height + 1
  let field: Float32Array<ArrayBufferLike> = new Float32Array(cols * rows)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) field[y * cols + x] = cornerValue(terrain, width, height, x, y, solid)
  }
  for (let pass = 0; pass < BLUR_PASSES; pass++) field = boxBlur(field, cols, rows, BLUR_RADIUS)
  return field
}

function cornerValue(
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  cx: number,
  cy: number,
  solid: (tile: number) => boolean,
): number {
  let sum = 0
  let count = 0
  const tiles = [
    [cx - 1, cy - 1],
    [cx, cy - 1],
    [cx - 1, cy],
    [cx, cy],
  ]
  for (const [tx, ty] of tiles) {
    if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
    sum += solid(terrain[ty * width + tx]) ? 1 : 0
    count++
  }
  return count === 0 ? 0 : sum / count
}

function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const span = radius * 2 + 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k))
        sum += src[y * width + sx]
      }
      tmp[y * width + x] = sum / span
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k))
        sum += tmp[sy * width + x]
      }
      out[y * width + x] = sum / span
    }
  }
  return out
}

function disturbShore(field: Float32Array, width: number, height: number, seed: number) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const value = field[i]
      const band = 4 * value * (1 - value)
      if (band <= 0) continue
      field[i] = value + (valueNoise(x, y, seed, NOISE_SCALE) - 0.5) * NOISE_AMP * band
    }
  }
}

function contour(field: Float32Array, width: number, height: number): MapPoint[][] {
  const cols = width + 1
  const segments: { a: MapPoint; b: MapPoint }[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const values = [
        field[y * cols + x],
        field[y * cols + x + 1],
        field[(y + 1) * cols + x + 1],
        field[(y + 1) * cols + x],
      ]
      let mask = 0
      if (values[0] >= ISO) mask |= 1
      if (values[1] >= ISO) mask |= 2
      if (values[2] >= ISO) mask |= 4
      if (values[3] >= ISO) mask |= 8
      if (mask === 0 || mask === 15) continue
      const center = (values[0] + values[1] + values[2] + values[3]) / 4
      const pairs =
        (mask === 5 || mask === 10) && center >= ISO ? SADDLE_SOLID[mask] : SEGMENTS[mask]
      for (const [from, to] of pairs) {
        const a = edgePoint(x, y, from, values)
        const b = edgePoint(x, y, to, values)
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-4) continue
        segments.push({ a, b })
      }
    }
  }
  return stitch(segments)
}

function edgePoint(x: number, y: number, edge: number, values: readonly number[]): MapPoint {
  if (edge === 0) return lerp(x, y, values[0], x + 1, y, values[1])
  if (edge === 1) return lerp(x + 1, y, values[1], x + 1, y + 1, values[2])
  if (edge === 2) return lerp(x, y + 1, values[3], x + 1, y + 1, values[2])
  return lerp(x, y, values[0], x, y + 1, values[3])
}

function lerp(x0: number, y0: number, v0: number, x1: number, y1: number, v1: number): MapPoint {
  const span = v1 - v0
  const t = Math.abs(span) < 1e-6 ? 0.5 : (ISO - v0) / span
  const u = Math.min(1, Math.max(0, t))
  return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u }
}

function stitch(segments: readonly { a: MapPoint; b: MapPoint }[]): MapPoint[][] {
  const key = (point: MapPoint) => `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`
  const next = new Map<string, { a: MapPoint; b: MapPoint }[]>()
  for (const segment of segments) {
    const list = next.get(key(segment.a))
    if (list) list.push(segment)
    else next.set(key(segment.a), [segment])
  }
  const used = new Set<{ a: MapPoint; b: MapPoint }>()
  const loops: MapPoint[][] = []
  for (const segment of segments) {
    if (used.has(segment)) continue
    const loop: MapPoint[] = []
    let current: { a: MapPoint; b: MapPoint } | undefined = segment
    let guard = segments.length + 2
    while (current && !used.has(current) && guard-- > 0) {
      used.add(current)
      loop.push(current.a)
      const options = next.get(key(current.b))
      current = options?.find((item) => !used.has(item))
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

function resample(loop: readonly MapPoint[], spacing: number): MapPoint[] {
  if (loop.length < 3) return [...loop]
  const out: MapPoint[] = [loop[0]]
  let prev = loop[0]
  let carry = 0
  for (let i = 1; i <= loop.length; i++) {
    const next = loop[i % loop.length]
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    let dist = Math.hypot(dx, dy)
    if (dist < 1e-6) continue
    while (carry + dist >= spacing) {
      const t = (spacing - carry) / dist
      const point = { x: prev.x + dx * t, y: prev.y + dy * t }
      out.push(point)
      dx = next.x - point.x
      dy = next.y - point.y
      dist = Math.hypot(dx, dy)
      prev = point
      carry = 0
    }
    carry += dist
    prev = next
  }
  if (out.length >= 2) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.hypot(first.x - last.x, first.y - last.y) < spacing * 0.45) out.pop()
  }
  return out.length >= 3 ? out : [...loop]
}
