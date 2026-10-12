import { BoxGeometry, CanvasTexture, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RingGeometry, Sprite, SpriteMaterial } from 'three'
import type { CityState, MapPoint, ShotEvent, ShotHit, UnitSnapshot, WorldSnapshot } from '../../shared/protocol.ts'
import { citySightOrigin, type CityLayout } from '../../shared/cities.ts'
import { UNIT_TYPES, UnitTypeId, buildStage, type WeaponKind } from '../../shared/unit-types.ts'
import { friendsOf } from '../../shared/vision.ts'
import type { TileCoord } from '../../shared/tiles.ts'
import { Fog } from './fog.ts'
import { CityLayer } from './cities.ts'
import { Minimap, type MinimapCommand } from './minimap.ts'
import { loadProps } from './props.ts'
import { Stage, cameraYaw } from './stage.ts'
import { Particles } from './particles.ts'
import { ShotLayer } from './shots.ts'
import { TILE_TOP } from './terrain.ts'
import { buildSurface } from './island.ts'
import { createUnitMesh, releaseMesh, scorchUnit, syncUnitMesh, unitSpan } from './units/vehicle.ts'

const WRECK_HOLD = 4
const WRECK_SINK = 1.6

type Wreck = {
  group: Group
  age: number
  baseY: number
  drop: number
}

export class GameView {
  private readonly stage: Stage
  private readonly status: HTMLElement
  private readonly units = new Map<number, Group>()
  private readonly selectionRings: Mesh[] = []
  private readonly hoverRings: Mesh[] = []
  private readonly orderRings: Mesh[] = []
  private readonly rangeRings: Mesh[] = []
  private readonly sightRings: Mesh[] = []
  private readonly rangeMark: Mesh
  private readonly sightMark: Mesh
  private showRanges = false
  private hoveredIds: number[] = []
  private boxPreview = false
  private minimap: Minimap | null = null
  private cities: CityLayer | null = null
  private props: Group | null = null
  private fog: Fog | null = null
  private surface: Group | null = null
  private propsEpoch = -1
  private readonly placement: Mesh[] = []
  private readonly shots: ShotLayer
  private readonly particles: Particles
  private readonly wrecks: Wreck[] = []
  private readonly pings: { mesh: Mesh; age: number }[] = []
  private readonly primaryMark: Sprite
  private readonly rallyMark: Group
  private shotDt = 0
  private pendingCleared: readonly TileCoord[] = []

  constructor(canvas: HTMLCanvasElement, status: HTMLElement, mapWidth: number, mapHeight: number) {
    this.status = status
    this.stage = new Stage(canvas, mapWidth, mapHeight)
    this.shots = new ShotLayer(this.stage.scene)
    this.particles = new Particles(this.stage.scene)
    this.rangeMark = new Mesh(
      new RingGeometry(0.86, 1, 72),
      new MeshBasicMaterial({
        color: 0xd64545,
        transparent: true,
        opacity: 0.8,
        side: DoubleSide,
        depthWrite: false,
      }),
    )
    this.rangeMark.rotation.x = -Math.PI / 2
    this.rangeMark.visible = false
    this.sightMark = new Mesh(
      new RingGeometry(0.94, 1, 72),
      new MeshBasicMaterial({
        color: 0xf6f1dc,
        transparent: true,
        opacity: 0.35,
        side: DoubleSide,
        depthWrite: false,
      }),
    )
    this.sightMark.rotation.x = -Math.PI / 2
    this.sightMark.visible = false
    this.primaryMark = primaryIcon()
    this.stage.scene.add(this.primaryMark)
    this.rallyMark = rallyFlag()
    this.stage.scene.add(this.rallyMark)
  }

  mountTerrain(world: WorldSnapshot) {
    const root = document.querySelector<HTMLElement>('#minimap')
    const map = document.querySelector<HTMLCanvasElement>('#minimap-map')
    const marks = document.querySelector<HTMLCanvasElement>('#minimap-marks')
    this.fog = new Fog(this.stage.scene, world.width, world.height)
    const sea = new Mesh(
      new PlaneGeometry(world.width, world.height),
      new MeshStandardMaterial({ color: new Color(0x7fcee8), roughness: 0.4, metalness: 0 }),
    )
    sea.rotation.x = -Math.PI / 2
    sea.position.set(world.width / 2, 0, world.height / 2)
    this.stage.scene.add(sea)
    this.presentSurface(world)
    if (root && map && marks) {
      this.minimap = new Minimap(root, map, marks, world, (x, z) => this.focus(x, z))
    }
    this.cities = new CityLayer()
    void this.cities.load().then(() => this.stage.scene.add(this.cities!.root))
    this.noteProps(world)
  }

  noteMap(world: WorldSnapshot, layouts: readonly (CityLayout | null)[]) {
    this.presentSurface(world)
    this.minimap?.retile(world, layouts)
    this.cities?.present(layouts, this.pendingCities)
    this.noteProps(world)
  }

  private presentSurface(world: WorldSnapshot) {
    if (this.surface) {
      this.stage.scene.remove(this.surface)
      disposeGroup(this.surface)
    }
    this.surface = buildSurface(world)
    this.stage.scene.add(this.surface)
  }

  private noteProps(world: WorldSnapshot) {
    const epoch = knownStamp(world)
    if (epoch === this.propsEpoch) return
    this.propsEpoch = epoch
    void loadProps(world).then((props) => {
      if (this.propsEpoch !== epoch) return
      if (this.props) this.stage.scene.remove(this.props)
      this.props = props
      this.stage.scene.add(props)
      this.clearGround(this.pendingCleared, false)
    })
  }

  private pendingCities: readonly (CityState | null)[] = []

  private ownedCitySights(playerId: number, states: readonly (CityState | null)[], layouts: readonly (CityLayout | null)[]) {
    const sights = []
    for (let index = 0; index < layouts.length; index++) {
      const state = states[index]
      const layout = layouts[index]
      if (!state || !layout || state.ownerId !== playerId) continue
      sights.push({ ownerId: playerId, ...citySightOrigin(layout) })
    }
    return sights
  }

  focus(x: number, z: number) {
    this.stage.focus(x, z)
  }

  resize() {
    this.stage.resize()
  }

  forgetVision() {
    this.fog?.reset()
  }

  setMinimapCommand(command: MinimapCommand) {
    this.minimap?.setCommand(command)
  }

  setMinimapHover(hover: (tile: TileCoord | null) => void) {
    this.minimap?.setHover(hover)
  }

  dispose() {
    this.minimap?.dispose()
    const material = this.primaryMark.material
    material.map?.dispose()
    material.dispose()
    this.stage.dispose()
  }

  setPanAxis(x: number, z: number) {
    this.stage.setPanAxis(x, z)
  }

  nudgeYaw(direction: number) {
    this.stage.nudgeYaw(direction)
  }

  update(dt: number) {
    this.shotDt = dt
    this.stage.update(dt)
  }

  panByPixels(fromX: number, fromY: number, toX: number, toY: number) {
    this.stage.panByPixels(fromX, fromY, toX, toY)
  }

  setZoomCursor(clientX: number, clientY: number) {
    this.stage.setZoomCursor(clientX, clientY)
  }

  zoomAt(deltaY: number, clientX: number, clientY: number) {
    this.stage.zoomAt(deltaY, clientX, clientY)
  }

  setHovered(ids: readonly number[]) {
    this.hoveredIds = [...ids]
  }

  setBoxPreview(active: boolean) {
    this.boxPreview = active
  }

  setShowRanges(on: boolean) {
    this.showRanges = on
  }

  showPlacement(cells: readonly { x: number; y: number; open: boolean }[] | null) {
    const list = cells ?? []
    while (this.placement.length < list.length) {
      const mesh = new Mesh(
        new PlaneGeometry(0.92, 0.92),
        new MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }),
      )
      mesh.rotation.x = -Math.PI / 2
      mesh.renderOrder = 4
      this.stage.scene.add(mesh)
      this.placement.push(mesh)
    }
    for (let i = 0; i < this.placement.length; i++) {
      const mesh = this.placement[i]
      const cell = list[i]
      mesh.visible = cell !== undefined
      if (!cell) continue
      mesh.position.set(cell.x + 0.5, TILE_TOP + 0.09, cell.y + 0.5)
      const material = mesh.material
      if (material instanceof MeshBasicMaterial) material.color.set(cell.open ? 0x3cde73 : 0xd64545)
    }
  }

  unitsInRect(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    units: readonly UnitSnapshot[],
    ownerId: number | null,
  ): number[] {
    const left = Math.min(x0, x1)
    const right = Math.max(x0, x1)
    const top = Math.min(y0, y1)
    const bottom = Math.max(y0, y1)
    const hits: number[] = []
    for (const unit of units) {
      if (unit.ownerId !== ownerId || UNIT_TYPES[unit.typeId].topSpeed <= 0) continue
      const center = this.stage.project(unit.x, unit.z)
      const mesh = this.units.get(unit.id)
      const span = mesh ? unitSpan(mesh) : 0.7
      const edge = this.stage.project(unit.x + span / 2, unit.z)
      const radius = Math.max(6, Math.hypot(edge.x - center.x, edge.y - center.y))
      if (circleHitsRect(center.x, center.y, radius, left, top, right, bottom)) hits.push(unit.id)
    }
    return hits
  }

  pickUnit(clientX: number, clientY: number): number | null {
    return this.stage.pickUnit([...this.units.values()], clientX, clientY)
  }

  pickTile(clientX: number, clientY: number): TileCoord | null {
    return this.stage.pickTile(clientX, clientY)
  }

  ping(x: number, z: number, attack: boolean) {
    const mesh = new Mesh(
      new RingGeometry(0.34, 0.5, 28),
      new MeshBasicMaterial({
        color: attack ? 0xd64545 : 0x3cde73,
        transparent: true,
        opacity: 1,
        side: DoubleSide,
        depthWrite: false,
      }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, TILE_TOP + 0.07, z)
    this.stage.scene.add(mesh)
    this.pings.push({ mesh, age: 0 })
  }

  render(
    units: readonly UnitSnapshot[],
    selected: readonly UnitSnapshot[],
    shots: readonly ShotEvent[] = [],
    hits: readonly ShotHit[] = [],
    playerId: number | null = null,
    cities: readonly (CityState | null)[] = [],
    layouts: readonly (CityLayout | null)[] = [],
    primaryFactoryId = 0,
    rally: TileCoord | null = null,
    cleared: readonly TileCoord[] = [],
    yields: readonly MapPoint[] = [],
  ) {
    for (const unit of units) {
      if (unit.health > 0) continue
      const group = this.units.get(unit.id)
      if (!group) continue
      this.wreck(group)
      this.units.delete(unit.id)
    }
    const living = units.filter((unit) => unit.health > 0)
    const alive = new Set(living.map((unit) => unit.id))
    for (const [id, group] of this.units) {
      if (alive.has(id)) continue
      releaseMesh(group)
      this.units.delete(id)
    }
    this.advanceWrecks(this.shotDt)
    this.advancePings(this.shotDt)
    const selectedIds = new Set(selected.map((unit) => unit.id))
    for (const unit of living) {
      let group = this.units.get(unit.id)
      const stage = buildStage(unit.progress)
      const built = UNIT_TYPES[unit.typeId].topSpeed <= 0
      if (group && built && group.userData.stage !== stage) {
        releaseMesh(group)
        this.units.delete(unit.id)
        group = undefined
      }
      if (!group) {
        group = createUnitMesh(unit)
        this.units.set(unit.id, group)
        this.stage.scene.add(group)
      }
      syncUnitMesh(group, unit, selectedIds.has(unit.id))
    }

    const showSelection = !this.boxPreview
    this.placeRings(this.selectionRings, this.stage.selection, showSelection ? selected : [])
    const showRanges = showSelection && this.showRanges && selected.length === 1
    this.placeRanges(showRanges ? selected : [])
    const goals = showSelection ? selected.filter((unit) => unit.goal !== null) : []
    this.placeOrders(goals)
    this.placePrimary(living, primaryFactoryId)
    this.placeRally(rally)

    if (selected.length === 1) {
      const unit = selected[0]
      const moving = unit.goal ? ' · moving' : ''
      const label = UNIT_TYPES[unit.typeId].label
      const factory =
        unit.typeId === UnitTypeId.Factory
          ? unit.id === primaryFactoryId
            ? ' · primary'
            : ' · click again for primary'
          : ''
      const waypoint =
        unit.typeId === UnitTypeId.Factory
          ? rally
            ? ` · waypoint ${rally.x},${rally.y}`
            : ' · click ground for a waypoint'
          : ''
      this.status.textContent = `${label} ${unit.id} · tile ${unit.tileX},${unit.tileY}${moving}${factory}${waypoint}`
    } else if (selected.length > 1) {
      this.status.textContent = `${selected.length} selected`
    } else {
      this.status.textContent = 'No unit selected'
    }

    const hovered = this.hoveredIds.flatMap((id) => {
      if (!this.boxPreview && selectedIds.has(id)) return []
      const unit = living.find((candidate) => candidate.id === id)
      return unit ? [unit] : []
    })
    this.placeRings(this.hoverRings, this.stage.hover, hovered)

    for (const drop of yields) this.particles.collect(drop.x, drop.y)
    const impact = (x: number, z: number, kind: WeaponKind) => this.particles.hit(x, z, kind)
    this.shots.spawn(shots)
    this.shots.strike(hits, impact)
    this.shots.advance(this.shotDt, impact)
    this.particles.advance(this.shotDt)
    this.pendingCities = cities
    const friends = playerId === null ? [] : friendsOf(living, playerId, this.ownedCitySights(playerId, cities, layouts))
    this.fog?.update(this.shotDt, friends)
    this.fog?.setView(cameraYaw)
    this.cities?.present(layouts, cities)
    this.clearGround(cleared)
    this.minimap?.draw(living, selectedIds, this.stage.groundViewport(), this.fog?.mask, cities, primaryFactoryId, rally)
    this.stage.draw()
  }

  private clearGround(tiles: readonly TileCoord[], burst = true) {
    this.pendingCleared = tiles
    const props = this.props
    if (!props || tiles.length === 0) return
    const gone = new Set(tiles.map((tile) => `${tile.x},${tile.y}`))
    for (const child of [...props.children]) {
      if (child.userData.tree !== true) continue
      if (!gone.has(`${child.userData.tileX},${child.userData.tileY}`)) continue
      if (burst) this.particles.fell(child.position.x, child.position.z)
      props.remove(child)
    }
  }

  private wreck(group: Group) {
    const bodyHeight = group.userData.bodyHeight
    const height = typeof bodyHeight === 'number' ? bodyHeight : 0.5
    scorchUnit(group)
    this.particles.explosion(group.position.x, group.position.y, group.position.z)
    this.wrecks.push({
      group,
      age: 0,
      baseY: group.position.y,
      drop: height + 0.28,
    })
  }

  private advanceWrecks(dt: number) {
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const wreck = this.wrecks[i]
      wreck.age += dt
      if (wreck.age <= WRECK_HOLD) continue
      const t = Math.min(1, (wreck.age - WRECK_HOLD) / WRECK_SINK)
      wreck.group.position.y = wreck.baseY - wreck.drop * t * t
      if (t < 1) continue
      releaseMesh(wreck.group)
      this.wrecks.splice(i, 1)
    }
  }

  private advancePings(dt: number) {
    const life = 0.42
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const ping = this.pings[i]
      ping.age += dt
      const t = ping.age / life
      if (t >= 1) {
        ping.mesh.removeFromParent()
        ping.mesh.geometry.dispose()
        const material = ping.mesh.material
        if (material instanceof MeshBasicMaterial) material.dispose()
        this.pings.splice(i, 1)
        continue
      }
      const bounce = Math.sin(Math.min(t * 1.15, 1) * Math.PI)
      ping.mesh.scale.setScalar(0.25 + bounce * 1.25)
      const material = ping.mesh.material
      if (material instanceof MeshBasicMaterial) material.opacity = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6
    }
  }

  private placeRings(pool: Mesh[], source: Mesh, units: readonly UnitSnapshot[]) {
    source.visible = false
    const rings = growRings(pool, source, units.length, this.stage.scene)
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i]
      const unit = units[i]
      if (!unit) {
        ring.visible = false
        continue
      }
      ring.visible = true
      placeRing(ring, unit, this.units.get(unit.id))
    }
  }

  private placeRanges(units: readonly UnitSnapshot[]) {
    const ready = units.filter((unit) => unit.progress >= 1)
    this.placeDistance(
      this.sightRings,
      this.sightMark,
      ready.flatMap((unit) => {
        const sight = UNIT_TYPES[unit.typeId].weapon.sight
        return sight > 0 ? [{ unit, radius: sight }] : []
      }),
      0.06,
      TILE_TOP + 0.065,
    )
    this.placeDistance(
      this.rangeRings,
      this.rangeMark,
      ready.flatMap((unit) => {
        const weapon = UNIT_TYPES[unit.typeId].weapon
        return weapon.damage > 0 && weapon.range > 0 ? [{ unit, radius: weapon.range }] : []
      }),
      0.14,
      TILE_TOP + 0.07,
    )
  }

  private placeDistance(
    pool: Mesh[],
    source: Mesh,
    marks: readonly { unit: UnitSnapshot; radius: number }[],
    band: number,
    y: number,
  ) {
    const rings = growRings(pool, source, marks.length, this.stage.scene)
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i]
      const mark = marks[i]
      if (!mark) {
        ring.visible = false
        continue
      }
      if (ring.userData.range !== mark.radius) {
        const next = new RingGeometry(Math.max(0.05, mark.radius - band), mark.radius, 80)
        if (ring.geometry !== source.geometry) ring.geometry.dispose()
        ring.geometry = next
        ring.userData.range = mark.radius
      }
      ring.visible = true
      ring.scale.set(1, 1, 1)
      ring.position.set(mark.unit.x, y, mark.unit.z)
    }
  }

  private placePrimary(units: readonly UnitSnapshot[], primaryFactoryId: number) {
    const factory = units.find((unit) => unit.id === primaryFactoryId && unit.typeId === UnitTypeId.Factory)
    this.primaryMark.visible = factory !== undefined
    if (!factory) return
    this.primaryMark.position.set(factory.x, TILE_TOP + 2.6, factory.z)
  }

  private placeRally(rally: TileCoord | null) {
    this.rallyMark.visible = rally !== null
    if (!rally) return
    this.rallyMark.position.set(rally.x + 0.5, TILE_TOP, rally.y + 0.5)
  }

  private placeOrders(units: readonly UnitSnapshot[]) {
    this.stage.orderMark.visible = false
    const rings = growRings(this.orderRings, this.stage.orderMark, units.length, this.stage.scene)
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i]
      const goal = units[i]?.goal
      if (!goal) {
        ring.visible = false
        continue
      }
      ring.visible = true
      ring.scale.set(1, 1, 1)
      ring.position.set(goal.x + 0.5, TILE_TOP + 0.06, goal.y + 0.5)
    }
  }
}

function growRings(pool: Mesh[], source: Mesh, count: number, scene: { add(mesh: Mesh): void }): Mesh[] {
  while (pool.length < count) {
    const mesh = source.clone()
    mesh.visible = false
    scene.add(mesh)
    pool.push(mesh)
  }
  return pool
}

function disposeGroup(group: Group) {
  const materials = new Set<{ dispose(): void }>()
  group.traverse((child) => {
    const mesh = child as Mesh
    mesh.geometry?.dispose()
    const material = mesh.material as { dispose(): void } | { dispose(): void }[] | undefined
    if (!material) return
    if (Array.isArray(material)) for (const item of material) materials.add(item)
    else materials.add(material)
  })
  for (const material of materials) material.dispose()
}

function knownStamp(world: WorldSnapshot): number {
  let count = 0
  for (const bit of world.known) count += bit
  return count
}

function circleHitsRect(
  cx: number,
  cy: number,
  radius: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  const nearestX = Math.min(right, Math.max(left, cx))
  const nearestY = Math.min(bottom, Math.max(top, cy))
  const dx = cx - nearestX
  const dy = cy - nearestY
  return dx * dx + dy * dy <= radius * radius
}

function primaryIcon(): Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.translate(32, 32)
    ctx.beginPath()
    starPath(ctx, 5, 26, 11)
    ctx.fillStyle = '#f0d060'
    ctx.fill()
    ctx.lineWidth = 4
    ctx.strokeStyle = '#1a1e12'
    ctx.stroke()
  }
  const material = new SpriteMaterial({
    map: new CanvasTexture(canvas),
    transparent: true,
    depthWrite: false,
  })
  const sprite = new Sprite(material)
  sprite.scale.set(1.5, 1.5, 1)
  sprite.visible = false
  return sprite
}

function rallyFlag(): Group {
  const group = new Group()
  const pole = new Mesh(
    new BoxGeometry(0.06, 1.1, 0.06),
    new MeshBasicMaterial({ color: 0xe7efe0 }),
  )
  pole.position.y = 0.55
  const flag = new Mesh(
    new PlaneGeometry(0.62, 0.38),
    new MeshBasicMaterial({ color: 0xf0d060, side: DoubleSide }),
  )
  flag.position.set(0.34, 0.9, 0)
  group.add(pole, flag)
  group.visible = false
  return group
}

function starPath(ctx: CanvasRenderingContext2D, spikes: number, outer: number, inner: number) {
  let rot = -Math.PI / 2
  const step = Math.PI / spikes
  ctx.moveTo(Math.cos(rot) * outer, Math.sin(rot) * outer)
  for (let i = 0; i < spikes; i++) {
    rot += step
    ctx.lineTo(Math.cos(rot) * inner, Math.sin(rot) * inner)
    rot += step
    ctx.lineTo(Math.cos(rot) * outer, Math.sin(rot) * outer)
  }
  ctx.closePath()
}

function placeRing(ring: Mesh, unit: UnitSnapshot, mesh: Group | undefined) {
  const span = mesh ? unitSpan(mesh) : 0.7
  ring.scale.set(span / 0.72, span / 0.72, 1)
  ring.position.set(unit.x, TILE_TOP + 0.06, unit.z)
}
