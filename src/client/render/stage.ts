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
import type { TileCoord } from '../../shared/tiles.ts'

export const PITCH = (50 * Math.PI) / 180
const YAW_STEP = Math.PI / 4
export let cameraYaw = YAW_STEP
const CAM_DIST = 36
const PAN_SPEED = 14
const YAW_EASE_SECONDS = 0.16
const ZOOM_MIN = 0.25
const ZOOM_MAX = 4
const ZOOM_PER_PIXEL = 0.005
const ZOOM_EASE_SECONDS = 0.15

export class Stage {
  readonly scene = new Scene()
  readonly selection: Mesh
  readonly hover: Mesh
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
  private readonly projected = new Vector3()
  private axisX = 0
  private axisZ = 0
  private edgeX = 0
  private edgeZ = 0
  private bearing = YAW_STEP
  private bearingTarget = YAW_STEP
  private zoomTarget = 1
  private zoomCursor: { x: number; y: number } | null = null
  private readonly onResize = () => this.resize()

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

    this.hover = new Mesh(
      new RingGeometry(0.52, 0.58, 28),
      new MeshBasicMaterial({ color: 0xf6f1dc, side: DoubleSide }),
    )
    this.hover.rotation.x = -Math.PI / 2
    this.hover.visible = false
    this.scene.add(this.hover)

    this.orderMark = new Mesh(
      new RingGeometry(0.28, 0.4, 24),
      new MeshBasicMaterial({ color: 0xe7efe0, side: DoubleSide }),
    )
    this.orderMark.rotation.x = -Math.PI / 2
    this.orderMark.visible = false
    this.scene.add(this.orderMark)

    this.resize()
    window.addEventListener('resize', this.onResize)
  }

  dispose() {
    window.removeEventListener('resize', this.onResize)
    this.scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      obj.geometry.dispose()
      const material = obj.material
      if (Array.isArray(material)) {
        for (const item of material) item.dispose()
      } else {
        material.dispose()
      }
    })
    this.renderer.dispose()
  }

  groundViewport(): { x: number; z: number }[] {
    const corners: { x: number; z: number }[] = []
    const ndc: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
    for (const [x, y] of ndc) {
      this.pointer.set(x, y)
      this.raycaster.setFromCamera(this.pointer, this.camera)
      if (!this.raycaster.ray.intersectPlane(this.ground, this.hit)) return []
      corners.push({ x: this.hit.x, z: this.hit.z })
    }
    return corners
  }

  focus(x: number, z: number) {
    this.look.set(clamp(x, 0, this.mapWidth), 0, clamp(z, 0, this.mapHeight))
    this.syncCamera()
  }

  setPanAxis(x: number, z: number) {
    this.axisX = x
    this.axisZ = z
  }

  setEdgePan(x: number, z: number) {
    this.edgeX = x
    this.edgeZ = z
  }

  nudgeYaw(direction: number) {
    this.bearingTarget += direction * YAW_STEP
  }

  update(dt: number) {
    const gap = this.bearingTarget - this.bearing
    if (Math.abs(gap) > 0.0004) {
      const t = Math.min(1, dt / YAW_EASE_SECONDS)
      this.bearing += gap * easeOutCubic(t)
      cameraYaw = this.bearing
      this.syncCamera()
    } else if (this.bearing !== this.bearingTarget) {
      this.bearing = this.bearingTarget
      cameraYaw = this.bearing
      this.syncCamera()
    }
    const panX = this.axisX + this.edgeX
    const panZ = this.axisZ + this.edgeZ
    if (panX !== 0 || panZ !== 0) {
      const len = Math.hypot(panX, panZ)
      const speed = (PAN_SPEED / this.camera.zoom) * dt
      const rightX = Math.cos(this.bearing)
      const rightZ = -Math.sin(this.bearing)
      const backX = Math.sin(this.bearing)
      const backZ = Math.cos(this.bearing)
      const x = panX / len
      const z = panZ / len
      this.moveLook((x * rightX + z * backX) * speed, (x * rightZ + z * backZ) * speed)
    }
    this.easeZoom(dt)
  }

  panByPixels(fromX: number, fromY: number, toX: number, toY: number) {
    const from = this.groundAt(fromX, fromY)
    const to = this.groundAt(toX, toY)
    if (!from || !to) return
    this.moveLook(from.x - to.x, from.z - to.z)
  }

  setZoomCursor(clientX: number, clientY: number) {
    this.zoomCursor = { x: clientX, y: clientY }
  }

  zoomAt(deltaY: number, clientX: number, clientY: number) {
    this.setZoomCursor(clientX, clientY)
    this.zoomTarget = clamp(this.zoomTarget * Math.exp(-deltaY * ZOOM_PER_PIXEL), ZOOM_MIN, ZOOM_MAX)
  }

  private easeZoom(dt: number) {
    const current = this.camera.zoom
    const gap = this.zoomTarget - current
    if (Math.abs(gap) < 0.0004) {
      if (current !== this.zoomTarget) this.applyZoom(this.zoomTarget)
      return
    }
    const t = Math.min(1, dt / ZOOM_EASE_SECONDS)
    this.applyZoom(current + gap * easeOutCubic(t))
  }

  private applyZoom(next: number) {
    const cursor = this.zoomCursor
    const before = cursor ? this.groundAt(cursor.x, cursor.y) : null
    this.camera.zoom = next
    this.camera.updateProjectionMatrix()
    if (!before || !cursor) return
    const after = this.groundAt(cursor.x, cursor.y)
    if (!after) return
    this.moveLook(before.x - after.x, before.z - after.z)
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

  project(x: number, z: number): { x: number; y: number } {
    this.projected.set(x, 0, z)
    this.projected.project(this.camera)
    const rect = this.canvas.getBoundingClientRect()
    return {
      x: (this.projected.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-this.projected.y * 0.5 + 0.5) * rect.height + rect.top,
    }
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
    cameraYaw = this.bearing
    const horizontal = Math.cos(PITCH) * CAM_DIST
    this.camera.position.set(
      this.look.x + Math.sin(this.bearing) * horizontal,
      Math.sin(PITCH) * CAM_DIST,
      this.look.z + Math.cos(this.bearing) * horizontal,
    )
    this.camera.lookAt(this.look)
  }
}

function easeOutCubic(t: number): number {
  const remaining = 1 - t
  return 1 - remaining * remaining * remaining
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
