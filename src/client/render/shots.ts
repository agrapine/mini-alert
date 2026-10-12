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

const TRACER_LIFE = 0.12
const SHOT_Y = TILE_TOP + 0.45

type LiveShot = {
  kind: WeaponKind
  object: Line | Mesh | Group
  age: number
  flight: number
  originX: number
  originZ: number
  aimX: number
  aimZ: number
}

export class ShotLayer {
  private readonly live: LiveShot[] = []

  constructor(private readonly scene: Scene) {}

  spawn(events: readonly ShotEvent[]) {
    for (const event of events) {
      const object = event.kind === WeaponKind.Bullet ? tracer() : event.kind === WeaponKind.Rocket ? rocket() : shell()
      this.scene.add(object)
      const shot: LiveShot = {
        kind: event.kind,
        object,
        age: 0,
        flight: event.flight,
        originX: event.x,
        originZ: event.z,
        aimX: event.aimX,
        aimZ: event.aimZ,
      }
      place(shot)
      this.live.push(shot)
    }
  }

  strike(hits: readonly ShotHit[], onImpact?: (x: number, z: number, kind: WeaponKind) => void) {
    for (const hit of hits) {
      onImpact?.(hit.aimX, hit.aimZ, hit.kind)
      if (!ballistic(hit.kind)) continue
      const index = this.live.findIndex(
        (shot) => shot.kind === hit.kind && Math.hypot(shot.aimX - hit.aimX, shot.aimZ - hit.aimZ) < 0.75,
      )
      if (index < 0) continue
      this.scene.remove(this.live[index].object)
      this.live.splice(index, 1)
    }
  }

  advance(dt: number, onImpact?: (x: number, z: number, kind: WeaponKind) => void) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const shot = this.live[i]
      shot.age += dt
      const done = shot.kind === WeaponKind.Bullet ? shot.age >= TRACER_LIFE : shot.age >= shot.flight + 0.4
      if (done) {
        if (ballistic(shot.kind)) onImpact?.(shot.aimX, shot.aimZ, shot.kind)
        this.scene.remove(shot.object)
        this.live.splice(i, 1)
        continue
      }
      place(shot)
    }
  }
}

function tracer(): Line {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3))
  return new Line(geometry, new LineBasicMaterial({ color: 0xffe7a3 }))
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

function ballistic(kind: WeaponKind): boolean {
  return kind === WeaponKind.Shell || kind === WeaponKind.Rocket
}

function place(shot: LiveShot) {
  if (shot.object instanceof Line) {
    const position = shot.object.geometry.getAttribute('position')
    position.setXYZ(0, shot.originX, SHOT_Y, shot.originZ)
    position.setXYZ(1, shot.aimX, SHOT_Y, shot.aimZ)
    position.needsUpdate = true
    return
  }
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
