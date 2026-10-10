import {
  Box3,
  Group,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
} from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import type { WorldSnapshot } from '../../shared/protocol.ts'
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

export async function loadProps(world: WorldSnapshot): Promise<Group> {
  const texture = await loadTexture(colormapUrl)
  const material = new MeshStandardMaterial({ map: texture, roughness: 0.86, metalness: 0 })
  const scale = await measureScale(material)
  const props = new Map<PropName, Group>()
  for (const name of NAMES) {
    props.set(name, await loadFitted(urlFor(name), material, scale))
  }
  return scatter(world, props)
}

async function measureScale(material: MeshStandardMaterial): Promise<number> {
  const root = await loadObj(patchGrassUrl)
  paint(root, material)
  const span = new Box3().setFromObject(root).getSize(new Vector3())
  const footprint = Math.max(span.x, span.z)
  if (footprint <= 0) throw new Error('patch-grass has no footprint')
  return 0.92 / footprint
}

async function loadFitted(url: string, material: MeshStandardMaterial, scale: number): Promise<Group> {
  const root = await loadObj(url)
  paint(root, material)
  root.scale.setScalar(scale)
  root.updateMatrixWorld(true)
  root.position.y -= new Box3().setFromObject(root).min.y
  const holder = new Group()
  holder.add(root)
  return holder
}

function scatter(world: WorldSnapshot, props: Map<PropName, Group>): Group {
  const group = new Group()
  const { width, height, terrain, seed } = world
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = terrain[y * width + x]
      const n = hash(x, y, seed)
      const yaw = ((n % 360) * Math.PI) / 180
      if (tile === Terrain.Forest && n % 7 === 0) {
        group.add(place(props, n % 2 === 0 ? 'tree' : 'tree-high', x, y, yaw))
      } else if (tile === Terrain.Flowers && n % 4 === 0) {
        group.add(place(props, 'plant', x, y, yaw))
      } else if (onCoast(world, x, y) && n % 13 === 0) {
        group.add(place(props, n % 2 === 0 ? 'stones' : 'rocks-low', x, y, yaw))
      }
    }
  }
  return group
}

function place(props: Map<PropName, Group>, name: PropName, x: number, y: number, yaw: number): Group {
  const source = props.get(name)
  if (!source) throw new Error(`missing prop ${name}`)
  const mesh = source.clone(true)
  mesh.position.set(x + 0.5, TILE_TOP, y + 0.5)
  mesh.rotation.y = yaw
  return mesh
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

function urlFor(name: PropName): string {
  return MODEL_URLS[name]
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
