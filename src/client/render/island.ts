import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Path,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bankRuns, forestLoops, landLoops, loopContains, roadLines, signedArea, type LayerLoop } from '../../shared/contour.ts'
import type { MapPoint, WorldSnapshot } from '../../shared/protocol.ts'
import { blockerHoles, smoothShore } from '../../shared/shore.ts'
import { Terrain } from '../../shared/tiles.ts'
import { TILE_TOP } from './terrain.ts'

const SAMPLE = 0.32
const ROAD_HALF = 0.5
const ROAD_COLOR = 0x667755;
const WATER_Y = TILE_TOP - 0.04
const CAP_COLOR = [143 / 255, 206 / 255, 106 / 255]
const FOREST_COLOR = [61 / 255, 154 / 255, 74 / 255]
const TOWN = new Color(0x1a1a1a)
const OBSTACLE = new Color(0x3a342e)
const WET_COLOR = [36 / 255, 92 / 255, 48 / 255]
const BANK = [
  { offset: 0, y: TILE_TOP, wet: 0 },
  { offset: 0.55, y: TILE_TOP - 0.02, wet: 0.45 },
  { offset: 1.15, y: WATER_Y - 0.02, wet: 1 },
]

const GRASS = capMaterial()
const WOODS = capMaterial()
const ROAD = new MeshBasicMaterial({ color: ROAD_COLOR, side: DoubleSide })
const WATER = new MeshBasicMaterial({ color: 0x7ec8e3, side: DoubleSide })
const MARKER = new MeshStandardMaterial({ roughness: 0.92, metalness: 0 })
GRASS.userData.retain = true
WOODS.userData.retain = true
ROAD.userData.retain = true
WATER.userData.retain = true
MARKER.userData.retain = true

export function buildIsland(world: WorldSnapshot): Group {
  const group = new Group()
  group.add(waterPlane(world.width, world.height))
  const land = landMesh(world)
  if (land) group.add(land)
  const roads: BufferGeometry[] = []
  for (const road of world.roads) {
    const ribbon = roadRibbon(road)
    if (ribbon) roads.push(ribbon)
  }
  addMerged(group, roads, ROAD)
  return group
}

export function buildSurface(world: WorldSnapshot): Group {
  const group = new Group()
  const grassCaps: BufferGeometry[] = []
  const grassBanks: BufferGeometry[] = []
  for (const shape of packLoops(landLoops(world.terrain, world.known, world.shifts, world.width, world.height))) {
    grassCaps.push(flatCap(shape.outer.points, shape.holes.map((hole) => hole.points)))
    for (const loop of [shape.outer, ...shape.holes]) {
      for (const run of bankRuns(loop)) {
        const strip = run.closed ? bankStrip(run.points) : openBank(run.points)
        if (strip) grassBanks.push(strip)
      }
    }
  }
  addMerged(group, grassCaps, GRASS)
  addMerged(group, grassBanks, GRASS)
  const woods: BufferGeometry[] = []
  for (const shape of packLoops(forestLoops(world.terrain, world.known, world.shifts, world.width, world.height))) {
    woods.push(flatCap(shape.outer.points, shape.holes.map((hole) => hole.points), TILE_TOP + 0.02, FOREST_COLOR))
  }
  addMerged(group, woods, WOODS)
  const roads: BufferGeometry[] = []
  for (const line of roadLines(world.terrain, world.known, world.shifts, world.width, world.height)) {
    const ribbon = roadRibbon(line)
    if (ribbon) roads.push(ribbon)
  }
  addMerged(group, roads, ROAD)
  const marks = markers(world)
  if (marks) group.add(marks)
  return group
}

function packLoops(loops: readonly LayerLoop[]): { outer: LayerLoop; holes: LayerLoop[] }[] {
  const outers = loops.filter((loop) => signedArea(loop.points) > 0)
  const holes = loops.filter((loop) => signedArea(loop.points) < 0)
  const groups = outers.map((outer) => ({ outer, holes: [] as LayerLoop[] }))
  for (const hole of holes) {
    const point = hole.points[0]
    let best: { outer: LayerLoop; holes: LayerLoop[] } | null = null
    let bestArea = Infinity
    for (const group of groups) {
      const area = Math.abs(signedArea(group.outer.points))
      if (area >= bestArea || !loopContains(group.outer.points, point.x, point.y)) continue
      best = group
      bestArea = area
    }
    if (best) best.holes.push(hole)
  }
  return groups
}

function capMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: DoubleSide,
  })
}

function markers(world: WorldSnapshot): InstancedMesh | null {
  const spots: { x: number; y: number; color: Color }[] = []
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const index = y * world.width + x
      if (world.known[index] !== 1) continue
      const terrain = world.terrain[index]
      if (terrain === Terrain.Town) spots.push({ x, y, color: TOWN })
      else if (terrain === Terrain.Obstacle) spots.push({ x, y, color: OBSTACLE })
    }
  }
  if (spots.length === 0) return null
  const mesh = new InstancedMesh(new BoxGeometry(0.98, TILE_TOP, 0.98), MARKER, spots.length)
  mesh.matrixAutoUpdate = false
  const dummy = new Object3D()
  for (let i = 0; i < spots.length; i++) {
    const spot = spots[i]
    dummy.position.set(spot.x + 0.5, TILE_TOP / 2 + 0.04, spot.y + 0.5)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    mesh.setColorAt(i, spot.color)
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  return mesh
}

function landMesh(world: WorldSnapshot): Group | null {
  const shore = smoothShore(world.terrain, world.width, world.height, world.seed)
  const coast = shore.coast.length >= 3 ? shore.coast : world.coast
  if (coast.length < 3) return null
  const holes =
    shore.coast.length >= 3 ? blockerHoles(world.terrain, world.width, world.height, coast, world.seed) : world.holes
  const group = new Group()
  group.add(staticMesh(flatCap(coast, holes), GRASS))
  const banks: BufferGeometry[] = []
  const outer = bankStrip(coast)
  if (outer) banks.push(outer)
  for (const hole of holes) {
    const strip = bankStrip(hole)
    if (strip) banks.push(strip)
  }
  addMerged(group, banks, GRASS)
  return group
}

function flatCap(
  coast: readonly MapPoint[],
  holes: readonly MapPoint[][],
  y = TILE_TOP,
  color: readonly number[] = CAP_COLOR,
): BufferGeometry {
  const shape = new Shape(coast.map((point) => new Vector2(point.x, point.y)))
  for (const hole of holes) {
    if (hole.length < 3) continue
    shape.holes.push(new Path(hole.map((point) => new Vector2(point.x, point.y))))
  }
  const geometry = new ShapeGeometry(shape)
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, y, 0)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color[0]
    colors[i * 3 + 1] = color[1]
    colors[i * 3 + 2] = color[2]
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  const normal = geometry.getAttribute('normal')
  let up = 0
  for (let i = 0; i < normal.count; i++) up += normal.getY(i)
  if (up < 0) {
    for (let i = 0; i < normal.count; i++) normal.setY(i, -normal.getY(i))
  }
  return geometry
}

function openBank(loop: readonly MapPoint[]): BufferGeometry | null {
  if (loop.length < 2) return null
  const normals = openNormals(loop)
  const positions: number[] = []
  const colors: number[] = []
  for (const ring of BANK) {
    for (let i = 0; i < loop.length; i++) {
      const point = loop[i]
      const normal = normals[i]
      positions.push(point.x + normal.x * ring.offset, ring.y, point.y + normal.y * ring.offset)
      colors.push(
        CAP_COLOR[0] + (WET_COLOR[0] - CAP_COLOR[0]) * ring.wet,
        CAP_COLOR[1] + (WET_COLOR[1] - CAP_COLOR[1]) * ring.wet,
        CAP_COLOR[2] + (WET_COLOR[2] - CAP_COLOR[2]) * ring.wet,
      )
    }
  }
  const indices: number[] = []
  const count = loop.length
  for (let ring = 0; ring < BANK.length - 1; ring++) {
    for (let i = 0; i < count - 1; i++) {
      const a = ring * count + i
      const b = ring * count + i + 1
      const c = (ring + 1) * count + i
      const d = (ring + 1) * count + i + 1
      indices.push(a, c, d, a, d, b)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function openNormals(loop: readonly MapPoint[]): MapPoint[] {
  const normals: MapPoint[] = []
  for (let i = 0; i < loop.length; i++) {
    const prev = loop[Math.max(0, i - 1)]
    const next = loop[Math.min(loop.length - 1, i + 1)]
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    normals.push({ x: dy, y: -dx })
  }
  return normals
}

function bankStrip(loop: readonly MapPoint[]): BufferGeometry | null {
  if (loop.length < 3) return null
  const normals = outwardNormals(loop)
  const positions: number[] = []
  const colors: number[] = []
  for (const ring of BANK) {
    for (let i = 0; i < loop.length; i++) {
      const point = loop[i]
      const normal = normals[i]
      positions.push(point.x + normal.x * ring.offset, ring.y, point.y + normal.y * ring.offset)
      colors.push(
        CAP_COLOR[0] + (WET_COLOR[0] - CAP_COLOR[0]) * ring.wet,
        CAP_COLOR[1] + (WET_COLOR[1] - CAP_COLOR[1]) * ring.wet,
        CAP_COLOR[2] + (WET_COLOR[2] - CAP_COLOR[2]) * ring.wet,
      )
    }
  }
  const indices: number[] = []
  const count = loop.length
  for (let ring = 0; ring < BANK.length - 1; ring++) {
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count
      const a = ring * count + i
      const b = ring * count + next
      const c = (ring + 1) * count + i
      const d = (ring + 1) * count + next
      indices.push(a, c, d, a, d, b)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function outwardNormals(loop: readonly MapPoint[]): MapPoint[] {
  const normals: MapPoint[] = []
  const count = loop.length
  for (let i = 0; i < count; i++) {
    const prev = loop[(i - 1 + count) % count]
    const next = loop[(i + 1) % count]
    let dx = next.x - prev.x
    let dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    dx /= len
    dy /= len
    normals.push({ x: dy, y: -dx })
  }
  return normals
}

function waterPlane(width: number, height: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(width, height), WATER)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(width / 2, WATER_Y, height / 2)
  mesh.matrixAutoUpdate = false
  mesh.updateMatrix()
  return mesh
}

function roadRibbon(line: readonly MapPoint[]): BufferGeometry | null {
  const points = sampleLine(line, SAMPLE)
  if (points.length < 2) return null
  const positions: number[] = []
  const y = TILE_TOP + 0.03
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    const px = (-dy / len) * ROAD_HALF
    const py = (dx / len) * ROAD_HALF
    positions.push(points[i].x + px, y, points[i].y + py, points[i].x - px, y, points[i].y - py)
  }
  const indices: number[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  return geometry
}

function addMerged(group: Group, parts: BufferGeometry[], material: MeshStandardMaterial | MeshBasicMaterial) {
  if (parts.length === 0) return
  let geometry = parts[0]
  if (parts.length > 1) {
    const merged = mergeGeometries(parts)
    if (merged) {
      for (const part of parts) part.dispose()
      geometry = merged
    } else {
      for (const part of parts) group.add(staticMesh(part, material))
      return
    }
  }
  group.add(staticMesh(geometry, material))
}

function staticMesh(geometry: BufferGeometry, material: MeshStandardMaterial | MeshBasicMaterial): Mesh {
  geometry.computeBoundingSphere()
  const mesh = new Mesh(geometry, material)
  mesh.matrixAutoUpdate = false
  return mesh
}

function sampleLine(line: readonly MapPoint[], step: number): MapPoint[] {
  const points: MapPoint[] = []
  for (let i = 0; i < line.length - 1; i++) {
    const from = line[i]
    const to = line[i + 1]
    const len = Math.hypot(to.x - from.x, to.y - from.y)
    const count = Math.max(1, Math.ceil(len / step))
    for (let s = 0; s <= count; s++) {
      if (i > 0 && s === 0) continue
      const t = s / count
      points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
    }
  }
  return points
}
