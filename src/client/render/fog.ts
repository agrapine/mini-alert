import {
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  NoColorSpace,
  PlaneGeometry,
  RGBAFormat,
  RedFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
} from 'three'
import type { SightSource } from '../../shared/vision.ts'
import { EXPLORED_FOG, FOG_FEATHER, FOG_TEXELS, stampExploredDistance, stampSight } from '../../shared/vision.ts'
import { PITCH } from './stage.ts'

const BLEND_SECONDS = 0.2
const FOG_Y = 3
const FOG_OVERHANG = FOG_Y / Math.tan(PITCH)
const FOG_SLACK = 0.5
const MAX_FRIENDS = 128

export class Fog {
  readonly mask: Float32Array
  private readonly exploredTiles: Uint8Array
  private readonly visible: Uint8Array
  private readonly exploredField: Float32Array
  private readonly exploredPixels: Uint8Array
  private readonly exploredTexture: DataTexture
  private readonly friendData: Float32Array
  private readonly friendTexture: DataTexture
  private readonly friendCount = { value: 0 }
  private readonly viewShift = new Vector2(0, FOG_OVERHANG)
  private readonly width: number
  private readonly height: number

  constructor(scene: Scene, width: number, height: number) {
    this.width = width
    this.height = height
    const tiles = width * height
    this.exploredTiles = new Uint8Array(tiles)
    this.visible = new Uint8Array(tiles)
    this.mask = new Float32Array(tiles).fill(1)

    const cols = width * FOG_TEXELS
    const rows = height * FOG_TEXELS
    this.exploredField = new Float32Array(cols * rows).fill(FOG_FEATHER)
    this.exploredPixels = new Uint8Array(cols * rows).fill(255)
    this.exploredTexture = new DataTexture(this.exploredPixels, cols, rows, RedFormat, UnsignedByteType)
    this.exploredTexture.colorSpace = NoColorSpace
    this.exploredTexture.magFilter = LinearFilter
    this.exploredTexture.minFilter = LinearFilter
    this.exploredTexture.wrapS = ClampToEdgeWrapping
    this.exploredTexture.wrapT = ClampToEdgeWrapping
    this.exploredTexture.flipY = false
    this.exploredTexture.unpackAlignment = 1
    this.exploredTexture.needsUpdate = true

    this.friendData = new Float32Array(MAX_FRIENDS * 4)
    this.friendTexture = new DataTexture(this.friendData, MAX_FRIENDS, 1, RGBAFormat, FloatType)
    this.friendTexture.colorSpace = NoColorSpace
    this.friendTexture.magFilter = NearestFilter
    this.friendTexture.minFilter = NearestFilter
    this.friendTexture.wrapS = ClampToEdgeWrapping
    this.friendTexture.wrapT = ClampToEdgeWrapping
    this.friendTexture.flipY = false
    this.friendTexture.needsUpdate = true

    const margin = FOG_OVERHANG + FOG_SLACK
    const mesh = new Mesh(
      new PlaneGeometry(width + margin * 2, height + margin * 2),
      fogMaterial(this.exploredTexture, this.friendTexture, this.friendCount, this.viewShift, width, height),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(width / 2, FOG_Y, height / 2)
    mesh.renderOrder = 20
    mesh.frustumCulled = false
    scene.add(mesh)
  }

  update(dt: number, friends: readonly SightSource[]) {
    stampSight(this.width, this.height, friends, this.exploredTiles, this.visible)
    const blend = dt <= 0 ? 0 : 1 - Math.exp(-dt / BLEND_SECONDS)
    for (let i = 0; i < this.mask.length; i++) {
      const target = this.visible[i] === 1 ? 0 : this.exploredTiles[i] === 1 ? EXPLORED_FOG : 1
      this.mask[i] += (target - this.mask[i]) * blend
    }
    stampExploredDistance(FOG_TEXELS, this.width, this.height, friends, this.exploredField)
    encodeExplored(this.exploredField, this.exploredPixels)
    this.exploredTexture.needsUpdate = true
    const count = Math.min(friends.length, MAX_FRIENDS)
    for (let i = 0; i < count; i++) {
      const friend = friends[i]
      const offset = i * 4
      this.friendData[offset] = friend.x
      this.friendData[offset + 1] = friend.z
      this.friendData[offset + 2] = friend.sight
    }
    this.friendCount.value = count
    this.friendTexture.needsUpdate = true
  }

  setView(yaw: number) {
    this.viewShift.set(Math.sin(yaw) * FOG_OVERHANG, Math.cos(yaw) * FOG_OVERHANG)
  }
}

function encodeExplored(field: Float32Array, pixels: Uint8Array) {
  for (let i = 0; i < field.length; i++) {
    const t = (field[i] / FOG_FEATHER) * 0.5 + 0.5
    pixels[i] = Math.round(Math.min(1, Math.max(0, t)) * 255)
  }
}

function fogMaterial(
  explored: DataTexture,
  friends: DataTexture,
  friendCount: { value: number },
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
      friends: { value: friends },
      friendCount,
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
      uniform sampler2D friends;
      uniform float friendCount;
      uniform vec2 mapSize;
      uniform vec2 viewShift;
      uniform float feather;
      uniform float exploredFog;
      varying vec3 vWorld;
      void main() {
        vec2 ground = vec2(vWorld.x, vWorld.z) - viewShift;
        vec2 uv = clamp(ground / mapSize, 0.0, 1.0);
        float knownDist = (texture2D(explored, uv).r - 0.5) * 2.0 * feather;
        float vis = 1000.0;
        for (int i = 0; i < 128; i++) {
          if (float(i) >= friendCount) break;
          vec4 friend = texture2D(friends, vec2((float(i) + 0.5) / 128.0, 0.5));
          vis = min(vis, length(ground - friend.xy) - friend.z);
        }
        float see = 1.0 - smoothstep(-0.2, feather, vis);
        float known = 1.0 - smoothstep(-0.2, feather, knownDist);
        float fog = mix(1.0, mix(exploredFog, 0.0, see), known);
        gl_FragColor = vec4(0.0, 0.0, 0.0, fog);
      }
    `,
  })
}
