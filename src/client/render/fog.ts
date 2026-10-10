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
import { EXPLORED_FOG, stampSight } from '../../shared/vision.ts'
import { PITCH } from './stage.ts'

const BLEND_SECONDS = 0.2
const FOG_Y = 3
const FOG_OVERHANG = FOG_Y / Math.tan(PITCH)
const FOG_SLACK = 0.5

export class Fog {
  readonly mask: Float32Array
  private readonly explored: Uint8Array
  private readonly visible: Uint8Array
  private readonly pixels: Uint8Array
  private readonly texture: DataTexture
  private readonly width: number
  private readonly height: number

  constructor(scene: Scene, width: number, height: number) {
    this.width = width
    this.height = height
    const count = width * height
    this.explored = new Uint8Array(count)
    this.visible = new Uint8Array(count)
    this.mask = new Float32Array(count).fill(1)
    this.pixels = new Uint8Array(count * 4)
    for (let i = 0; i < count; i++) this.pixels[i * 4 + 3] = 255
    this.texture = new DataTexture(this.pixels, width, height, RGBAFormat, UnsignedByteType)
    this.texture.colorSpace = NoColorSpace
    this.texture.magFilter = LinearFilter
    this.texture.minFilter = LinearFilter
    this.texture.wrapS = ClampToEdgeWrapping
    this.texture.wrapT = ClampToEdgeWrapping
    this.texture.flipY = false
    this.texture.needsUpdate = true
    const depth = height + FOG_OVERHANG + FOG_SLACK
    const mesh = new Mesh(new PlaneGeometry(width, depth), fogMaterial(this.texture, width, height))
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(width / 2, FOG_Y, depth / 2)
    mesh.renderOrder = 20
    mesh.frustumCulled = false
    scene.add(mesh)
  }

  update(dt: number, friends: readonly SightSource[]) {
    stampSight(this.width, this.height, friends, this.explored, this.visible)
    const blend = dt <= 0 ? 0 : 1 - Math.exp(-dt / BLEND_SECONDS)
    const count = this.mask.length
    for (let i = 0; i < count; i++) {
      const target = this.visible[i] === 1 ? 0 : this.explored[i] === 1 ? EXPLORED_FOG : 1
      this.mask[i] += (target - this.mask[i]) * blend
      const alpha = Math.round(this.mask[i] * 255)
      this.pixels[i * 4 + 3] = alpha
    }
    this.texture.needsUpdate = true
  }
}

function fogMaterial(mask: DataTexture, width: number, height: number): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      mask: { value: mask },
      mapSize: { value: new Vector2(width, height) },
      overhang: { value: FOG_OVERHANG },
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
      uniform sampler2D mask;
      uniform vec2 mapSize;
      uniform float overhang;
      varying vec3 vWorld;
      void main() {
        vec2 uv = clamp(vec2(vWorld.x, vWorld.z - overhang) / mapSize, 0.0, 1.0);
        float fog = texture2D(mask, uv).a;
        gl_FragColor = vec4(0.0, 0.0, 0.0, fog);
      }
    `,
  })
}
