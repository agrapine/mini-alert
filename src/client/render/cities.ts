import {
  Box3,
  ClampToEdgeWrapping,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  RedFormat,
  RingGeometry,
  SRGBColorSpace,
  TextureLoader,
  UnsignedByteType,
  Vector3,
} from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { cityColor, layoutCities, projectCity, StreetKind, type CityLayout } from '../../shared/cities.ts'
import type { CityState, WorldSnapshot } from '../../shared/protocol.ts'
import { TILE_TOP } from './terrain.ts'

import buildingAUrl from '../../../assets/city/building-a.obj?url'
import buildingBUrl from '../../../assets/city/building-b.obj?url'
import buildingCUrl from '../../../assets/city/building-c.obj?url'
import buildingDUrl from '../../../assets/city/building-d.obj?url'
import buildingEUrl from '../../../assets/city/building-e.obj?url'
import buildingFUrl from '../../../assets/city/building-f.obj?url'
import buildingGUrl from '../../../assets/city/building-g.obj?url'
import buildingHUrl from '../../../assets/city/building-h.obj?url'
import roadStraightUrl from '../../../assets/city/road-straight.obj?url'
import roadCornerUrl from '../../../assets/city/road-corner.obj?url'
import roadSplitUrl from '../../../assets/city/road-split.obj?url'
import roadJunctionUrl from '../../../assets/city/road-junction.obj?url'
import roadCrossingUrl from '../../../assets/city/road-crossing.obj?url'
import roadCurveUrl from '../../../assets/city/road-curve.obj?url'
import streetlightUrl from '../../../assets/city/streetlight.obj?url'
import signalAUrl from '../../../assets/city/signal-a.obj?url'
import signalBUrl from '../../../assets/city/signal-b.obj?url'
import signalCUrl from '../../../assets/city/signal-c.obj?url'
import textureUrl from '../../../assets/city/texture.png?url'

const BUILDING_URLS = [
  buildingAUrl,
  buildingBUrl,
  buildingCUrl,
  buildingDUrl,
  buildingEUrl,
  buildingFUrl,
  buildingGUrl,
  buildingHUrl,
]

const STREET_URLS = [
  roadStraightUrl,
  roadCornerUrl,
  roadSplitUrl,
  roadJunctionUrl,
  roadCrossingUrl,
  roadCurveUrl,
  streetlightUrl,
  signalAUrl,
  signalBUrl,
  signalCUrl,
]

type Fit = 'building' | 'road' | 'prop'

type CityView = {
  base: CityLayout
  layout: CityLayout
  grown: number
  owner: { value: number }
  buildingMaterial: MeshStandardMaterial
  cluster: Group
  ring: Mesh
  ringMaterial: MeshBasicMaterial
  shown: number
}

type Kit = {
  streetsMaterial: MeshStandardMaterial
  buildings: Group[]
  streets: Group[]
}

export class CityLayer {
  readonly root = new Group()
  private views: CityView[] = []
  private pending: readonly CityState[] = []
  private world: WorldSnapshot | null = null
  private kit: Kit | null = null

  async load(world: WorldSnapshot) {
    this.world = world
    const layouts = layoutCities(world.towns, world.seed, world.terrain, world.width, world.height)
    const texture = await new TextureLoader().loadAsync(textureUrl)
    texture.colorSpace = SRGBColorSpace
    texture.flipY = true
    const streetsMaterial = new MeshStandardMaterial({ map: texture, roughness: 0.82, metalness: 0 })
    const swatches = swatchTexture()
    const buildings = await Promise.all(BUILDING_URLS.map((url) => loadFitted(url, 'building')))
    const streets = await Promise.all(STREET_URLS.map((url, index) => loadFitted(url, index >= StreetKind.Lamp ? 'prop' : 'road')))
    this.kit = { streetsMaterial, buildings, streets }
    for (const layout of layouts) {
      const owner = { value: 0 }
      const buildingMaterial = teamMaterial(texture, swatches, owner)
      const cluster = new Group()
      const ringMaterial = new MeshBasicMaterial({
        color: cityColor(0),
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      })
      const ring = new Mesh(ringGeometry(layout.span, 0.001), ringMaterial)
      ring.rotation.x = -Math.PI / 2
      ring.visible = false
      ring.renderOrder = 12
      cluster.add(ring)
      const view: CityView = { base: layout, layout, grown: 0, owner, cluster, ring, ringMaterial, shown: 0, buildingMaterial }
      this.fill(view)
      this.root.add(cluster)
      this.views.push(view)
    }
    this.sync(this.pending)
  }

  sync(states: readonly CityState[]) {
    this.pending = states
    const world = this.world
    if (!world || !this.kit) return
    for (let index = 0; index < this.views.length; index++) {
      const view = this.views[index]
      const grown = states[index]?.grown ?? 0
      if (grown === view.grown) continue
      view.layout = projectCity(view.base, grown, world.terrain, world.width, world.height)
      view.grown = grown
      this.fill(view)
    }
    this.apply(states)
  }

  private fill(view: CityView) {
    const kit = this.kit
    if (!kit) return
    const pooled = new Map<string, (typeof view.cluster.children)[number]>()
    for (const child of [...view.cluster.children]) {
      if (child === view.ring) continue
      const stamp = child.userData.stamp as string | undefined
      view.cluster.remove(child)
      if (stamp) pooled.set(stamp, child)
    }
    const adopt = (stamp: string, create: () => (typeof view.cluster.children)[number]) => {
      const found = pooled.get(stamp)
      if (found) {
        pooled.delete(stamp)
        view.cluster.add(found)
        return
      }
      const mesh = create()
      mesh.userData.stamp = stamp
      view.cluster.add(mesh)
    }
    for (const street of view.layout.streets) {
      const stamp = `s${street.x},${street.y},${street.kind},${street.yaw},${street.ox},${street.oz}`
      adopt(stamp, () => {
        const model = kit.streets[street.kind] ?? kit.streets[0]
        const mesh = model.clone(true)
        mesh.traverse((child) => {
          if (child instanceof Mesh) child.material = kit.streetsMaterial
        })
        mesh.rotation.y = street.yaw * (Math.PI / 2)
        const lift = street.kind >= StreetKind.Lamp ? 0.06 : 0.015
        mesh.position.set(street.x + 0.5 + street.ox, TILE_TOP + lift, street.y + 0.5 + street.oz)
        return mesh
      })
    }
    for (const building of view.layout.buildings) {
      const stamp = `b${building.x},${building.y},${building.model},${building.yaw}`
      adopt(stamp, () => {
        const model = kit.buildings[building.model] ?? kit.buildings[0]
        const mesh = model.clone(true)
        mesh.traverse((child) => {
          if (child instanceof Mesh) child.material = view.buildingMaterial
        })
        mesh.rotation.y = building.yaw * (Math.PI / 2)
        mesh.position.set(building.x + 0.5, TILE_TOP + 0.06, building.y + 0.5)
        return mesh
      })
    }
    const center = blobCenter(view.layout)
    const reach = Math.max(view.layout.span, Math.ceil(Math.sqrt(view.layout.tiles.length)))
    if (view.ring.userData.reach !== reach) {
      view.ring.geometry.dispose()
      view.ring.geometry = ringGeometry(reach, view.shown > 0 ? view.shown : 0.001)
      view.ring.userData.reach = reach
    }
    view.ring.position.set(center.x, TILE_TOP + 1.4, center.z)
  }

  private apply(states: readonly CityState[]) {
    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i]
      const state = states[i]
      if (!state) continue
      view.owner.value = state.ownerId <= 0 ? 0 : ((state.ownerId - 1) % 2) + 1
      const active = state.progress > 0.001 && state.challengerId > 0
      view.ring.visible = active
      if (!active) continue
      view.ringMaterial.color.setHex(cityColor(state.challengerId))
      if (Math.abs(view.shown - state.progress) < 0.01) continue
      view.shown = state.progress
      view.ring.geometry.dispose()
      const reach = Math.max(view.layout.span, Math.ceil(Math.sqrt(view.layout.tiles.length)))
      view.ring.geometry = ringGeometry(reach, state.progress)
    }
  }
}

function ringGeometry(span: number, progress: number): RingGeometry {
  const outer = Math.max(1.05, span * 0.46)
  return new RingGeometry(outer - 0.16, outer, 48, 1, 0, Math.max(0.001, progress) * Math.PI * 2)
}

function blobCenter(layout: CityLayout): { x: number; z: number } {
  let x = 0
  let z = 0
  for (const tile of layout.tiles) {
    x += tile.x + 0.5
    z += tile.y + 0.5
  }
  const count = Math.max(1, layout.tiles.length)
  return { x: x / count, z: z / count }
}

const SWATCH_COUNT = 32

function teamMaterial(map: MeshStandardMaterial['map'], swatches: DataTexture, owner: { value: number }): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ map, roughness: 0.82, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cityOwner = owner
    shader.uniforms.swatchMap = { value: swatches }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float cityOwner;
        uniform sampler2D swatchMap;
        vec2 cityUv(vec2 uv) {
          float col = clamp(floor(uv.x * 8.0), 0.0, 7.0);
          float row = clamp(floor(uv.y * 4.0), 0.0, 3.0);
          float cell = col + row * 8.0;
          vec2 local = fract(vec2(uv.x * 8.0, uv.y * 4.0));
          float dest = floor(texture2D(swatchMap, vec2((cell + 0.5) / 32.0, (cityOwner + 0.5) / 3.0)).r * 255.0 + 0.5);
          return (vec2(mod(dest, 8.0), floor(dest / 8.0)) + local) / vec2(8.0, 4.0);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, cityUv(vMapUv));
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      )
  }
  return material
}

function swatchTexture(): DataTexture {
  const data = new Uint8Array(SWATCH_COUNT * 3)
  writePalette(data, 0, [cell(1, 3)])
  writePalette(data, 1, [cell(0, 2), cell(1, 2), cell(2, 2)])
  writePalette(data, 2, [cell(4, 2), cell(7, 1), cell(6, 1), cell(7, 3)])
  const texture = new DataTexture(data, SWATCH_COUNT, 3, RedFormat, UnsignedByteType)
  texture.colorSpace = NoColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.flipY = false
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

function writePalette(data: Uint8Array, owner: number, palette: readonly number[]) {
  const keep = new Set([cell(1, 3), cell(0, 3), cell(3, 3), cell(4, 3), cell(6, 2), cell(4, 1), cell(5, 1)])
  for (let i = 0; i < SWATCH_COUNT; i++) {
    data[owner * SWATCH_COUNT + i] = keep.has(i) ? i : palette[i % palette.length]
  }
}

function cell(col: number, row: number): number {
  return col + row * 8
}

async function loadFitted(url: string, mode: Fit): Promise<Group> {
  const root = await new OBJLoader().loadAsync(url)
  root.updateMatrixWorld(true)
  const raw = new Box3().setFromObject(root)
  const size = raw.getSize(new Vector3())
  const center = raw.getCenter(new Vector3())
  const scale =
    mode === 'building' ? 0.82 / Math.max(size.x, size.z) : mode === 'road' ? 1 / Math.max(size.x, size.z) : 1.35 / Math.max(size.y, 0.001)
  root.scale.setScalar(scale)
  root.position.set(-center.x * scale, -raw.min.y * scale, -center.z * scale)
  const holder = new Group()
  holder.add(root)
  return holder
}
