import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three'
import type { MapPoint, WorldSnapshot } from '../../shared/protocol.ts'
import { smoothShore } from '../../shared/shore.ts'
import { TILE_TOP } from './terrain.ts'

const SAMPLE = 0.32
const ROAD_HALF = 0.5
const ROAD_COLOR = 0x667755;
const WATER_Y = TILE_TOP - 0.04
const CAP_COLOR = [143 / 255, 206 / 255, 106 / 255]
const WET_COLOR = [36 / 255, 92 / 255, 48 / 255]
const BANK = [
  { offset: 0, y: TILE_TOP, wet: 0 },
  { offset: 0.55, y: TILE_TOP - 0.02, wet: 0.45 },
  { offset: 1.15, y: WATER_Y - 0.02, wet: 1 },
]

export function buildIsland(world: WorldSnapshot): Group {
  const group = new Group()
  group.add(waterPlane(world.width, world.height))
  const land = landMesh(world)
  if (land) group.add(land)
  for (const road of world.roads) {
    const ribbon = roadRibbon(road)
    if (ribbon) group.add(ribbon)
  }
  return group
}

function landMesh(world: WorldSnapshot): Group | null {
  const shore = smoothShore(world.terrain, world.width, world.height, world.seed)
  const coast = shore.coast.length >= 3 ? shore.coast : world.coast
  if (coast.length < 3) return null
  const holes = shore.coast.length >= 3 ? shore.holes : world.holes
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    side: DoubleSide,
  })
  const group = new Group()
  group.add(flatCap(coast, holes, material))
  const outer = bankStrip(coast, material)
  if (outer) group.add(outer)
  for (const hole of holes) {
    const strip = bankStrip(hole, material)
    if (strip) group.add(strip)
  }
  return group
}

function flatCap(coast: readonly MapPoint[], holes: readonly MapPoint[][], material: MeshStandardMaterial): Mesh {
  const shape = new Shape(coast.map((point) => new Vector2(point.x, point.y)))
  for (const hole of holes) {
    if (hole.length < 3) continue
    shape.holes.push(new Path(hole.map((point) => new Vector2(point.x, point.y))))
  }
  const geometry = new ShapeGeometry(shape)
  geometry.rotateX(Math.PI / 2)
  geometry.translate(0, TILE_TOP, 0)
  const count = geometry.getAttribute('position').count
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    colors[i * 3] = CAP_COLOR[0]
    colors[i * 3 + 1] = CAP_COLOR[1]
    colors[i * 3 + 2] = CAP_COLOR[2]
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  const normal = geometry.getAttribute('normal')
  let up = 0
  for (let i = 0; i < normal.count; i++) up += normal.getY(i)
  if (up < 0) {
    for (let i = 0; i < normal.count; i++) normal.setY(i, -normal.getY(i))
  }
  return new Mesh(geometry, material)
}

function bankStrip(loop: readonly MapPoint[], material: MeshStandardMaterial): Mesh | null {
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
  return new Mesh(geometry, material)
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
  const mesh = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ color: 0x7ec8e3, side: DoubleSide }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(width / 2, WATER_Y, height / 2)
  return mesh
}

function roadRibbon(line: readonly MapPoint[]): Mesh | null {
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
  return new Mesh(geometry, new MeshBasicMaterial({ color: ROAD_COLOR, side: DoubleSide }))
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
