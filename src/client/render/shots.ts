import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Scene,
} from 'three'
import { flightProgress, ROCKET_ACCEL, ROCKET_SPEED } from '../../shared/ballistics.ts'
import type { ShotEvent, ShotHit } from '../../shared/protocol.ts'
import { WeaponKind } from '../../shared/unit-types.ts'
import { TILE_TOP } from './terrain.ts'

const TRACER_PX = 10
const TRACER_PX_PER_SEC = 2000
const SHOT_Y = TILE_TOP + 0.45

type LiveShot = {
  kind: WeaponKind
  object: Line | Mesh | Group
  age: number
  flight: number
  traveled: number
  lengthPx: number
  speedPx: number
  originX: number
  originZ: number
  aimX: number
  aimZ: number
  /** Bullet impact is in view, so the spark waits for the tracer to arrive. */
  spark: boolean
  /** Shown on the arrival frame, then removed. */
  expire: boolean
}

export class ShotLayer {
  private readonly live: LiveShot[] = []

  constructor(
    private readonly scene: Scene,
    private readonly pixelsPerUnit: (dirX: number, dirZ: number) => number,
  ) {}

  spawn(events: readonly ShotEvent[]) {
    for (const event of events) {
      const bullet = event.kind === WeaponKind.Bullet
      const object = bullet ? tracer() : event.kind === WeaponKind.Rocket ? rocket() : shell()
      this.scene.add(object)
      const shot: LiveShot = {
        kind: event.kind,
        object,
        age: 0,
        flight: event.flight,
        traveled: 0,
        lengthPx: bullet ? TRACER_PX * vary() : TRACER_PX,
        speedPx: bullet ? TRACER_PX_PER_SEC * vary() : TRACER_PX_PER_SEC,
        originX: event.x,
        originZ: event.z,
        aimX: event.aimX,
        aimZ: event.aimZ,
        spark: false,
        expire: false,
      }
      if (bullet) placeTracer(shot, this.pixelsPerUnit)
      else place(shot)
      this.live.push(shot)
    }
  }

  strike(hits: readonly ShotHit[], onImpact?: (x: number, z: number, kind: WeaponKind) => void) {
    for (const hit of hits) {
      if (hit.kind === WeaponKind.Bullet) {
        const index = this.live.findIndex(
          (shot) =>
            shot.kind === WeaponKind.Bullet &&
            !shot.spark &&
            Math.hypot(shot.aimX - hit.aimX, shot.aimZ - hit.aimZ) < 0.75,
        )
        if (index >= 0) this.live[index].spark = true
        else onImpact?.(hit.aimX, hit.aimZ, hit.kind)
        continue
      }
      onImpact?.(hit.aimX, hit.aimZ, hit.kind)
      if (!ballistic(hit.kind)) continue
      const index = this.live.findIndex(
        (shot) => shot.kind === hit.kind && Math.hypot(shot.aimX - hit.aimX, shot.aimZ - hit.aimZ) < 0.75,
      )
      if (index < 0) continue
      drop(this.scene, this.live, index)
    }
  }

  advance(dt: number, onImpact?: (x: number, z: number, kind: WeaponKind) => void) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const shot = this.live[i]
      if (shot.expire) {
        drop(this.scene, this.live, i)
        continue
      }
      shot.age += dt
      if (shot.kind === WeaponKind.Bullet) {
        const dx = shot.aimX - shot.originX
        const dz = shot.aimZ - shot.originZ
        const dist = Math.hypot(dx, dz)
        if (dist > 1e-4) {
          shot.traveled = Math.min(
            dist,
            shot.traveled + tracerStep(dx / dist, dz / dist, dt, shot.speedPx, this.pixelsPerUnit),
          )
        }
        placeTracer(shot, this.pixelsPerUnit)
        if (shot.traveled >= dist) {
          if (shot.spark) onImpact?.(shot.aimX, shot.aimZ, shot.kind)
          shot.expire = true
        }
        continue
      }
      if (shot.age >= shot.flight + 0.4) {
        if (ballistic(shot.kind)) onImpact?.(shot.aimX, shot.aimZ, shot.kind)
        drop(this.scene, this.live, i)
        continue
      }
      place(shot)
    }
  }
}

function drop(scene: Scene, live: LiveShot[], index: number) {
  scene.remove(live[index].object)
  live.splice(index, 1)
}

function tracer(): Line {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3))
  const line = new Line(geometry, new LineBasicMaterial({ color: 0xffe7a3, depthTest: false, depthWrite: false }))
  line.frustumCulled = false
  line.renderOrder = 2
  return line
}

function shell(): Mesh {
  return new Mesh(new BoxGeometry(0.12, 0.12, 0.22), new MeshBasicMaterial({ color: 0xf0d060 }))
}

function rocket(): Group {
  const group = new Group()
  const body = new Mesh(new BoxGeometry(0.05, 0.05, 0.36), new MeshBasicMaterial({ color: 0xe4e0d4 }))
  const nose = new Mesh(new BoxGeometry(0.035, 0.035, 0.1), new MeshBasicMaterial({ color: 0xf4f1ea }))
  nose.position.z = 0.2
  const fin = new Mesh(new BoxGeometry(0.16, 0.015, 0.07), new MeshBasicMaterial({ color: 0x3c342c }))
  fin.position.z = -0.12
  const flame = new Mesh(new BoxGeometry(0.03, 0.03, 0.12), new MeshBasicMaterial({ color: 0xff5a18 }))
  flame.position.z = -0.26
  group.add(body, nose, fin, flame)
  return group
}

function vary(): number {
  return 0.9 + Math.random() * 0.2
}

function tracerStep(
  dirX: number,
  dirZ: number,
  dt: number,
  speedPx: number,
  pixelsPerUnit: (dirX: number, dirZ: number) => number,
): number {
  const per = pixelsPerUnit(dirX, dirZ)
  if (per <= 1e-3) return (40 * speedPx) / TRACER_PX_PER_SEC * dt
  return (speedPx / per) * dt
}

function ballistic(kind: WeaponKind): boolean {
  return kind === WeaponKind.Shell || kind === WeaponKind.Rocket
}

function placeTracer(shot: LiveShot, pixelsPerUnit: (dirX: number, dirZ: number) => number) {
  if (!(shot.object instanceof Line)) return
  const dx = shot.aimX - shot.originX
  const dz = shot.aimZ - shot.originZ
  const dist = Math.hypot(dx, dz)
  const position = shot.object.geometry.getAttribute('position')
  if (dist < 1e-4) {
    position.setXYZ(0, shot.originX, SHOT_Y, shot.originZ)
    position.setXYZ(1, shot.originX, SHOT_Y, shot.originZ)
    position.needsUpdate = true
    return
  }
  const dirX = dx / dist
  const dirZ = dz / dist
  const head = Math.min(dist, shot.traveled)
  const per = pixelsPerUnit(dirX, dirZ)
  const streak = Math.min(head, per > 1e-3 ? shot.lengthPx / per : 0.25 * (shot.lengthPx / TRACER_PX))
  const headX = shot.originX + dirX * head
  const headZ = shot.originZ + dirZ * head
  position.setXYZ(0, headX - dirX * streak, SHOT_Y, headZ - dirZ * streak)
  position.setXYZ(1, headX, SHOT_Y, headZ)
  position.needsUpdate = true
}

function place(shot: LiveShot) {
  const speed = shot.kind === WeaponKind.Rocket ? ROCKET_SPEED : 1
  const accel = shot.kind === WeaponKind.Rocket ? ROCKET_ACCEL : 0
  const t = flightProgress(shot.age, shot.flight, speed, accel)
  const arc = shot.kind === WeaponKind.Rocket ? Math.sin(Math.min(1, t) * Math.PI) * 1.8 : 0
  shot.object.position.set(
    shot.originX + (shot.aimX - shot.originX) * t,
    SHOT_Y + arc,
    shot.originZ + (shot.aimZ - shot.originZ) * t,
  )
  shot.object.rotation.y = Math.atan2(shot.aimX - shot.originX, shot.aimZ - shot.originZ)
}
