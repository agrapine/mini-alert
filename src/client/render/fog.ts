import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
} from 'three'
import type { SightSource } from '../../shared/vision.ts'
import { EXPLORED_FOG, FOG_FEATHER, FOG_TEXELS, rememberExplored, stampFriendDistance, stampSight } from '../../shared/vision.ts'
import { PITCH } from './stage.ts'

const BLEND_SECONDS = 0.2
const FOG_Y = 3
const FOG_OVERHANG = FOG_Y / Math.tan(PITCH)
const FOG_SLACK = 0.5
const MOVE_EPS_SQ = 0.25 * 0.25

export class Fog {
  readonly mask: Float32Array
  private readonly exploredTiles: Uint8Array
  private readonly visible: Uint8Array
  private readonly exploredField: Float32Array
  private readonly exploredPixels: Uint8Array
  private readonly exploredTexture: DataTexture
  private readonly liveField: Float32Array
  private readonly livePixels: Uint8Array
  private readonly liveTexture: DataTexture
  private readonly viewShift = new Vector2(0, FOG_OVERHANG)
  private readonly friendStamp: SightSource[] = []
  private readonly width: number
  private readonly height: number
  private readonly cols: number
  private readonly rows: number
  private friendCount = 0
  private fullUpload = true

  constructor(scene: Scene, width: number, height: number) {
    this.width = width
    this.height = height
    const tiles = width * height
    this.exploredTiles = new Uint8Array(tiles)
    this.visible = new Uint8Array(tiles)
    this.mask = new Float32Array(tiles).fill(1)

    this.cols = width * FOG_TEXELS
    this.rows = height * FOG_TEXELS
    const texels = this.cols * this.rows
    this.exploredField = new Float32Array(texels).fill(FOG_FEATHER)
    this.exploredPixels = new Uint8Array(texels * 4).fill(255)
    this.exploredTexture = fogTexture(this.exploredPixels, this.cols, this.rows)

    this.liveField = new Float32Array(texels).fill(FOG_FEATHER)
    this.livePixels = new Uint8Array(texels * 4).fill(255)
    this.liveTexture = fogTexture(this.livePixels, this.cols, this.rows)

    const margin = FOG_OVERHANG + FOG_SLACK
    const mesh = new Mesh(
      new PlaneGeometry(width + margin * 2, height + margin * 2),
      fogMaterial(this.exploredTexture, this.liveTexture, this.viewShift, width, height),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(width / 2, FOG_Y, height / 2)
    mesh.renderOrder = 20
    mesh.frustumCulled = false
    scene.add(mesh)
  }

  update(dt: number, friends: readonly SightSource[]) {
    const moved = this.movedFriends(friends)
    if (moved || this.fullUpload) stampSight(this.width, this.height, friends, this.exploredTiles, this.visible)
    const blend = dt <= 0 ? 0 : 1 - Math.exp(-dt / BLEND_SECONDS)
    for (let i = 0; i < this.mask.length; i++) {
      const target = this.visible[i] === 1 ? 0 : this.exploredTiles[i] === 1 ? EXPLORED_FOG : 1
      this.mask[i] += (target - this.mask[i]) * blend
    }
    if (this.fullUpload) {
      this.stampMoved(friends, true)
      encodeDistance(this.exploredField, this.exploredPixels, this.cols, 0, 0, this.cols - 1, this.rows - 1)
      this.rebuildLive(friends, true)
      this.exploredTexture.clearUpdateRanges()
      this.liveTexture.clearUpdateRanges()
      this.exploredTexture.needsUpdate = true
      this.liveTexture.needsUpdate = true
      this.fullUpload = false
      this.remember(friends)
      return
    }
    if (!moved) return
    const bounds = this.stampMoved(friends, false)
    this.rebuildLive(friends, friends.length !== this.friendCount)
    this.remember(friends)
    if (bounds) {
      encodeDistance(this.exploredField, this.exploredPixels, this.cols, bounds.x0, bounds.y0, bounds.x1, bounds.y1)
      uploadRows(this.exploredTexture, this.cols, bounds.x0, bounds.y0, bounds.x1, bounds.y1)
    }
  }

  setView(yaw: number) {
    this.viewShift.set(Math.sin(yaw) * FOG_OVERHANG, Math.cos(yaw) * FOG_OVERHANG)
  }

  /** Paints tiles the server already explored, before any friendly unit stamps sight this session. */
  seed(known: Uint8Array) {
    rememberExplored(known, this.width, this.exploredTiles, this.exploredField, FOG_TEXELS)
    for (let i = 0; i < known.length && i < this.mask.length; i++) {
      if (known[i] === 1 && this.mask[i] > EXPLORED_FOG) this.mask[i] = EXPLORED_FOG
    }
    encodeDistance(this.exploredField, this.exploredPixels, this.cols, 0, 0, this.cols - 1, this.rows - 1)
    this.exploredTexture.clearUpdateRanges()
    this.exploredTexture.needsUpdate = true
    this.fullUpload = true
  }

  reset() {
    this.exploredTiles.fill(0)
    this.visible.fill(0)
    this.mask.fill(1)
    this.exploredField.fill(FOG_FEATHER)
    this.exploredPixels.fill(255)
    this.liveField.fill(FOG_FEATHER)
    this.livePixels.fill(255)
    this.friendCount = 0
    this.fullUpload = true
    this.exploredTexture.clearUpdateRanges()
    this.liveTexture.clearUpdateRanges()
    this.exploredTexture.needsUpdate = true
    this.liveTexture.needsUpdate = true
  }

  private movedFriends(friends: readonly SightSource[]): boolean {
    if (friends.length !== this.friendCount) return true
    for (let i = 0; i < friends.length; i++) {
      const friend = friends[i]
      const prev = this.friendStamp[i]
      const dx = friend.x - prev.x
      const dz = friend.z - prev.z
      if (friend.sight !== prev.sight || dx * dx + dz * dz > MOVE_EPS_SQ) return true
    }
    return false
  }

  private stampMoved(friends: readonly SightSource[], force: boolean): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = this.cols
    let y0 = this.rows
    let x1 = -1
    let y1 = -1
    for (let i = 0; i < friends.length; i++) {
      const friend = friends[i]
      const prev = !force && i < this.friendCount ? this.friendStamp[i] : undefined
      if (prev) {
        const dx = friend.x - prev.x
        const dz = friend.z - prev.z
        if (friend.sight === prev.sight && dx * dx + dz * dz <= MOVE_EPS_SQ) continue
      }
      stampFriendDistance(FOG_TEXELS, this.width, this.height, friend, this.exploredField)
      const reach = friend.sight + FOG_FEATHER
      x0 = Math.min(x0, Math.max(0, Math.floor((friend.x - reach) * FOG_TEXELS)))
      x1 = Math.max(x1, Math.min(this.cols - 1, Math.ceil((friend.x + reach) * FOG_TEXELS) - 1))
      y0 = Math.min(y0, Math.max(0, Math.floor((friend.z - reach) * FOG_TEXELS)))
      y1 = Math.max(y1, Math.min(this.rows - 1, Math.ceil((friend.z + reach) * FOG_TEXELS) - 1))
    }
    if (x1 < x0 || y1 < y0) return null
    return { x0, y0, x1, y1 }
  }

  private remember(friends: readonly SightSource[]) {
    for (let i = 0; i < friends.length; i++) {
      const friend = friends[i]
      const slot = this.friendStamp[i] ?? (this.friendStamp[i] = { x: 0, z: 0, sight: 0 })
      slot.x = friend.x
      slot.z = friend.z
      slot.sight = friend.sight
    }
    this.friendCount = friends.length
  }

  private rebuildLive(friends: readonly SightSource[], full: boolean) {
    if (full) {
      this.liveField.fill(FOG_FEATHER)
      for (const friend of friends) stampFriendDistance(FOG_TEXELS, this.width, this.height, friend, this.liveField)
      encodeDistance(this.liveField, this.livePixels, this.cols, 0, 0, this.cols - 1, this.rows - 1)
      this.liveTexture.clearUpdateRanges()
      this.liveTexture.needsUpdate = true
      return
    }
    const bounds = { x0: this.cols, y0: this.rows, x1: -1, y1: -1 }
    for (let i = 0; i < friends.length; i++) {
      const prev = this.friendStamp[i]
      const friend = friends[i]
      if (!prev) continue
      const dx = friend.x - prev.x
      const dz = friend.z - prev.z
      if (friend.sight === prev.sight && dx * dx + dz * dz <= MOVE_EPS_SQ) continue
      includeDisk(bounds, prev, this.cols, this.rows)
      includeDisk(bounds, friend, this.cols, this.rows)
    }
    if (bounds.x1 < bounds.x0 || bounds.y1 < bounds.y0) return
    for (let y = bounds.y0; y <= bounds.y1; y++) {
      this.liveField.fill(FOG_FEATHER, y * this.cols + bounds.x0, y * this.cols + bounds.x1 + 1)
    }
    for (const friend of friends) {
      if (!diskHits(friend, bounds, this.cols, this.rows)) continue
      stampFriendDistance(FOG_TEXELS, this.width, this.height, friend, this.liveField)
    }
    encodeDistance(this.liveField, this.livePixels, this.cols, bounds.x0, bounds.y0, bounds.x1, bounds.y1)
    uploadRows(this.liveTexture, this.cols, bounds.x0, bounds.y0, bounds.x1, bounds.y1)
  }
}

type TexelBounds = { x0: number; y0: number; x1: number; y1: number }

function includeDisk(bounds: TexelBounds, friend: SightSource, cols: number, rows: number) {
  const reach = friend.sight + FOG_FEATHER
  bounds.x0 = Math.min(bounds.x0, Math.max(0, Math.floor((friend.x - reach) * FOG_TEXELS)))
  bounds.x1 = Math.max(bounds.x1, Math.min(cols - 1, Math.ceil((friend.x + reach) * FOG_TEXELS) - 1))
  bounds.y0 = Math.min(bounds.y0, Math.max(0, Math.floor((friend.z - reach) * FOG_TEXELS)))
  bounds.y1 = Math.max(bounds.y1, Math.min(rows - 1, Math.ceil((friend.z + reach) * FOG_TEXELS) - 1))
}

function diskHits(friend: SightSource, bounds: TexelBounds, cols: number, rows: number): boolean {
  const reach = friend.sight + FOG_FEATHER
  const x0 = Math.max(0, Math.floor((friend.x - reach) * FOG_TEXELS))
  const x1 = Math.min(cols - 1, Math.ceil((friend.x + reach) * FOG_TEXELS) - 1)
  const y0 = Math.max(0, Math.floor((friend.z - reach) * FOG_TEXELS))
  const y1 = Math.min(rows - 1, Math.ceil((friend.z + reach) * FOG_TEXELS) - 1)
  return x1 >= bounds.x0 && x0 <= bounds.x1 && y1 >= bounds.y0 && y0 <= bounds.y1
}

function fogTexture(data: Uint8Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType)
  texture.colorSpace = NoColorSpace
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.flipY = false
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  return texture
}

function encodeDistance(
  field: Float32Array,
  pixels: Uint8Array,
  cols: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let y = y0; y <= y1; y++) {
    let index = y * cols + x0
    for (let x = x0; x <= x1; x++, index++) {
      const t = (field[index] / FOG_FEATHER) * 0.5 + 0.5
      const byte = Math.round(Math.min(1, Math.max(0, t)) * 255)
      const pixel = index * 4
      pixels[pixel] = byte
      pixels[pixel + 1] = byte
      pixels[pixel + 2] = byte
      pixels[pixel + 3] = 255
    }
  }
}

function uploadRows(texture: DataTexture, cols: number, x0: number, y0: number, x1: number, y1: number) {
  const count = (x1 - x0 + 1) * 4
  for (let y = y0; y <= y1; y++) texture.addUpdateRange((y * cols + x0) * 4, count)
  texture.needsUpdate = true
}

function fogMaterial(
  explored: DataTexture,
  live: DataTexture,
  viewShift: Vector2,
  width: number,
  height: number,
): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      explored: { value: explored },
      live: { value: live },
      mapSize: { value: new Vector2(width, height) },
      viewShift: { value: viewShift },
      feather: { value: FOG_FEATHER },
      exploredFog: { value: EXPLORED_FOG },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D explored;
      uniform sampler2D live;
      uniform vec2 mapSize;
      uniform vec2 viewShift;
      uniform float feather;
      uniform float exploredFog;
      varying vec3 vWorld;

      vec2 gradient(vec2 cell) {
        vec2 p = vec2(dot(cell, vec2(127.1, 311.7)), dot(cell, vec2(269.5, 183.3)));
        return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
      }

      float perlin(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(dot(gradient(cell), f), dot(gradient(cell + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
          mix(dot(gradient(cell + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(gradient(cell + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        vec2 ground = vec2(vWorld.x, vWorld.z) - viewShift;
        vec2 broad = vec2(perlin(ground * 0.31), perlin(ground * 0.31 + vec2(8.3, 2.8)));
        vec2 warped = ground + broad * 1.05;
        vec2 wisp = vec2(perlin(warped * 0.67), perlin(warped * 0.67 + vec2(3.1, 7.7)));
        warped += wisp * 0.42;
        vec2 uv = clamp(warped / mapSize, 0.0, 1.0);
        float knownDist = (texture2D(explored, uv).r - 0.5) * 2.0 * feather;
        float vis = (texture2D(live, uv).r - 0.5) * 2.0 * feather;
        float see = 1.0 - smoothstep(-0.2, feather, vis);
        float known = 1.0 - smoothstep(-0.2, feather, knownDist);
        float fog = mix(1.0, mix(exploredFog, 0.0, see), known);
        gl_FragColor = vec4(0.0, 0.0, 0.0, fog);
      }
    `,
  })
}
