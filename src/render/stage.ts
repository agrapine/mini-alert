import {
  AmbientLight,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
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
import type { TileCoord } from '../map/map.ts'

const PITCH = (50 * Math.PI) / 180
const CAM_DIST = 36
const PAN_SPEED = 14

export class Stage {
  readonly scene = new Scene()
  readonly selection: Mesh
  readonly orderMark: Mesh
  private readonly canvas: HTMLCanvasElement
  private readonly mapWidth: number
  private readonly mapHeight: number
  private readonly renderer: WebGLRenderer
  private readonly camera: OrthographicCamera
  private readonly raycaster = new Raycaster()
  private readonly pointer = new Vector2()
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0)
  private readonly look: Vector3
  private readonly hit = new Vector3()
  private axisX = 0
  private axisZ = 0

  constructor(canvas: HTMLCanvasElement, mapWidth: number, mapHeight: number) {
    this.canvas = canvas
    this.mapWidth = mapWidth
    this.mapHeight = mapHeight
    this.renderer = new WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(0x1a1e12)
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
    this.look = new Vector3(mapWidth / 2, 0, mapHeight / 2)
    this.syncCamera()

    this.scene.add(new AmbientLight(0xffffff, 0.62))
    const sun = new DirectionalLight(0xfff2d8, 1.25)
    sun.position.set(18, 28, 10)
    this.scene.add(sun)

    this.selection = new Mesh(
      new RingGeometry(0.46, 0.62, 28),
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

  pickUnit(roots: readonly Object3D[], clientX: number, clientY: number): number | null {
    this.aim(clientX, clientY)
    const hits = this.raycaster.intersectObjects(roots as Object3D[], true)
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
    if (tile.x < 0 || tile.y < 0 || tile.x >= this.mapWidth || tile.y >= this.mapHeight) return null
    return tile
  }

  draw() {
    this.renderer.render(this.scene, this.camera)
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
