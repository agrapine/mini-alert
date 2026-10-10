import type { MapPoint } from '../../shared/protocol.ts'
import { Terrain } from '../../shared/tiles.ts'
import { mulberry32, valueNoise } from './noise.ts'

function rnd<T>(...arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const size = rnd(64, 128, 256, 512);
//const size = 24;
// const size = rnd(64, 96);
export const ISLAND_WIDTH = size;
export const ISLAND_HEIGHT = size;
export const MAX_HOPS = 4

const SITES = 42
const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

export type Island = {
  seed: number
  width: number
  height: number
  terrain: Uint8Array
  coast: MapPoint[]
  holes: MapPoint[][]
  roads: MapPoint[][]
  towns: MapPoint[]
  borders: [number, number][]
  roadEdges: [number, number][]
}

export function generateIsland(seed: number): Island {
  const width = ISLAND_WIDTH
  const height = ISLAND_HEIGHT
  const rng = mulberry32(seed)
  const region = new Int16Array(width * height)
  const sites = Array.from({ length: SITES }, () => ({
    x: rng() * width,
    y: rng() * height,
  }))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let best = 0
      let bestDist = Infinity
      for (let i = 0; i < sites.length; i++) {
        const dx = x + 0.5 - sites[i].x
        const dy = y + 0.5 - sites[i].y
        const dist = dx * dx + dy * dy
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      }
      region[y * width + x] = best
    }
  }

  const dropped = new Uint8Array(SITES)
  for (let x = 0; x < width; x++) {
    dropped[region[x]] = 1
    dropped[region[(height - 1) * width + x]] = 1
  }
  for (let y = 0; y < height; y++) {
    dropped[region[y * width]] = 1
    dropped[region[y * width + width - 1]] = 1
  }
  for (let i = 0; i < region.length; i++) {
    if (dropped[region[i]]) region[i] = -1
  }

  keepLargest(region, width, height)
  relaxBorders(region, width, height)
  keepLargest(region, width, height)

  const terrain = new Uint8Array(width * height)
  for (let i = 0; i < region.length; i++) {
    terrain[i] = region[i] < 0 ? Terrain.Water : Terrain.Land
  }

  const members = new Map<number, number[]>()
  for (let i = 0; i < region.length; i++) {
    if (region[i] < 0) continue
    const list = members.get(region[i])
    if (list) list.push(i)
    else members.set(region[i], [i])
  }
  const ids = [...members.keys()]
  if (ids.length < 2) throw new Error('island collapsed')

  const towns: MapPoint[] = ids.map((id) => {
    const cells = members.get(id) ?? []
    let sx = 0
    let sy = 0
    for (const cell of cells) {
      sx += cell % width
      sy += Math.floor(cell / width)
    }
    const ax = sx / cells.length
    const ay = sy / cells.length
    let best = cells[0]
    let bestDist = Infinity
    for (const cell of cells) {
      const dx = (cell % width) + 0.5 - ax
      const dy = Math.floor(cell / width) + 0.5 - ay
      const dist = dx * dx + dy * dy
      if (dist < bestDist) {
        bestDist = dist
        best = cell
      }
    }
    return { x: (best % width) + 0.5, y: Math.floor(best / width) + 0.5 }
  })

  const borders = countyBorders(region, width, height, ids)
  const adj = bordersToAdj(borders, ids.length)
  let roadEdges = connectCounties(adj, towns)
  roadEdges = addShortcuts(roadEdges, borders, ids.length)
  const drawn = roadEdges.map((edge) => ({
    edge,
    line: roadPolyline(towns[edge[0]], towns[edge[1]], rng, terrain, width, height),
  }))
  const kept = pruneRoads(drawn, borders, ids.length)
  roadEdges = kept.map((item) => item.edge)
  const roads = kept.map((item) => item.line)

  paintRoads(terrain, width, height, roads)
  const distance = roadDistance(terrain, width, height)
  paintBiomes(terrain, width, height, distance, seed)
  for (const town of towns) {
    terrain[Math.floor(town.y) * width + Math.floor(town.x)] = Terrain.Town
  }
  fillWaterCracks(terrain, width, height)
  const { coast, holes } = traceShore(terrain, width, height)

  return {
    seed,
    width,
    height,
    terrain,
    coast,
    holes,
    roads,
    towns,
    borders,
    roadEdges,
  }
}

export function countyHops(edges: readonly [number, number][], count: number, from: number, to: number): number {
  if (from === to) return 0
  const adj: number[][] = Array.from({ length: count }, () => [])
  for (const [a, b] of edges) {
    adj[a].push(b)
    adj[b].push(a)
  }
  const dist = new Int16Array(count).fill(-1)
  const queue = [from]
  dist[from] = 0
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]
    if (current === to) return dist[current]
    for (const next of adj[current]) {
      if (dist[next] >= 0) continue
      dist[next] = dist[current] + 1
      queue.push(next)
    }
  }
  return Infinity
}

export function fillWaterCracks(terrain: Uint8Array, width: number, height: number) {
  const next = new Uint8Array(terrain.length)
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    next.set(terrain)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (terrain[i] !== Terrain.Water) continue
        const horizontal = isLand(terrain, width, height, x - 1, y) && isLand(terrain, width, height, x + 1, y)
        const vertical = isLand(terrain, width, height, x, y - 1) && isLand(terrain, width, height, x, y + 1)
        if (!horizontal && !vertical) continue
        next[i] = Terrain.Land
        changed = true
      }
    }
    terrain.set(next)
    if (!changed) break
  }
}

function keepLargest(region: Int16Array, width: number, height: number) {
  const seen = new Uint8Array(region.length)
  let best = 0
  let bestCells: number[] = []
  for (let i = 0; i < region.length; i++) {
    if (region[i] < 0 || seen[i]) continue
    const cells: number[] = []
    const stack = [i]
    seen[i] = 1
    while (stack.length > 0) {
      const cell = stack.pop() ?? 0
      cells.push(cell)
      const x = cell % width
      const y = Math.floor(cell / width)
      for (const dir of DIRS) {
        const nx = x + dir.x
        const ny = y + dir.y
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const next = ny * width + nx
        if (seen[next] || region[next] < 0) continue
        seen[next] = 1
        stack.push(next)
      }
    }
    if (cells.length > best) {
      best = cells.length
      bestCells = cells
    }
  }
  const keep = new Uint8Array(region.length)
  for (const cell of bestCells) keep[cell] = 1
  for (let i = 0; i < region.length; i++) {
    if (!keep[i]) region[i] = -1
  }
}

function relaxBorders(region: Int16Array, width: number, height: number) {
  const next = new Int16Array(region.length)
  for (let pass = 0; pass < 3; pass++) {
    next.set(region)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        if (region[i] < 0 || touchesWater(region, width, height, x, y)) continue
        const counts = new Map<number, number>()
        for (const dir of DIRS) {
          const id = region[(y + dir.y) * width + (x + dir.x)]
          if (id < 0) continue
          counts.set(id, (counts.get(id) ?? 0) + 1)
        }
        let best = region[i]
        let bestCount = counts.get(best) ?? 0
        for (const [id, count] of counts) {
          if (count > bestCount) {
            best = id
            bestCount = count
          }
        }
        next[i] = best
      }
    }
    region.set(next)
  }
}

function touchesWater(region: Int16Array, width: number, height: number, x: number, y: number): boolean {
  for (const dir of DIRS) {
    const nx = x + dir.x
    const ny = y + dir.y
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return true
    if (region[ny * width + nx] < 0) return true
  }
  return false
}

function countyBorders(
  region: Int16Array,
  width: number,
  height: number,
  ids: readonly number[],
): [number, number][] {
  const index = new Map(ids.map((id, i) => [id, i]))
  const pairs = new Set<string>()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = region[y * width + x]
      if (id < 0) continue
      const a = index.get(id)
      if (a === undefined) continue
      for (const dir of DIRS) {
        const nx = x + dir.x
        const ny = y + dir.y
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const other = region[ny * width + nx]
        if (other < 0 || other === id) continue
        const b = index.get(other)
        if (b === undefined) continue
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        pairs.add(`${lo},${hi}`)
      }
    }
  }
  return [...pairs].map((pair) => pair.split(',').map(Number) as [number, number])
}

function bordersToAdj(borders: readonly [number, number][], count: number): number[][] {
  const adj: number[][] = Array.from({ length: count }, () => [])
  for (const [a, b] of borders) {
    adj[a].push(b)
    adj[b].push(a)
  }
  return adj
}

function connectCounties(adj: readonly number[][], towns: readonly MapPoint[]): [number, number][] {
  const count = towns.length
  const seen = new Uint8Array(count)
  const edges: [number, number][] = []
  const dfs = (id: number) => {
    seen[id] = 1
    for (const next of adj[id]) {
      if (seen[next]) continue
      edges.push([id, next])
      dfs(next)
    }
  }
  for (let i = 0; i < count; i++) if (!seen[i]) dfs(i)

  let guard = count
  while (componentCount(edges, count) > 1 && guard-- > 0) {
    let best = -1
    let pair: [number, number] = [0, 1]
    const component = componentIds(edges, count)
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        if (component[a] === component[b]) continue
        const dx = towns[a].x - towns[b].x
        const dy = towns[a].y - towns[b].y
        const dist = dx * dx + dy * dy
        if (best < 0 || dist < best) {
          best = dist
          pair = [a, b]
        }
      }
    }
    edges.push(pair)
  }
  return edges
}

function addShortcuts(
  edges: [number, number][],
  borders: readonly [number, number][],
  count: number,
): [number, number][] {
  const linked = new Set(edges.map(([a, b]) => key(a, b)))
  let guard = borders.length
  while (guard-- > 0) {
    let best = 0
    let pair: [number, number] | null = null
    for (const [a, b] of borders) {
      if (linked.has(key(a, b))) continue
      const dist = countyHops(edges, count, a, b)
      if (dist > MAX_HOPS && dist > best) {
        best = dist
        pair = [a, b]
      }
    }
    if (!pair) break
    edges.push(pair)
    linked.add(key(pair[0], pair[1]))
  }
  return edges
}

function pruneRoads(
  drawn: readonly { edge: [number, number]; line: MapPoint[] }[],
  borders: readonly [number, number][],
  count: number,
): { edge: [number, number]; line: MapPoint[] }[] {
  let current = [...drawn]
  let changed = true
  while (changed) {
    changed = false
    const order = current
      .map((item, index) => ({ index, length: polylineLength(item.line) }))
      .sort((a, b) => a.length - b.length)
    for (const { index } of order) {
      const next = current.filter((_, i) => i !== index)
      if (!bordersWithin(next.map((item) => item.edge), borders, count)) continue
      current = next
      changed = true
      break
    }
  }
  return current
}

function bordersWithin(
  edges: readonly [number, number][],
  borders: readonly [number, number][],
  count: number,
): boolean {
  for (const [a, b] of borders) {
    if (countyHops(edges, count, a, b) > MAX_HOPS) return false
  }
  return componentCount(edges, count) === 1
}

function roadPolyline(
  from: MapPoint,
  to: MapPoint,
  rng: () => number,
  terrain: Uint8Array,
  width: number,
  height: number,
): MapPoint[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len
  const py = dx / len
  const bend = Math.min(6, len * 0.28)
  const line = [
    from,
    {
      x: from.x + dx * 0.33 + px * (rng() * 2 - 1) * bend,
      y: from.y + dy * 0.33 + py * (rng() * 2 - 1) * bend,
    },
    {
      x: from.x + dx * 0.66 + px * (rng() * 2 - 1) * bend,
      y: from.y + dy * 0.66 + py * (rng() * 2 - 1) * bend,
    },
    to,
  ]
  if (samplesStayOnLand(line, terrain, width, height)) return line
  const path = landPath(
    terrain,
    width,
    height,
    { x: Math.floor(from.x), y: Math.floor(from.y) },
    { x: Math.floor(to.x), y: Math.floor(to.y) },
  )
  return path.map((tile) => ({ x: tile.x + 0.5, y: tile.y + 0.5 }))
}

function samplesStayOnLand(
  line: readonly MapPoint[],
  terrain: Uint8Array,
  width: number,
  height: number,
): boolean {
  for (const point of sampleLine(line, 0.45)) {
    const x = Math.floor(point.x)
    const y = Math.floor(point.y)
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    if (terrain[y * width + x] === Terrain.Water) return false
  }
  return true
}

function sampleLine(line: readonly MapPoint[], step: number): MapPoint[] {
  const points: MapPoint[] = []
  for (let i = 0; i < line.length - 1; i++) {
    const from = line[i]
    const to = line[i + 1]
    const len = Math.hypot(to.x - from.x, to.y - from.y)
    const count = Math.max(1, Math.ceil(len / step))
    for (let s = 0; s <= count; s++) {
      const t = s / count
      points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
    }
  }
  return points
}

function landPath(
  terrain: Uint8Array,
  width: number,
  height: number,
  start: { x: number; y: number },
  goal: { x: number; y: number },
): { x: number; y: number }[] {
  const startKey = start.y * width + start.x
  const goalKey = goal.y * width + goal.x
  const prev = new Int32Array(width * height).fill(-1)
  const seen = new Uint8Array(width * height)
  const queue = [startKey]
  seen[startKey] = 1
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]
    if (cell === goalKey) break
    const x = cell % width
    const y = Math.floor(cell / width)
    for (const dir of DIRS) {
      const nx = x + dir.x
      const ny = y + dir.y
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = ny * width + nx
      if (seen[next] || terrain[next] === Terrain.Water) continue
      seen[next] = 1
      prev[next] = cell
      queue.push(next)
    }
  }
  if (!seen[goalKey]) return [start, goal]
  const tiles = []
  let cell = goalKey
  while (cell >= 0) {
    tiles.push({ x: cell % width, y: Math.floor(cell / width) })
    if (cell === startKey) break
    cell = prev[cell]
  }
  tiles.reverse()
  return tiles
}

function paintRoads(terrain: Uint8Array, width: number, height: number, roads: readonly MapPoint[][]) {
  for (const road of roads) {
    for (const point of sampleLine(road, 0.4)) {
      const x = Math.floor(point.x)
      const y = Math.floor(point.y)
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const i = y * width + x
      if (terrain[i] === Terrain.Water) continue
      terrain[i] = Terrain.Road
    }
  }
}

function roadDistance(terrain: Uint8Array, width: number, height: number): Int16Array {
  const dist = new Int16Array(terrain.length).fill(-1)
  const queue: number[] = []
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] !== Terrain.Road && terrain[i] !== Terrain.Town) continue
    dist[i] = 0
    queue.push(i)
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]
    const x = cell % width
    const y = Math.floor(cell / width)
    for (const dir of DIRS) {
      const nx = x + dir.x
      const ny = y + dir.y
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const next = ny * width + nx
      if (dist[next] >= 0 || terrain[next] === Terrain.Water) continue
      dist[next] = dist[cell] + 1
      queue.push(next)
    }
  }
  return dist
}

function paintBiomes(terrain: Uint8Array, width: number, height: number, distance: Int16Array, seed: number) {
  const candidates: number[] = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (terrain[i] !== Terrain.Land) continue
      const noise = valueNoise(x, y, seed)
      const dist = distance[i]
      if (dist >= 5 && noise > 0.48 && noise < 0.56) candidates.push(i)
      else if (dist >= 3 && noise > 0.6) terrain[i] = Terrain.Forest
      else if (dist >= 0 && dist <= 2 && noise > 0.74) terrain[i] = Terrain.Flowers
    }
  }
  const marked = new Uint8Array(terrain.length)
  for (const cell of candidates) marked[cell] = 1
  const seen = new Uint8Array(terrain.length)
  for (const start of candidates) {
    if (seen[start]) continue
    const cells: number[] = []
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const cell = stack.pop() ?? 0
      cells.push(cell)
      const x = cell % width
      const y = Math.floor(cell / width)
      for (const dir of DIRS) {
        const nx = x + dir.x
        const ny = y + dir.y
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const next = ny * width + nx
        if (seen[next] || !marked[next]) continue
        seen[next] = 1
        stack.push(next)
      }
    }
    if (cells.length < 8) continue
    for (const cell of cells) terrain[cell] = Terrain.Lake
  }
}

function traceShore(terrain: Uint8Array, width: number, height: number): { coast: MapPoint[]; holes: MapPoint[][] } {
  const edges = new Map<string, { x: number; y: number; dir: number }>()
  const landAt = (x: number, y: number) => isLand(terrain, width, height, x, y)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!landAt(x, y)) continue
      if (!landAt(x, y - 1)) edges.set(edgeKey(x + 1, y, 2), { x: x + 1, y, dir: 2 })
      if (!landAt(x + 1, y)) edges.set(edgeKey(x + 1, y + 1, 3), { x: x + 1, y: y + 1, dir: 3 })
      if (!landAt(x, y + 1)) edges.set(edgeKey(x, y + 1, 0), { x, y: y + 1, dir: 0 })
      if (!landAt(x - 1, y)) edges.set(edgeKey(x, y, 1), { x, y, dir: 1 })
    }
  }
  const outgoing = new Map<string, string[]>()
  for (const [key, edge] of edges) {
    const start = `${edge.x},${edge.y}`
    const list = outgoing.get(start)
    if (list) list.push(key)
    else outgoing.set(start, [key])
  }
  const unused = new Set(edges.keys())
  const loops: MapPoint[][] = []
  while (unused.size > 0) {
    const first = unused.values().next().value
    if (!first) break
    const loop: MapPoint[] = []
    let key: string | null = first
    let incoming = edges.get(first)?.dir ?? 0
    let guard = unused.size + 2
    while (key && unused.has(key) && guard-- > 0) {
      unused.delete(key)
      const edge = edges.get(key)
      if (!edge) break
      loop.push({ x: edge.x, y: edge.y })
      incoming = edge.dir
      const end = stepEdge(edge)
      key = chooseTurn(outgoing.get(`${end.x},${end.y}`) ?? [], incoming, unused)
    }
    if (loop.length >= 4) loops.push(loop)
  }
  if (loops.length === 0) return { coast: [], holes: [] }
  const areas = loops.map(signedArea)
  let outer = 0
  for (let i = 1; i < loops.length; i++) {
    if (Math.abs(areas[i]) > Math.abs(areas[outer])) outer = i
  }
  const coast = areas[outer] < 0 ? [...loops[outer]].reverse() : loops[outer]
  const holes = loops.flatMap((loop, index) => {
    if (index === outer) return []
    return [areas[index] > 0 ? [...loop].reverse() : loop]
  })
  return { coast, holes }
}

function chooseTurn(keys: readonly string[], incoming: number, unused: Set<string>): string | null {
  const order = [(incoming + 3) % 4, incoming, (incoming + 1) % 4, (incoming + 2) % 4]
  for (const dir of order) {
    const found = keys.find((key) => unused.has(key) && key.endsWith(`,${dir}`))
    if (found) return found
  }
  return keys.find((key) => unused.has(key)) ?? null
}

function stepEdge(edge: { x: number; y: number; dir: number }): MapPoint {
  if (edge.dir === 0) return { x: edge.x + 1, y: edge.y }
  if (edge.dir === 1) return { x: edge.x, y: edge.y + 1 }
  if (edge.dir === 2) return { x: edge.x - 1, y: edge.y }
  return { x: edge.x, y: edge.y - 1 }
}

function edgeKey(x: number, y: number, dir: number): string {
  return `${x},${y},${dir}`
}

function signedArea(loop: readonly MapPoint[]): number {
  let area = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % loop.length]
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

function componentCount(edges: readonly [number, number][], count: number): number {
  return new Set(componentIds(edges, count)).size
}

function componentIds(edges: readonly [number, number][], count: number): Int16Array {
  const parent = Int16Array.from({ length: count }, (_, index) => index)
  const find = (id: number): number => {
    let current = id
    while (parent[current] !== current) current = parent[current]
    return current
  }
  for (const [a, b] of edges) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  const ids = new Int16Array(count)
  for (let i = 0; i < count; i++) ids[i] = find(i)
  return ids
}

function polylineLength(line: readonly MapPoint[]): number {
  let length = 0
  for (let i = 0; i < line.length - 1; i++) {
    length += Math.hypot(line[i + 1].x - line[i].x, line[i + 1].y - line[i].y)
  }
  return length
}

function key(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`
}

function isLand(terrain: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return false
  const tile = terrain[y * width + x]
  return tile !== Terrain.Water && tile !== Terrain.Lake
}
