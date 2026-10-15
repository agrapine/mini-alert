import {
  Box3,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  Quaternion,
  RedFormat,
  RingGeometry,
  SRGBColorSpace,
  TextureLoader,
  UnsignedByteType,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { CITY_CATALOG, eachBuildingTile, HALL_SCALE, HALL_SPAN, NEUTRAL_CITY, StreetKind, type CityLayout } from '../../shared/cities.ts'
import type { CityState } from '../../shared/protocol.ts'
import { TILE_TOP } from './terrain.ts'

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
import streetTextureUrl from '../../../assets/city/texture.png?url'
import buildingTextureUrl from '../../../assets/kenney-industrial/colormap.png?url'

const modelFiles = import.meta.glob('../../../assets/kenney-industrial/*.obj', {
  eager: true,
  query: '?url',
  import: 'default',
})

/** World units per Kenney unit. 0.36 fits the largest plant inside one tile. */
const CITY_MODEL_UNIT = 0.36
/** Size of city buildings relative to that fit. 1.25 sits them closer to the street meshes. */
export const CITY_BUILDING_SCALE = 1.6
const KENNEY_SCALE = CITY_MODEL_UNIT * CITY_BUILDING_SCALE

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

type Fit = 'road' | 'prop'

type CityView = {
  layout: CityLayout
  siteKey: string
  owner: { value: number }
  team: Vector3
  buildingMaterial: MeshStandardMaterial
  roadMaterial: MeshStandardMaterial
  cluster: Group
  track: Mesh
  trackMaterial: MeshBasicMaterial
  ring: Mesh
  ringMaterial: MeshBasicMaterial
  shown: number
}

type Kit = {
  streetsMaterial: MeshStandardMaterial
  buildingTexture: MeshStandardMaterial['map']
  swatches: DataTexture
  buildings: BufferGeometry[]
  streets: BufferGeometry[]
}

export class CityLayer {
  readonly root = new Group()
  private views: CityView[] = []
  private pendingLayouts: readonly (CityLayout | null)[] = []
  private pendingStates: readonly (CityState | null)[] = []
  private kit: Kit | null = null

  async load() {
    const streetTexture = await new TextureLoader().loadAsync(streetTextureUrl)
    streetTexture.colorSpace = SRGBColorSpace
    streetTexture.flipY = true
    const buildingTexture = await new TextureLoader().loadAsync(buildingTextureUrl)
    buildingTexture.colorSpace = SRGBColorSpace
    buildingTexture.flipY = true
    const streetsMaterial = new MeshStandardMaterial({ map: streetTexture, roughness: 0.82, metalness: 0 })
    const swatches = swatchTexture()
    const buildings = await Promise.all(CITY_CATALOG.map((entry) => loadKenney(catalogUrl(entry.name))))
    const streets = await Promise.all(STREET_URLS.map((url, index) => loadFitted(url, index >= StreetKind.Lamp ? 'prop' : 'road')))
    this.kit = { streetsMaterial, buildingTexture, swatches, buildings, streets }
    this.present(this.pendingLayouts, this.pendingStates)
  }

  present(layouts: readonly (CityLayout | null)[], states: readonly (CityState | null)[]) {
    this.pendingLayouts = layouts
    this.pendingStates = states
    const kit = this.kit
    if (!kit) return
    for (let index = 0; index < layouts.length; index++) {
      const layout = layouts[index]
      if (!layout) continue
      let view = this.views[index]
      if (!view) {
        view = this.makeView(layout, kit)
        this.views[index] = view
        this.root.add(view.cluster)
      }
      if (view.siteKey !== '' && view.layout === layout) continue
      const stamp = siteStamp(layout)
      if (view.siteKey === stamp) {
        view.layout = layout
        continue
      }
      view.layout = layout
      view.siteKey = stamp
      this.fill(view)
    }
    this.apply(states)
  }

  private makeView(layout: CityLayout, kit: Kit): CityView {
    const owner = { value: 0 }
    const team = new Vector3(1, 1, 1)
    const buildingMaterial = teamMaterial(kit.buildingTexture, kit.swatches, owner, team)
    const roadMaterial = roadMaterialOf(kit.streetsMaterial.map, owner, team)
    const cluster = new Group()
    const trackMaterial = new MeshBasicMaterial({
      color: NEUTRAL_CITY,
      transparent: true,
      opacity: 0.22,
      depthTest: false,
      depthWrite: false,
    })
    const ringMaterial = new MeshBasicMaterial({
      color: NEUTRAL_CITY,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    })
    const track = new Mesh(ringGeometry(layout.span, 1, TRACK_BAND), trackMaterial)
    track.rotation.x = -Math.PI / 2
    track.visible = false
    track.renderOrder = 12
    const ring = new Mesh(ringGeometry(layout.span, 0.001, ARC_BAND), ringMaterial)
    ring.rotation.x = -Math.PI / 2
    ring.visible = false
    ring.renderOrder = 13
    track.matrixAutoUpdate = false
    ring.matrixAutoUpdate = false
    track.updateMatrix()
    ring.updateMatrix()
    cluster.add(track, ring)
    return {
      layout,
      siteKey: '',
      owner,
      team,
      buildingMaterial,
      roadMaterial,
      cluster,
      track,
      trackMaterial,
      ring,
      ringMaterial,
      shown: 0,
    }
  }

  private fill(view: CityView) {
    const kit = this.kit
    if (!kit) return
    for (const child of [...view.cluster.children]) {
      if (child === view.ring || child === view.track) continue
      view.cluster.remove(child)
      if (child instanceof Mesh) child.geometry.dispose()
    }
    const roads: BufferGeometry[] = []
    const props: BufferGeometry[] = []
    const teams: BufferGeometry[] = []
    const keeps: BufferGeometry[] = []
    const teamPlots: { x: number; y: number }[] = []
    const keepPlots: { x: number; y: number }[] = []
    for (const street of view.layout.streets) {
      const model = kit.streets[street.kind] ?? kit.streets[0]
      const lift = street.kind >= StreetKind.Lamp ? 0.06 : 0.015
      const geometry = placeGeometry(model, street.x + 0.5 + street.ox, TILE_TOP + lift, street.y + 0.5 + street.oz, street.yaw * (Math.PI / 2))
      if (street.kind >= StreetKind.Lamp) props.push(geometry)
      else roads.push(geometry)
    }
    for (const building of view.layout.buildings) {
      const model = kit.buildings[building.model] ?? kit.buildings[0]
      const span = building.keep ? HALL_SPAN : 1
      const geometry = placeGeometry(
        model,
        building.x + span / 2,
        TILE_TOP + 0.06,
        building.y + span / 2,
        building.yaw * (Math.PI / 2),
        building.keep ? HALL_SCALE : 1,
      )
      const plots: { x: number; y: number }[] = []
      eachBuildingTile(building, (x, y) => plots.push({ x, y }))
      if (building.keep) {
        keeps.push(geometry)
        keepPlots.push(...plots)
      } else {
        teams.push(geometry)
        teamPlots.push(...plots)
      }
    }
    addMerged(view.cluster, roads, view.roadMaterial)
    addMerged(view.cluster, props, kit.streetsMaterial)
    addMerged(view.cluster, teams, view.buildingMaterial, teamPlots)
    addMerged(view.cluster, keeps, view.buildingMaterial, keepPlots)
    const center = blobCenter(view.layout)
    const reach = Math.max(view.layout.span, Math.ceil(Math.sqrt(view.layout.tiles.length)))
    if (view.ring.userData.reach !== reach) {
      view.track.geometry.dispose()
      view.track.geometry = ringGeometry(reach, 1, TRACK_BAND)
      view.ring.geometry.dispose()
      view.ring.geometry = ringGeometry(reach, view.shown > 0 ? view.shown : 0.001, ARC_BAND)
      view.ring.userData.reach = reach
    }
    view.track.position.set(center.x, TILE_TOP + 1.4, center.z)
    view.ring.position.set(center.x, TILE_TOP + 1.42, center.z)
    view.track.updateMatrix()
    view.ring.updateMatrix()
  }

  private apply(states: readonly (CityState | null)[]) {
    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i]
      const state = states[i]
      if (!view || !state) continue
      view.owner.value = state.color > 0 ? 1 : 0
      if (state.color > 0) view.team.set((state.color >> 16) / 255, ((state.color >> 8) & 255) / 255, (state.color & 255) / 255)
      const active = state.progress > 0.001 && state.challengerId > 0
      view.track.visible = active
      view.ring.visible = active
      if (!active) continue
      const color = state.challengerColor > 0 ? state.challengerColor : NEUTRAL_CITY
      view.trackMaterial.color.setHex(color)
      view.ringMaterial.color.setHex(color)
      if (Math.abs(view.shown - state.progress) < 0.01) continue
      view.shown = state.progress
      view.ring.geometry.dispose()
      const reach = Math.max(view.layout.span, Math.ceil(Math.sqrt(view.layout.tiles.length)))
      view.ring.geometry = ringGeometry(reach, state.progress, ARC_BAND)
    }
  }
}

const layoutStamps = new WeakMap<CityLayout, string>()

function siteStamp(layout: CityLayout): string {
  const cached = layoutStamps.get(layout)
  if (cached) return cached
  const buildings = layout.buildings.map((building) => `${building.x},${building.y},${building.model},${building.yaw}`).join(';')
  const streets = layout.streets.map((street) => `${street.x},${street.y},${street.kind}`).join(';')
  const stamp = `${layout.tiles.length}:${buildings}:${streets}`
  layoutStamps.set(layout, stamp)
  return stamp
}

const TRACK_BAND = 0.1
const ARC_BAND = 0.28

function ringGeometry(span: number, progress: number, thickness: number): RingGeometry {
  const mid = Math.max(1.05, span * 0.46) - 0.14
  return new RingGeometry(mid - thickness / 2, mid + thickness / 2, 64, 1, 0, Math.max(0.001, progress) * Math.PI * 2)
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

function teamMaterial(
  map: MeshStandardMaterial['map'],
  swatches: DataTexture,
  owner: { value: number },
  team: Vector3,
): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ map, roughness: 0.82, metalness: 0 })
  material.customProgramCacheKey = () => 'city-swatch'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cityOwner = owner
    shader.uniforms.teamColor = { value: team }
    shader.uniforms.swatchMap = { value: swatches }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float cityOwner;
        uniform vec3 teamColor;
        uniform sampler2D swatchMap;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          float col = clamp(floor(vMapUv.x * 8.0), 0.0, 7.0);
          float row = clamp(floor(vMapUv.y * 4.0), 0.0, 3.0);
          float cell = col + row * 8.0;
          vec2 local = fract(vec2(vMapUv.x * 8.0, vMapUv.y * 4.0));
          float dest = floor(texture2D(swatchMap, vec2((cell + 0.5) / 32.0, (cityOwner + 0.5) / 2.0)).r * 255.0 + 0.5);
          vec2 sampleUv = (vec2(mod(dest, 8.0), floor(dest / 8.0)) + local) / vec2(8.0, 4.0);
          vec4 sampledDiffuseColor = texture2D(map, sampleUv);
          if (cityOwner > 0.5 && abs(dest - cell) > 0.5) {
            float shade = max(sampledDiffuseColor.r, max(sampledDiffuseColor.g, sampledDiffuseColor.b));
            sampledDiffuseColor.rgb = teamColor * shade;
          }
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      )
  }
  return material
}

function roadMaterialOf(map: MeshStandardMaterial['map'], owner: { value: number }, team: Vector3): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ map, roughness: 0.82, metalness: 0 })
  material.customProgramCacheKey = () => 'city-road-paint'
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cityOwner = owner
    shader.uniforms.teamColor = { value: team }
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float cityOwner;
        uniform vec3 teamColor;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          if (cityOwner > 0.5) {
            float shade = max(sampledDiffuseColor.r, max(sampledDiffuseColor.g, sampledDiffuseColor.b));
            float chroma = shade - min(sampledDiffuseColor.r, min(sampledDiffuseColor.g, sampledDiffuseColor.b));
            float paint = max(smoothstep(0.08, 0.2, chroma), smoothstep(0.35, 0.55, shade));
            sampledDiffuseColor.rgb = mix(teamColor * shade, sampledDiffuseColor.rgb, paint);
          }
          diffuseColor *= sampledDiffuseColor;
        #endif`,
      )
  }
  return material
}

function swatchTexture(): DataTexture {
  const data = new Uint8Array(SWATCH_COUNT * 2)
  writePalette(data, 0, [cell(1, 3)])
  writePalette(data, 1, [cell(1, 3), cell(2, 3), cell(3, 3), cell(4, 3)])
  const texture = new DataTexture(data, SWATCH_COUNT, 2, RedFormat, UnsignedByteType)
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

function catalogUrl(name: string): string {
  for (const path in modelFiles) {
    if (path.endsWith(`/${name}.obj`)) return modelFiles[path]
  }
  throw new Error(`missing city model ${name}`)
}

const placeMatrix = new Matrix4()
const placePosition = new Vector3()
const placeQuaternion = new Quaternion()
const placeScale = new Vector3(1, 1, 1)
const placeUp = new Vector3(0, 1, 0)

function placeGeometry(source: BufferGeometry, x: number, y: number, z: number, yaw: number, scale = 1): BufferGeometry {
  placePosition.set(x, y, z)
  placeQuaternion.setFromAxisAngle(placeUp, yaw)
  placeScale.set(scale, scale, scale)
  placeMatrix.compose(placePosition, placeQuaternion, placeScale)
  const geometry = source.clone()
  geometry.applyMatrix4(placeMatrix)
  return geometry
}

function addMerged(
  group: Group,
  parts: BufferGeometry[],
  material: MeshStandardMaterial,
  plots?: readonly { x: number; y: number }[],
) {
  if (parts.length === 0) return
  let geometry = parts[0]
  if (parts.length > 1) {
    const merged = mergeGeometries(parts)
    if (merged) {
      for (const part of parts) part.dispose()
      geometry = merged
    } else {
      for (const part of parts) group.add(staticMesh(part, material, plots))
      return
    }
  }
  group.add(staticMesh(geometry, material, plots))
}

function staticMesh(
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  plots?: readonly { x: number; y: number }[],
): Mesh {
  geometry.computeBoundingSphere()
  const mesh = new Mesh(geometry, material)
  mesh.matrixAutoUpdate = false
  if (plots) mesh.userData.plots = plots
  return mesh
}

async function loadKenney(url: string): Promise<BufferGeometry> {
  const root = await new OBJLoader().loadAsync(url)
  root.updateMatrixWorld(true)
  const raw = new Box3().setFromObject(root)
  const center = raw.getCenter(new Vector3())
  root.scale.setScalar(KENNEY_SCALE)
  root.position.set(-center.x * KENNEY_SCALE, -raw.min.y * KENNEY_SCALE, -center.z * KENNEY_SCALE)
  root.updateMatrixWorld(true)
  return mergedGeometry(root)
}

async function loadFitted(url: string, mode: Fit): Promise<BufferGeometry> {
  const root = await new OBJLoader().loadAsync(url)
  root.updateMatrixWorld(true)
  const raw = new Box3().setFromObject(root)
  const size = raw.getSize(new Vector3())
  const center = raw.getCenter(new Vector3())
  const scale = mode === 'road' ? 1 / Math.max(size.x, size.z) : 1.35 / Math.max(size.y, 0.001)
  root.scale.setScalar(scale)
  root.position.set(-center.x * scale, -raw.min.y * scale, -center.z * scale)
  root.updateMatrixWorld(true)
  return mergedGeometry(root)
}

function mergedGeometry(root: Group): BufferGeometry {
  const parts: BufferGeometry[] = []
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return
    const geometry = child.geometry.clone()
    geometry.applyMatrix4(child.matrixWorld)
    parts.push(geometry)
  })
  if (parts.length === 0) throw new Error('city model has no mesh')
  if (parts.length === 1) return parts[0]
  const merged = mergeGeometries(parts)
  for (const part of parts) part.dispose()
  if (!merged) throw new Error('city model merge failed')
  return merged
}
