import { describe, expect, it } from 'vitest'
import { decodeClientMessage, decodeServerFrame, encodeClientMessage, encodeServerFrame } from './codec.ts'
import { ClientMessageKind, ServerEventKind, type ServerFrame } from './protocol.ts'
import { Terrain } from './tiles.ts'
import { UnitTypeId, WeaponKind } from './unit-types.ts'

describe('protobuf frames', () => {
  it('round-trips a server frame and a client command', () => {
    const frame: ServerFrame = {
      tick: 12,
      events: [
        { kind: ServerEventKind.Welcome, playerId: 3 },
        {
          kind: ServerEventKind.UnitMotion,
          unit: {
            id: 4,
            typeId: UnitTypeId.Scout,
            ownerId: 3,
            color: 0x336699,
            x: 1.25,
            z: 2.5,
            facing: 0.2,
            turretYaw: 0.2,
            speed: 1.5,
            health: 40,
            tileX: 1,
            tileY: 2,
            path: [{ x: 3, y: 2 }],
            goal: { x: 3, y: 2 },
            attackId: null,
            attackPoint: null,
            progress: 1,
          },
        },
        {
          kind: ServerEventKind.MapPatch,
          map: {
            width: 8,
            height: 8,
            cells: [{ x: 1, y: 2, terrain: Terrain.Land, shift: 0x88 }],
            coast: [],
            holes: [],
            roads: [],
            towns: [],
            cleared: [],
          },
        },
        { kind: ServerEventKind.ShotSpawn, shot: { kind: WeaponKind.Shell, shooterId: 4, x: 1, z: 2, aimX: 3, aimZ: 4, flight: 0.4 } },
        { kind: ServerEventKind.ShotHit, hit: { kind: WeaponKind.Shell, aimX: 3, aimZ: 4 } },
        { kind: ServerEventKind.Credits, credits: 9989.583333333334 },
      ],
    }
    const back = decodeServerFrame(encodeServerFrame(frame))
    expect(back?.tick).toBe(12)
    expect(back?.events[0]).toMatchObject({ kind: ServerEventKind.Welcome, playerId: 3 })
    expect(back?.events[1]).toMatchObject({ kind: ServerEventKind.UnitMotion, unit: { id: 4, x: expect.closeTo(1.25), path: [{ x: 3, y: 2 }] } })
    expect(back?.events[2]).toMatchObject({ kind: ServerEventKind.MapPatch, map: { cells: [{ x: 1, y: 2, terrain: Terrain.Land, shift: 0x88 }] } })
    expect(back?.events[5]).toMatchObject({ kind: ServerEventKind.Credits, credits: expect.closeTo(9989.583333333334) })

    const order = decodeClientMessage(encodeClientMessage({ kind: ClientMessageKind.OrderMove, unitIds: [4], tile: { x: 6, y: 1 } }))
    expect(order).toEqual({ kind: ClientMessageKind.OrderMove, unitIds: [4], tile: { x: 6, y: 1 } })
    expect(decodeClientMessage(encodeClientMessage({ kind: ClientMessageKind.RequestSnapshot }))).toEqual({
      kind: ClientMessageKind.RequestSnapshot,
    })
  })
})
