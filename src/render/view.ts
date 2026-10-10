import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Plane,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import type { TileCoord } from '../map/grid.ts'
import { UNIT_TYPES } from '../units/types.ts'
import type { Unit } from '../units/unit.ts'
import type { World } from '../game/world.ts'

const TILE_TOP = 0.08
const PITCH = (50 * Math.PI) / 180
const CAM_DIST = 36
const PAN_SPEED = 14

const CLEAR_A = new Color(0x667844)
const CLEAR_B = new Color(0x5c703c)
const OBSTACLE = new Color(0x3a342e)
const PLAYER = new Color(0x8d9a3c)
const PARKED = new Color(0x6e675c)

export class GameView {
  private readonly canvas: HTMLCanvasElement
  private readonly status: HTMLElement
  private readonly mapWidth: number
  private readonly mapHeight: number
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera: OrthographicCamera
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0)
  private readonly look: Vector3
  private readonly hit = new Vector3()
  private readonly units = new Map<number, Group>()
  private readonly selection: Mesh
  private readonly orderMark: Mesh
  private axisX = 0
  private axisZ = 0

  constructor(
    canvas: HTMLCanvasElement,
    status: HTMLElement,
    mapWidth: number,
    mapHeight: number,
  ) {
    this.canvas = canvas
    this.status = status
    this.mapWidth = mapWidth
    this.mapHeight = mapHeight
    this.renderer = new WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(0x1a1e12)

    const aspect = 1
    this.camera = new OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 400)
    this.look = new Vector3(mapWidth / 2, 0, mapHeight / 2)
    this.syncCamera()

    this.scene.add(new AmbientLight(0xffffff, 0.62))
    const sun = new DirectionalLight(0xfff2d8, 1.25)
    sun.position.set(18, 28, 10)
    this.scene.add(sun)

    const ring = new RingGeometry(0.46, 0.62, 28)
    this.selection = new Mesh(
      ring,
      new MeshBasicMaterial({ color: 0xf0d060, side: DoubleSide }),
    )
    this.selection.rotation.x = -Math.PI / 2
    this.selection.visible = false
    this.scene.add(this.selection)

    this.orderMark = new Mesh(
      new RingGeometry(0.28, 0.4, 24),
      new MeshBasicMaterial({ color: 0xe7efe0, side: DoubleSide }),
    )
    this.orderMark.rotation.x = -Math.PI / 2
    this.orderMark.visible = false
    this.scene.add(this.orderMark)

    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  buildTerrain(world: World) {
    const count = world.map.width * world.map.height
    const mesh = new InstancedMesh(
      new BoxGeometry(0.98, TILE_TOP, 0.98),
      new MeshStandardMaterial({ roughness: 0.92, metalness: 0 }),
      count,
    )
    const dummy = new Object3D()
    let i = 0
    for (let y = 0; y < world.map.height; y++) {
      for (let x = 0; x < world.map.width; x++) {
        dummy.position.set(x + 0.5, TILE_TOP / 2, y + 0.5)
        dummy.rotation.set(0, 0, 0)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        const terrain = world.map.get(x, y).terrain
        const color =
          terrain === 'obstacle' ? OBSTACLE : (x + y) % 2 === 0 ? CLEAR_A : CLEAR_B
        mesh.setColorAt(i, color)
        i++
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    this.scene.add(mesh)
  }

  setPanAxis(x: number, z: number) {
    this.axisX = x
    this.axisZ = z
  }

  update(dt: number) {
    if (this.axisX === 0 && this.axisZ === 0) return
    const len = Math.hypot(this.axisX, this.axisZ)
    this.moveLook((this.axisX / len) * PAN_SPEED * dt, (this.axisZ / len) * PAN_SPEED * dt)
  }

  panByPixels(fromX: number, fromY: number, toX: number, toY: number) {
    const from = this.groundAt(fromX, fromY)
    const to = this.groundAt(toX, toY)
    if (!from || !to) return
    this.moveLook(from.x - to.x, from.z - to.z)
  }

  zoomAt(deltaY: number) {
    const factor = deltaY > 0 ? 0.9 : 1.1
    this.camera.zoom = clamp(this.camera.zoom * factor, 0.55, 2.8)
    this.camera.updateProjectionMatrix()
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    if (width === 0 || height === 0) return
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setSize(width, height, false)
    const viewHeight = 22
    const aspect = width / height
    this.camera.left = (-viewHeight * aspect) / 2
    this.camera.right = (viewHeight * aspect) / 2
    this.camera.top = viewHeight / 2
    this.camera.bottom = -viewHeight / 2
    this.camera.updateProjectionMatrix()
  }

  pickUnit(clientX: number, clientY: number): number | null {
    this.aim(clientX, clientY)
    const roots = [...this.units.values()]
    const hits = this.raycaster.intersectObjects(roots, true)
    for (const hit of hits) {
      let obj: Object3D | null = hit.object
      while (obj) {
        if (typeof obj.userData.unitId === 'number') return obj.userData.unitId
        obj = obj.parent
      }
    }
    return null
  }

  pickTile(clientX: number, clientY: number): TileCoord | null {
    const point = this.groundAt(clientX, clientY)
    if (!point) return null
    const tile = { x: Math.floor(point.x), y: Math.floor(point.z) }
    if (tile.x < 0 || tile.y < 0 || tile.x >= this.mapWidth || tile.y >= this.mapHeight) {
      return null
    }
    return tile
  }

  render(world: World) {
    for (const unit of world.units) {
      let group = this.units.get(unit.id)
      if (!group) {
        group = this.makeTank(unit)
        this.units.set(unit.id, group)
        this.scene.add(group)
      }
      const bodyHeight = 0.36
      group.position.set(unit.pos.x, TILE_TOP + bodyHeight / 2, unit.pos.z)
      group.rotation.y = unit.facing
      const selected = unit.selected
      group.traverse((obj) => {
        const material = obj instanceof Mesh ? obj.material : null
        if (material instanceof MeshStandardMaterial) {
          material.emissive.set(selected ? 0x3a2e10 : 0x000000)
          material.emissiveIntensity = selected ? 0.45 : 0
        }
      })
    }

    const selected = world.selected()
    this.selection.visible = selected !== null
    if (selected) {
      this.selection.position.set(selected.pos.x, TILE_TOP + 0.02, selected.pos.z)
      const dest = selected.path[selected.path.length - 1]
      this.orderMark.visible = dest !== undefined
      if (dest) this.orderMark.position.set(dest.x + 0.5, TILE_TOP + 0.02, dest.y + 0.5)
      const moving = selected.path.length > 0 ? ' · moving' : ''
      this.status.textContent = `Tank ${selected.id} · tile ${selected.tile.x},${selected.tile.y}${moving}`
    } else {
      this.orderMark.visible = false
      this.status.textContent = 'No unit selected'
    }

    this.renderer.render(this.scene, this.camera)
  }

  private makeTank(unit: Unit): Group {
    const type = UNIT_TYPES[unit.typeId]
    if (type.body !== 'mesh') {
      throw new Error(`no view for body ${type.body}`)
    }
    const color = unit.id === 1 ? PLAYER : PARKED
    const material = new MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.18,
    })
    const body = new Mesh(new BoxGeometry(0.62, 0.36, 0.82), material)
    const turret = new Mesh(new BoxGeometry(0.36, 0.2, 0.36), material)
    turret.position.set(0, 0.26, -0.04)
    const barrel = new Mesh(new BoxGeometry(0.1, 0.1, 0.36), material)
    barrel.position.set(0, 0.26, 0.34)
    const group = new Group()
    group.add(body, turret, barrel)
    group.userData.unitId = unit.id
    return group
  }

  private aim(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
  }

  private groundAt(clientX: number, clientY: number): Vector3 | null {
    this.aim(clientX, clientY)
    return this.raycaster.ray.intersectPlane(this.ground, this.hit) ? this.hit.clone() : null
  }

  private moveLook(dx: number, dz: number) {
    this.look.x = clamp(this.look.x + dx, 0, this.mapWidth)
    this.look.z = clamp(this.look.z + dz, 0, this.mapHeight)
    this.syncCamera()
  }

  private syncCamera() {
    this.camera.position.set(
      this.look.x,
      Math.sin(PITCH) * CAM_DIST,
      this.look.z + Math.cos(PITCH) * CAM_DIST,
    )
    this.camera.lookAt(this.look)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
