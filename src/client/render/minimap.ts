import type { UnitSnapshot, WorldSnapshot } from '../../shared/protocol.ts'
import { isMinimapShore, minimapRgb } from '../../shared/minimap.ts'
import type { Terrain } from '../../shared/tiles.ts'

const DOT = 3.25

export class Minimap {
  private readonly world: WorldSnapshot
  private dragging = false

  constructor(
    private readonly root: HTMLElement,
    map: HTMLCanvasElement,
    private readonly marks: HTMLCanvasElement,
    world: WorldSnapshot,
    private readonly onJump: (x: number, z: number) => void,
  ) {
    this.world = world
    this.root.hidden = false
    this.root.style.aspectRatio = `${world.width} / ${world.height}`
    paintTerrain(map, world)
    this.root.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      this.dragging = true
      this.jump(event.clientX, event.clientY)
      try {
        this.root.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture is unavailable for this event. Moves over the minimap still pan.
      }
    })
    this.root.addEventListener('pointermove', (event) => {
      if (!this.dragging) return
      this.jump(event.clientX, event.clientY)
    })
    const stop = () => {
      this.dragging = false
    }
    this.root.addEventListener('pointerup', stop)
    this.root.addEventListener('pointercancel', stop)
  }

  draw(
    units: readonly UnitSnapshot[],
    selectedIds: ReadonlySet<number>,
    viewport: readonly { x: number; z: number }[],
  ) {
    const ctx = this.marks.getContext('2d')
    if (!ctx) return
    const width = this.root.clientWidth
    const height = this.root.clientHeight
    if (width === 0 || height === 0) return
    const dpr = Math.min(devicePixelRatio, 2)
    const bitmapW = Math.round(width * dpr)
    const bitmapH = Math.round(height * dpr)
    if (this.marks.width !== bitmapW || this.marks.height !== bitmapH) {
      this.marks.width = bitmapW
      this.marks.height = bitmapH
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    this.strokeViewport(ctx, viewport, width, height)
    const rest: UnitSnapshot[] = []
    const picked: UnitSnapshot[] = []
    for (const unit of units) {
      if (selectedIds.has(unit.id)) picked.push(unit)
      else rest.push(unit)
    }
    for (const unit of rest) this.dot(ctx, unit, width, height, false)
    for (const unit of picked) this.dot(ctx, unit, width, height, true)
  }

  private strokeViewport(
    ctx: CanvasRenderingContext2D,
    viewport: readonly { x: number; z: number }[],
    width: number,
    height: number,
  ) {
    if (viewport.length < 3) return
    ctx.beginPath()
    const first = this.toPixel(viewport[0], width, height)
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < viewport.length; i++) {
      const point = this.toPixel(viewport[i], width, height)
      ctx.lineTo(point.x, point.y)
    }
    ctx.closePath()
    ctx.fillStyle = 'rgba(246, 241, 220, 0.16)'
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = '#f6f1dc'
    ctx.stroke()
  }

  private dot(
    ctx: CanvasRenderingContext2D,
    unit: UnitSnapshot,
    width: number,
    height: number,
    selected: boolean,
  ) {
    const point = this.toPixel({ x: unit.x, z: unit.z }, width, height)
    ctx.beginPath()
    ctx.arc(point.x, point.y, selected ? DOT + 1.4 : DOT, 0, Math.PI * 2)
    ctx.fillStyle = cssColor(unit.color)
    ctx.fill()
    if (!selected) return
    ctx.lineWidth = 1.25
    ctx.strokeStyle = '#f0d060'
    ctx.stroke()
  }

  private toPixel(point: { x: number; z: number }, width: number, height: number): { x: number; y: number } {
    return {
      x: (point.x / this.world.width) * width,
      y: (point.z / this.world.height) * height,
    }
  }

  private jump(clientX: number, clientY: number) {
    const rect = this.root.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = ((clientX - rect.left) / rect.width) * this.world.width
    const z = ((clientY - rect.top) / rect.height) * this.world.height
    this.onJump(x, z)
  }
}

function paintTerrain(canvas: HTMLCanvasElement, world: WorldSnapshot) {
  canvas.width = world.width
  canvas.height = world.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const image = ctx.createImageData(world.width, world.height)
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const index = y * world.width + x
      const terrain = world.terrain[index] as Terrain
      const shore = isMinimapShore(world.terrain, world.width, world.height, x, y)
      const [r, g, b] = minimapRgb(terrain, shore)
      const pixel = index * 4
      image.data[pixel] = r
      image.data[pixel + 1] = g
      image.data[pixel + 2] = b
      image.data[pixel + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}
