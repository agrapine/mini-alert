import {
  Group,
  InstancedMesh,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
} from 'three'
import type { WorldSnapshot } from '../../shared/protocol.ts'
import { scarStrength } from '../../shared/tiles.ts'
import { TILE_TOP } from './terrain.ts'

import scar1aUrl from '../../../assets/ground/scar-1a.png?url'
import scar1bUrl from '../../../assets/ground/scar-1b.png?url'
import scar2aUrl from '../../../assets/ground/scar-2a.png?url'
import scar2bUrl from '../../../assets/ground/scar-2b.png?url'
import scar3aUrl from '../../../assets/ground/scar-3a.png?url'
import scar3bUrl from '../../../assets/ground/scar-3b.png?url'

const URLS = [scar1aUrl, scar1bUrl, scar2aUrl, scar2bUrl, scar3aUrl, scar3bUrl]
/** Half-width of the random client offset, in tiles. New each time the page loads. */
const SHIFT = 0.26
const SALT = (Math.random() * 0x100000000) >>> 0
const SCAR_OPACITY = 0.4
/** How long a removed scar takes to dissolve. The server has already cleared the tile. */
const FADE_SECONDS = 3
const dummy = new Object3D()

type Kit = {
  geometry: PlaneGeometry
  materials: MeshBasicMaterial[]
}

let kitPromise: Promise<Kit> | null = null

type Fade = { mesh: Mesh; age: number }

export class ScarLayer {
  readonly root = new Group()
  private readonly live = new Group()
  private readonly fades = new Group()
  private world: WorldSnapshot | null = null
  private kit: Kit | null = null
  /** Tile index to the texture slot last drawn there. Empty until the first paint, so a fresh map does not fade. */
  private shown: Map<number, number> | null = null
  private readonly fading = new Map<number, Fade>()

  constructor() {
    this.root.add(this.live)
    this.root.add(this.fades)
    void loadKit().then((kit) => {
      this.kit = kit
      if (this.world) this.paint(this.world)
    })
  }

  sync(world: WorldSnapshot) {
    this.world = world
    if (this.kit) this.paint(world)
  }

  advance(dt: number) {
    if (this.fading.size === 0) return
    for (const [index, fade] of this.fading) {
      fade.age += dt
      const material = fade.mesh.material
      if (fade.age >= FADE_SECONDS) {
        this.fades.remove(fade.mesh)
        if (material instanceof MeshBasicMaterial) material.dispose()
        this.fading.delete(index)
        continue
      }
      if (material instanceof MeshBasicMaterial) material.opacity = SCAR_OPACITY * (1 - fade.age / FADE_SECONDS)
    }
  }

  private paint(world: WorldSnapshot) {
    const kit = this.kit
    if (!kit) return
    for (const child of this.live.children) {
      if (child instanceof InstancedMesh) child.dispose()
    }
    this.live.clear()
    const buckets: { x: number; z: number; y: number }[][] = URLS.map(() => [])
    const next = new Map<number, number>()
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const index = y * world.width + x
        if (world.known[index] !== 1) continue
        const strength = scarStrength(world.terrain[index])
        if (strength === 0) continue
        const spot = place(x, y)
        const slot = (strength - 1) * 2 + spot.variant
        next.set(index, slot)
        this.stopFade(index)
        buckets[slot].push(spot)
      }
    }
    if (this.shown) {
      for (const [index, slot] of this.shown) {
        if (next.has(index) || world.known[index] !== 1 || this.fading.has(index)) continue
        this.startFade(world, index, slot)
      }
    }
    this.shown = next
    for (let i = 0; i < buckets.length; i++) {
      const spots = buckets[i]
      if (spots.length === 0) continue
      const mesh = new InstancedMesh(kit.geometry, kit.materials[i], spots.length)
      mesh.matrixAutoUpdate = false
      for (let n = 0; n < spots.length; n++) {
        const spot = spots[n]
        dummy.position.set(spot.x, spot.y, spot.z)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(n, dummy.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      this.live.add(mesh)
    }
  }

  private startFade(world: WorldSnapshot, index: number, slot: number) {
    const kit = this.kit
    if (!kit) return
    const x = index % world.width
    const y = (index - x) / world.width
    const spot = place(x, y)
    const material = kit.materials[slot].clone()
    material.opacity = SCAR_OPACITY
    material.userData.retain = false
    const mesh = new Mesh(kit.geometry, material)
    mesh.position.set(spot.x, spot.y, spot.z)
    mesh.updateMatrix()
    mesh.matrixAutoUpdate = false
    this.fades.add(mesh)
    this.fading.set(index, { mesh, age: 0 })
  }

  private stopFade(index: number) {
    const fade = this.fading.get(index)
    if (!fade) return
    this.fades.remove(fade.mesh)
    if (fade.mesh.material instanceof MeshBasicMaterial) fade.mesh.material.dispose()
    this.fading.delete(index)
  }
}

function loadKit(): Promise<Kit> {
  if (!kitPromise) kitPromise = createKit()
  return kitPromise
}

async function createKit(): Promise<Kit> {
  const geometry = new PlaneGeometry(1.15, 1.15)
  geometry.rotateX(-Math.PI / 2)
  geometry.userData.retain = true
  const textures = await Promise.all(URLS.map(loadTexture))
  const materials = textures.map((map) => {
    const material = new MeshBasicMaterial({
      map,
      transparent: true,
      opacity: SCAR_OPACITY,
      depthWrite: false,
      blending: NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    material.userData.retain = true
    return material
  })
  return { geometry, materials }
}

function loadTexture(url: string): Promise<Texture> {
  return new Promise((resolve, reject) => {
    new TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = SRGBColorSpace
        texture.magFilter = LinearFilter
        texture.minFilter = LinearFilter
        texture.generateMipmaps = false
        resolve(texture)
      },
      undefined,
      reject,
    )
  })
}

function place(x: number, y: number): { x: number; y: number; z: number; variant: number } {
  const slide = hash(x, y, SALT)
  return {
    variant: hash(x, y, 0x51ed) & 1,
    x: x + 0.5 + (((slide & 255) / 255) - 0.5) * 2 * SHIFT,
    z: y + 0.5 + ((((slide >>> 8) & 255) / 255) - 0.5) * 2 * SHIFT,
    y: TILE_TOP + 0.045 + (slide & 3) * 0.001,
  }
}

function hash(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ (seed | 0)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n ^ (n >>> 16)) >>> 0
}
