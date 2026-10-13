import type { CityState, UnitSnapshot, WorldSnapshot } from '../../shared/protocol.ts'
import { NEUTRAL_CITY, type CityLayout } from '../../shared/cities.ts'
import { isMinimapShore, minimapRgb } from '../../shared/minimap.ts'
import type { Terrain, TileCoord } from '../../shared/tiles.ts'

const DOT = 3.25

export type MinimapCommand = (
  tile: TileCoord,
  mods: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
) => void

export class Minimap {
  private world: WorldSnapshot
  private readonly base: Uint8ClampedArray
  private readonly pristine: Uint8ClampedArray
  private layouts: readonly (CityLayout | null)[]
  private hover: ((tile: TileCoord | null) => void) | null = null
  private cityStates: readonly (CityState | null)[] = []
  private readonly image: ImageData
  private readonly ctx: CanvasRenderingContext2D
  private tracking = false
  private command: MinimapCommand | null = null
  private lastMask: Float32Array | null = null
  private fogSettled = false
  private cityHash = 0

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
    const painted = paintTerrain(map, world)
    this.ctx = painted.ctx
    this.image = painted.image
    this.base = painted.base
    this.pristine = new Uint8ClampedArray(painted.base)
    this.layouts = []
    this.root.addEventListener('pointerdown', this.onPointerDown)
    this.root.addEventListener('pointermove', this.onPointerMove)
    this.root.addEventListener('pointerup', this.onPointerUp)
    this.root.addEventListener('pointercancel', this.onPointerCancel)
    this.root.addEventListener('pointerleave', this.onPointerLeave)
    this.root.addEventListener('contextmenu', preventMenu)
  }

  setHover(hover: (tile: TileCoord | null) => void) {
    this.hover = hover
  }

  retile(world: WorldSnapshot) {
    this.world = world
    paintInto(this.pristine, world)
    this.base.set(this.pristine)
    this.fogSettled = false
  }

  setLayouts(layouts: readonly (CityLayout | null)[]) {
    this.layouts = layouts
    this.fogSettled = false
  }

  setCommand(command: MinimapCommand) {
    this.command = command
  }

  dispose() {
    this.root.removeEventListener('pointerdown', this.onPointerDown)
    this.root.removeEventListener('pointermove', this.onPointerMove)
    this.root.removeEventListener('pointerup', this.onPointerUp)
    this.root.removeEventListener('pointercancel', this.onPointerCancel)
    this.root.removeEventListener('pointerleave', this.onPointerLeave)
    this.root.removeEventListener('contextmenu', preventMenu)
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button === 2) {
      const tile = this.tileAt(event.clientX, event.clientY)
      if (tile) this.command?.(tile, event)
      return
    }
    this.tracking = true
    this.jump(event.clientX, event.clientY)
    try {
      this.root.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is unavailable for this event. Moves over the minimap still pan.
    }
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    this.hover?.(this.tileAt(event.clientX, event.clientY))
    if (this.tracking && event.buttons === 0) this.tracking = false
    if (this.tracking) this.jump(event.clientX, event.clientY)
  }

  private readonly onPointerUp = () => {
    this.tracking = false
  }

  private readonly onPointerCancel = () => {
    this.tracking = false
  }

  private readonly onPointerLeave = () => {
    this.hover?.(null)
  }

  draw(
    units: readonly UnitSnapshot[],
    selectedIds: ReadonlySet<number>,
    viewport: readonly { x: number; z: number }[],
    fog?: Float32Array,
    cities: readonly (CityState | null)[] = [],
    primaryFactoryId = 0,
    rally: TileCoord | null = null,
  ) {
    this.cityStates = cities
    if (fog) this.applyFog(fog)
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
    const primary = units.find((unit) => unit.id === primaryFactoryId)
    if (primary) this.star(ctx, this.toPixel({ x: primary.x, z: primary.z }, width, height))
    if (rally) this.diamond(ctx, this.toPixel({ x: rally.x + 0.5, z: rally.y + 0.5 }, width, height))
  }

  private applyFog(mask: Float32Array) {
    const hash = this.hashCities()
    if (this.fogSettled && hash === this.cityHash && this.sameMask(mask)) return
    this.cityHash = hash
    this.fogSettled = true
    if (!this.lastMask || this.lastMask.length !== mask.length) this.lastMask = new Float32Array(mask.length)
    this.lastMask.set(mask)
    this.base.set(this.pristine)
    this.paintCities()
    const data = this.image.data
    const base = this.base
    const count = Math.min(mask.length, base.length / 4)
    for (let i = 0; i < count; i++) {
      const lit = 1 - mask[i]
      const pixel = i * 4
      data[pixel] = base[pixel] * lit
      data[pixel + 1] = base[pixel + 1] * lit
      data[pixel + 2] = base[pixel + 2] * lit
    }
    this.ctx.putImageData(this.image, 0, 0)
  }

  private sameMask(mask: Float32Array): boolean {
    const last = this.lastMask
    if (!last || last.length !== mask.length) return false
    for (let i = 0; i < mask.length; i++) {
      if (Math.abs(mask[i] - last[i]) > 0.01) return false
    }
    return true
  }

  private hashCities(): number {
    let hash = 17
    for (let i = 0; i < this.layouts.length; i++) {
      const layout = this.layouts[i]
      const state = this.cityStates[i]
      if (!layout || !state) continue
      hash = Math.imul(hash, 31) + state.color + state.ownerId + layout.tiles.length
    }
    return hash
  }

  private paintCities() {
    const { width } = this.world
    for (let i = 0; i < this.layouts.length; i++) {
      const state = this.cityStates[i]
      const layout = this.layouts[i]
      if (!state || !layout) continue
      const color = state.color > 0 ? state.color : NEUTRAL_CITY
      const r = (color >> 16) & 255
      const g = (color >> 8) & 255
      const b = color & 255
      for (const tile of layout.tiles) {
        if (tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= this.world.height) continue
        const pixel = (tile.y * width + tile.x) * 4
        this.base[pixel] = r
        this.base[pixel + 1] = g
        this.base[pixel + 2] = b
      }
    }
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

  private star(ctx: CanvasRenderingContext2D, point: { x: number; y: number }) {
    ctx.save()
    ctx.translate(point.x, point.y)
    ctx.beginPath()
    let rot = -Math.PI / 2
    const step = Math.PI / 5
    ctx.moveTo(Math.cos(rot) * 7, Math.sin(rot) * 7)
    for (let i = 0; i < 5; i++) {
      rot += step
      ctx.lineTo(Math.cos(rot) * 3, Math.sin(rot) * 3)
      rot += step
      ctx.lineTo(Math.cos(rot) * 7, Math.sin(rot) * 7)
    }
    ctx.closePath()
    ctx.fillStyle = '#f0d060'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = '#1a1e12'
    ctx.stroke()
    ctx.restore()
  }

  private diamond(ctx: CanvasRenderingContext2D, point: { x: number; y: number }) {
    ctx.beginPath()
    ctx.moveTo(point.x, point.y - 5)
    ctx.lineTo(point.x + 4, point.y)
    ctx.lineTo(point.x, point.y + 5)
    ctx.lineTo(point.x - 4, point.y)
    ctx.closePath()
    ctx.fillStyle = '#f0d060'
    ctx.fill()
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

  private tileAt(clientX: number, clientY: number): TileCoord | null {
    const rect = this.root.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const x = Math.floor(((clientX - rect.left) / rect.width) * this.world.width)
    const y = Math.floor(((clientY - rect.top) / rect.height) * this.world.height)
    if (x < 0 || y < 0 || x >= this.world.width || y >= this.world.height) return null
    return { x, y }
  }
}

function paintTerrain(
  canvas: HTMLCanvasElement,
  world: WorldSnapshot,
): { ctx: CanvasRenderingContext2D; image: ImageData; base: Uint8ClampedArray } {
  canvas.width = world.width
  canvas.height = world.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('minimap canvas has no 2d context')
  const image = ctx.createImageData(world.width, world.height)
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const index = y * world.width + x
      if (world.known[index] === 0) {
        const pixel = index * 4
        image.data[pixel] = 12
        image.data[pixel + 1] = 16
        image.data[pixel + 2] = 20
        image.data[pixel + 3] = 255
        continue
      }
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
  const base = new Uint8ClampedArray(image.data)
  image.data.fill(0)
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255
  ctx.putImageData(image, 0, 0)
  return { ctx, image, base }
}

function paintInto(target: Uint8ClampedArray, world: WorldSnapshot) {
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const index = y * world.width + x
      const pixel = index * 4
      if (world.known[index] === 0) {
        target[pixel] = 12
        target[pixel + 1] = 16
        target[pixel + 2] = 20
        target[pixel + 3] = 255
        continue
      }
      const terrain = world.terrain[index] as Terrain
      const shore = isMinimapShore(world.terrain, world.width, world.height, x, y)
      const [r, g, b] = minimapRgb(terrain, shore)
      target[pixel] = r
      target[pixel + 1] = g
      target[pixel + 2] = b
      target[pixel + 3] = 255
    }
  }
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

function preventMenu(event: Event) {
  event.preventDefault()
}
