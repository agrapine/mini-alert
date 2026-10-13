import { describe, expect, it } from 'vitest'
import { Replica } from '../client/replica.ts'
import { KEEPALIVE_TICKS, SIM_STEP, stepMotion, type MotionState } from '../shared/motion.ts'
import { ClientMessageKind, ServerEventKind, type ServerFrame } from '../shared/protocol.ts'
import { Terrain } from '../shared/tiles.ts'
import { SCOUT, UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { ServerHost } from './host.ts'
import { World } from './world.ts'

function events(frames: readonly ServerFrame[]) {
  return frames.flatMap((frame) => frame.events)
}

describe('host snapshots', () => {
  it('sends a capture in progress as city state without the layout', () => {
    const tiles = new Uint8Array(20 * 20).fill(Terrain.Land)
    const game = new Game(World.fromTiles(20, 20, tiles))
    game.scenery = { coast: [], holes: [], roads: [], towns: [{ x: 8, y: 8 }], seed: 7 }
    game.bindCities()
    const player = game.addPlayer()
    game.spawn(player, UnitTypeId.Scout, { x: 8, y: 8 })
    const host = new ServerHost(game)
    const frames: ServerFrame[] = []
    host.attach(player.id, true, (message) => frames.push(message)).sync()
    frames.length = 0
    for (let i = 0; i < 90; i++) host.tick(SIM_STEP)
    const updates = events(frames).filter((event) => event.kind === ServerEventKind.CityUpdate)
    expect(updates.length).toBeGreaterThan(0)
    expect(updates.length).toBeLessThan(90)
    for (const update of updates) expect(update.city.layout).toBeNull()
  })

  it('sends motion on an order and stays quiet when the path does not change', () => {
    const game = new Game(new World(32, 32))
    const player = game.addPlayer()
    const scout = game.spawn(player, UnitTypeId.Scout, { x: 4, y: 4 })
    const host = new ServerHost(game)
    const frames: ServerFrame[] = []
    const play = host.attach(player.id, true, (message) => frames.push(message))
    play.sync()
    frames.length = 0
    host.tick(SIM_STEP)
    expect(events(frames).some((event) => event.kind === ServerEventKind.UnitMotion)).toBe(false)

    frames.length = 0
    play.command({ kind: ClientMessageKind.OrderMove, unitIds: [scout.id], tile: { x: 12, y: 4 } })
    host.tick(SIM_STEP)
    expect(events(frames).some((event) => event.kind === ServerEventKind.UnitMotion)).toBe(true)
  })

  it('sends nothing while idle and a tick keepalive after five seconds', () => {
    const game = new Game(new World(32, 32))
    const player = game.addPlayer()
    game.spawn(player, UnitTypeId.Scout, { x: 4, y: 4 })
    const host = new ServerHost(game)
    const frames: ServerFrame[] = []
    host.attach(player.id, true, (message) => frames.push(message)).sync()
    frames.length = 0
    for (let i = 0; i < KEEPALIVE_TICKS - 1; i++) host.tick(SIM_STEP)
    expect(frames).toHaveLength(0)
    host.tick(SIM_STEP)
    expect(frames).toHaveLength(1)
    expect(frames[0]?.events).toEqual([])
    expect(frames[0]?.tick).toBe(host.tickNo)
  })

  it('omits an enemy outside sight', () => {
    const game = new Game(new World(48, 16))
    const player = game.addPlayer()
    const other = game.addPlayer()
    game.spawn(player, UnitTypeId.Scout, { x: 2, y: 8 })
    const hidden = game.spawn(other, UnitTypeId.Scout, { x: 40, y: 8 })
    const host = new ServerHost(game)
    const frames: ServerFrame[] = []
    host.attach(player.id, true, (message) => frames.push(message)).sync()
    const snapshot = events(frames).find((event) => event.kind === ServerEventKind.Snapshot)
    expect(snapshot?.kind === ServerEventKind.Snapshot && snapshot.units.some((unit) => unit.id === hidden.id)).toBe(false)
  })

  it('patches newly seen tiles instead of the whole map', () => {
    const game = new Game(new World(40, 16))
    const player = game.addPlayer()
    const scout = game.spawn(player, UnitTypeId.Scout, { x: 2, y: 8 })
    const host = new ServerHost(game)
    const frames: ServerFrame[] = []
    const play = host.attach(player.id, true, (message) => frames.push(message))
    play.sync()
    play.command({ kind: ClientMessageKind.OrderMove, unitIds: [scout.id], tile: { x: 30, y: 8 } })
    for (let i = 0; i < 90; i++) host.tick(SIM_STEP)
    const patches = events(frames).filter((event) => event.kind === ServerEventKind.MapPatch)
    expect(patches.length).toBeGreaterThan(0)
    const cells = patches.reduce((sum, event) => sum + (event.kind === ServerEventKind.MapPatch ? event.map.cells.length : 0), 0)
    expect(cells).toBeGreaterThan(0)
    expect(cells).toBeLessThan(40 * 16)
    const patch = patches.find((event) => event.kind === ServerEventKind.MapPatch)
    if (patch?.kind === ServerEventKind.MapPatch) {
      expect(patch.map.cells.every((cell) => cell.shift === 0x88)).toBe(true)
      expect(patch.map.coast).toEqual([])
      expect(patch.map.roads).toEqual([])
    }
  })

  it('answers a snapshot request at the server tick and the client keeps that path', () => {
    const game = new Game(new World(24, 12))
    const player = game.addPlayer()
    const scout = game.spawn(player, UnitTypeId.Scout, { x: 2, y: 4 })
    const host = new ServerHost(game)
    const frames: ServerFrame[] = []
    const play = host.attach(player.id, true, (message) => frames.push(message))
    play.sync()
    play.command({ kind: ClientMessageKind.OrderMove, unitIds: [scout.id], tile: { x: 16, y: 4 } })
    for (let i = 0; i < 31; i++) host.tick(SIM_STEP)
    frames.length = 0
    play.command({ kind: ClientMessageKind.RequestSnapshot })
    const frame = frames.at(-1)
    expect(frame?.tick).toBe(host.tickNo)
    expect(frame?.events.some((event) => event.kind === ServerEventKind.Snapshot)).toBe(true)

    const replica = new Replica()
    if (frame) replica.apply(frame)
    const unit = replica.unit(scout.id)
    expect(unit).toBeDefined()
    if (!unit) return
    const shadow: MotionState = {
      x: unit.x,
      z: unit.z,
      facing: unit.facing,
      speed: unit.speed,
      tileX: unit.tileX,
      tileY: unit.tileY,
      path: unit.path.map((tile) => ({ x: tile.x, y: tile.y })),
    }
    for (let i = 0; i < 2; i++) {
      stepMotion(shadow, SCOUT, SIM_STEP)
      replica.advance(SIM_STEP)
    }
    expect(shadow.path.length).toBeGreaterThan(0)
    const stepped = replica.unit(scout.id)
    expect(stepped?.x).toBeCloseTo(shadow.x)
    expect(stepped?.z).toBeCloseTo(shadow.z)
    expect(stepped?.path).toEqual(shadow.path)
  })
})
