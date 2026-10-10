import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry } from 'three'
import type { ShotEvent, UnitSnapshot, WorldSnapshot } from '../../shared/protocol.ts'
import { UNIT_TYPES, buildStage, type WeaponKind } from '../../shared/unit-types.ts'
import type { SightSource } from '../../shared/vision.ts'
import type { TileCoord } from '../../shared/tiles.ts'
import { Fog } from './fog.ts'
import { buildIsland } from './island.ts'
import { Minimap } from './minimap.ts'
import { loadProps } from './props.ts'
import { Stage } from './stage.ts'
import { Particles } from './particles.ts'
import { ShotLayer } from './shots.ts'
import { TILE_TOP, buildTerrain } from './terrain.ts'
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
  private hoveredIds: number[] = []
  private boxPreview = false
  private minimap: Minimap | null = null
  private fog: Fog | null = null
  private readonly placement: Mesh[] = []
  private readonly shots: ShotLayer
  private readonly particles: Particles
  private readonly wrecks: Wreck[] = []
  private readonly pings: { mesh: Mesh; age: number }[] = []
  private shotDt = 0

  constructor(canvas: HTMLCanvasElement, status: HTMLElement, mapWidth: number, mapHeight: number) {
    this.status = status
    this.stage = new Stage(canvas, mapWidth, mapHeight)
    this.shots = new ShotLayer(this.stage.scene)
    this.particles = new Particles(this.stage.scene)
  }

  mountTerrain(world: WorldSnapshot) {
    const root = document.querySelector<HTMLElement>('#minimap')
    const map = document.querySelector<HTMLCanvasElement>('#minimap-map')
    const marks = document.querySelector<HTMLCanvasElement>('#minimap-marks')
    this.fog = new Fog(this.stage.scene, world.width, world.height)
    if (world.coast.length > 0) {
      this.stage.scene.add(buildIsland(world))
      if (root && map && marks) {
        this.minimap = new Minimap(root, map, marks, world, (x, z) => this.focus(x, z))
      }
      void loadProps(world).then((props) => this.stage.scene.add(props))
      return
    }
    if (root) root.hidden = true
    this.stage.scene.add(buildTerrain(world))
  }

  focus(x: number, z: number) {
    this.stage.focus(x, z)
  }

  setPanAxis(x: number, z: number) {
    this.stage.setPanAxis(x, z)
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
    playerId: number | null = null,
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
      const built = UNIT_TYPES[unit.typeId].buildTime > 0
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
    const goals = showSelection ? selected.filter((unit) => unit.goal !== null) : []
    this.placeOrders(goals)

    if (selected.length === 1) {
      const unit = selected[0]
      const moving = unit.goal ? ' · moving' : ''
      const label = UNIT_TYPES[unit.typeId].label
      this.status.textContent = `${label} ${unit.id} · tile ${unit.tileX},${unit.tileY}${moving}`
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

    const impact = (x: number, z: number, kind: WeaponKind) => this.particles.hit(x, z, kind)
    this.shots.spawn(shots, impact)
    this.shots.advance(this.shotDt, impact)
    this.particles.advance(this.shotDt)
    const friends: SightSource[] = []
    if (playerId !== null) {
      for (const unit of living) {
        if (unit.ownerId !== playerId || unit.progress < 1) continue
        const sight = UNIT_TYPES[unit.typeId].weapon.sight
        if (sight <= 0) continue
        friends.push({ x: unit.x, z: unit.z, sight })
      }
    }
    this.fog?.update(this.shotDt, friends)
    this.minimap?.draw(living, selectedIds, this.stage.groundViewport(), this.fog?.mask)
    this.stage.draw()
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

function placeRing(ring: Mesh, unit: UnitSnapshot, mesh: Group | undefined) {
  const span = mesh ? unitSpan(mesh) : 0.7
  ring.scale.set(span / 0.72, span / 0.72, 1)
  ring.position.set(unit.x, TILE_TOP + 0.06, unit.z)
}
