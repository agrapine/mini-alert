import {
  Box3,
  BufferGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  Object3D,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import type { WorldSnapshot } from '../../shared/protocol.ts'
import type { TileCoord } from '../../shared/tiles.ts'
import { Terrain } from '../../shared/tiles.ts'
import { TILE_TOP } from './terrain.ts'

import colormapUrl from '../../../assets/kenney/colormap.png?url'
import patchGrassUrl from '../../../assets/kenney/patch-grass.obj?url'
import plantUrl from '../../../assets/kenney/plant.obj?url'
import rocksLowUrl from '../../../assets/kenney/rocks-low.obj?url'
import stonesUrl from '../../../assets/kenney/stones.obj?url'
import treeHighUrl from '../../../assets/kenney/tree-high.obj?url'
import treeUrl from '../../../assets/kenney/tree.obj?url'

const MODEL_URLS = {
  tree: treeUrl,
  'tree-high': treeHighUrl,
  plant: plantUrl,
  stones: stonesUrl,
  'rocks-low': rocksLowUrl,
} as const

const NAMES = ['tree', 'tree-high', 'plant', 'stones', 'rocks-low'] as const

type PropName = (typeof NAMES)[number]

type Spot = { x: number; y: number; yaw: number }

type Kit = {
  material: MeshStandardMaterial
  geometries: Map<PropName, BufferGeometry>
}

type TreeSpot = { mesh: InstancedMesh; index: number; hidden: boolean }

const dummy = new Object3D()

let kitPromise: Promise<Kit> | null = null

export class PropField {
  readonly root = new Group()
  private generation = 0
  private width = 0
  private readonly trees = new Map<number, TreeSpot>()
  private readonly spots: Record<PropName, Spot[]> = {
    tree: [],
    'tree-high': [],
    plant: [],
    stones: [],
    'rocks-low': [],
  }

  async sync(world: WorldSnapshot) {
    const generation = ++this.generation
    const kit = await loadKit()
    if (generation !== this.generation) return
    this.scatter(world, kit)
  }

  hideTrees(tiles: readonly TileCoord[]): { x: number; z: number }[] {
    const fell: { x: number; z: number }[] = []
    for (const tile of tiles) {
      const spot = this.trees.get(tile.y * this.width + tile.x)
      if (!spot || spot.hidden) continue
      spot.hidden = true
      dummy.position.set(0, 0, 0)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(0, 0, 0)
      dummy.updateMatrix()
      spot.mesh.setMatrixAt(spot.index, dummy.matrix)
      spot.mesh.instanceMatrix.needsUpdate = true
      fell.push({ x: tile.x + 0.5, z: tile.y + 0.5 })
    }
    return fell
  }

  private scatter(world: WorldSnapshot, kit: Kit) {
    this.width = world.width
    this.trees.clear()
    for (const child of this.root.children) {
      if (child instanceof InstancedMesh) child.dispose()
    }
    this.root.clear()
    for (const name of NAMES) this.spots[name].length = 0
    const { width, height, terrain, seed } = world
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (world.known[y * width + x] === 0) continue
        const tile = terrain[y * width + x]
        const n = hash(x, y, seed)
        const yaw = ((n % 360) * Math.PI) / 180
        if (tile === Terrain.Tree) this.spots[n % 2 === 0 ? 'tree' : 'tree-high'].push({ x, y, yaw })
        else if (tile === Terrain.Flowers && n % 4 === 0) this.spots.plant.push({ x, y, yaw })
        else if (onCoast(world, x, y) && n % 13 === 0) this.spots[n % 2 === 0 ? 'stones' : 'rocks-low'].push({ x, y, yaw })
      }
    }
    for (const name of NAMES) {
      const list = this.spots[name]
      if (list.length === 0) continue
      const geometry = kit.geometries.get(name)
      if (!geometry) throw new Error(`missing prop ${name}`)
      const mesh = new InstancedMesh(geometry, kit.material, list.length)
      mesh.matrixAutoUpdate = false
      const tree = name === 'tree' || name === 'tree-high'
      for (let i = 0; i < list.length; i++) {
        const spot = list[i]
        dummy.position.set(spot.x + 0.5, TILE_TOP, spot.y + 0.5)
        dummy.rotation.set(0, spot.yaw, 0)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        if (tree) this.trees.set(spot.y * width + spot.x, { mesh, index: i, hidden: false })
      }
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      this.root.add(mesh)
    }
  }
}

function loadKit(): Promise<Kit> {
  if (!kitPromise) kitPromise = createKit()
  return kitPromise
}

async function createKit(): Promise<Kit> {
  const texture = await loadTexture(colormapUrl)
  const material = new MeshStandardMaterial({ map: texture, roughness: 0.86, metalness: 0 })
  material.userData.retain = true
  const scale = await measureScale(material)
  const geometries = new Map<PropName, BufferGeometry>()
  for (const name of NAMES) {
    const geometry = await loadFitted(MODEL_URLS[name], material, scale)
    geometry.userData.retain = true
    geometries.set(name, geometry)
  }
  return { material, geometries }
}

async function measureScale(material: MeshStandardMaterial): Promise<number> {
  const root = await loadObj(patchGrassUrl)
  paint(root, material)
  const span = new Box3().setFromObject(root).getSize(new Vector3())
  const footprint = Math.max(span.x, span.z)
  if (footprint <= 0) throw new Error('patch-grass has no footprint')
  return 0.92 / footprint
}

async function loadFitted(url: string, material: MeshStandardMaterial, scale: number): Promise<BufferGeometry> {
  const root = await loadObj(url)
  paint(root, material)
  root.scale.setScalar(scale)
  root.updateMatrixWorld(true)
  root.position.y -= new Box3().setFromObject(root).min.y
  root.updateMatrixWorld(true)
  return bake(root)
}

function bake(root: Group): BufferGeometry {
  root.updateMatrixWorld(true)
  const parts: BufferGeometry[] = []
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return
    const geometry = child.geometry.clone()
    child.updateWorldMatrix(true, false)
    geometry.applyMatrix4(child.matrixWorld)
    parts.push(geometry)
  })
  if (parts.length === 0) throw new Error('prop has no mesh')
  if (parts.length === 1) {
    parts[0].computeBoundingSphere()
    return parts[0]
  }
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  if (!merged) throw new Error('prop merge failed')
  merged.computeBoundingSphere()
  return merged
}

function onCoast(world: WorldSnapshot, x: number, y: number): boolean {
  const tile = world.terrain[y * world.width + x]
  if (
    tile === Terrain.Water ||
    tile === Terrain.Lake ||
    tile === Terrain.Road ||
    tile === Terrain.Town ||
    tile === Terrain.Obstacle
  ) {
    return false
  }
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= world.width || ny >= world.height) continue
    if (world.terrain[ny * world.width + nx] === Terrain.Water) return true
  }
  return false
}

function loadTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    new TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = SRGBColorSpace
        texture.magFilter = NearestFilter
        texture.minFilter = NearestFilter
        resolve(texture)
      },
      undefined,
      reject,
    )
  })
}

function loadObj(url: string): Promise<Group> {
  return new Promise((resolve, reject) => {
    new OBJLoader().load(url, resolve, undefined, reject)
  })
}

function paint(root: Group, material: MeshStandardMaterial) {
  root.traverse((child) => {
    if (child instanceof Mesh) child.material = material
  })
}

function hash(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ (seed | 0)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n ^ (n >>> 16)) >>> 0
}
