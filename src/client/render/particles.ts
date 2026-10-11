import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
} from 'three'
import { WeaponKind } from '../../shared/unit-types.ts'
import { PITCH, cameraYaw } from './stage.ts'
import { TILE_TOP } from './terrain.ts'

const EXPLOSION = {
  count: 24,
  speed: 3.4,
  life: 0.65,
  gravity: 7,
  color: 0xff7a24,
  size: 0.16,
  star: 1.15,
  starLife: 0.42,
  starColor: 0xfff0c8,
}

const SHELL_HIT = {
  count: 14,
  speed: 2.4,
  life: 0.38,
  gravity: 8,
  color: 0xffb15a,
  size: 0.1,
  star: 0.55,
  starLife: 0.28,
  starColor: 0xffe2a8,
}

const BULLET_HIT = {
  count: 7,
  speed: 1.6,
  life: 0.18,
  gravity: 4,
  color: 0xffe7a3,
  size: 0.06,
  star: 0.22,
  starLife: 0.14,
  starColor: 0xfff6d4,
}

type Style = typeof EXPLOSION

type Spark = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export class Particles {
  private readonly bursts: Burst[] = []

  constructor(private readonly scene: Scene) {}

  explosion(x: number, y: number, z: number) {
    this.bursts.push(new Burst(this.scene, x, y, z, EXPLOSION))
  }

  hit(x: number, z: number, kind: WeaponKind) {
    const style = kind === WeaponKind.Shell ? SHELL_HIT : BULLET_HIT
    this.bursts.push(new Burst(this.scene, x, TILE_TOP + 0.22, z, style))
  }

  advance(dt: number) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (this.bursts[i].advance(dt)) continue
      this.bursts[i].dispose()
      this.bursts.splice(i, 1)
    }
  }
}

class Burst {
  private readonly sparks: Spark[]
  private readonly bits: Group
  private readonly bitMaterial: MeshBasicMaterial
  private readonly star: Group
  private readonly starMaterial: MeshBasicMaterial
  private age = 0

  constructor(
    scene: Scene,
    x: number,
    y: number,
    z: number,
    private readonly style: Style,
  ) {
    this.sparks = []
    this.bitMaterial = new MeshBasicMaterial({
      color: style.color,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    const geometry = new PlaneGeometry(style.size, style.size)
    this.bits = new Group()
    this.bits.position.set(x, y, z)
    for (let i = 0; i < style.count; i++) {
      const yaw = Math.random() * Math.PI * 2
      const lift = 0.25 + Math.random() * 1.05
      const speed = style.speed * (0.45 + Math.random() * 0.7)
      const horizontal = Math.cos(lift)
      this.sparks.push({
        x: 0,
        y: 0,
        z: 0,
        vx: Math.cos(yaw) * horizontal * speed,
        vy: Math.sin(lift) * speed,
        vz: Math.sin(yaw) * horizontal * speed,
      })
      const bit = new Mesh(geometry, this.bitMaterial)
      bit.rotation.order = 'YXZ'
      bit.rotation.x = -PITCH
      bit.frustumCulled = false
      this.bits.add(bit)
    }
    const star = makeStarburst(style.star, style.starColor)
    this.star = star.group
    this.starMaterial = star.material
    this.star.position.set(x, y, z)
    scene.add(this.bits, this.star)
  }

  advance(dt: number): boolean {
    this.age += dt
    this.bitMaterial.opacity = Math.max(1 - this.age / this.style.life, 0)
    for (let i = 0; i < this.sparks.length; i++) {
      const spark = this.sparks[i]
      const bit = this.bits.children[i]
      spark.vy -= this.style.gravity * dt
      spark.x += spark.vx * dt
      spark.y += spark.vy * dt
      spark.z += spark.vz * dt
      bit.position.set(spark.x, spark.y, spark.z)
      bit.rotation.set(-PITCH, cameraYaw, 0)
    }
    const starT = Math.min(1, this.age / this.style.starLife)
    this.star.rotation.set(-PITCH, cameraYaw, 0)
    this.star.scale.setScalar(0.35 + starT * 1.7)
    this.starMaterial.opacity = (1 - starT) * (1 - starT)
    this.star.visible = starT < 1
    return this.age < this.style.life
  }

  dispose() {
    this.bits.removeFromParent()
    this.star.removeFromParent()
    const geometries = new Set<BufferGeometry>()
    this.bits.traverse((obj) => {
      if (obj instanceof Mesh) geometries.add(obj.geometry)
    })
    this.star.traverse((obj) => {
      if (obj instanceof Mesh) geometries.add(obj.geometry)
    })
    for (const geometry of geometries) geometry.dispose()
    this.bitMaterial.dispose()
    this.starMaterial.dispose()
  }
}

function makeStarburst(scale: number, color: number): { group: Group; material: MeshBasicMaterial } {
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
  const group = new Group()
  group.rotation.order = 'YXZ'
  group.rotation.x = -PITCH
  group.frustumCulled = false
  group.add(new Mesh(new CircleGeometry(0.22 * scale, 10), material))
  const ray = new PlaneGeometry(0.045 * scale, 0.7 * scale)
  for (let i = 0; i < 8; i++) {
    const mesh = new Mesh(ray, material)
    mesh.rotation.z = (i / 8) * Math.PI
    group.add(mesh)
  }
  return { group, material }
}
