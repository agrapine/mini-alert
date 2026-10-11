import { describe, expect, it } from 'vitest'
import {
  LobbyClientKind,
  LobbyServerKind,
  MapSize,
  RoomStatus,
  SlotKind,
  type GameLobbyState,
  type LobbyServerMessage,
  type MapPreview,
  type WaitingRoom,
  type Faction,
} from '../shared/lobby.ts'
import { ServerMessageKind, type ServerMessage } from '../shared/protocol.ts'
import { Game } from './game.ts'
import { Lobby, type LobbySocket } from './lobby.ts'

function fake(): LobbySocket & { lobby: LobbyServerMessage[]; game: ServerMessage[] } {
  const lobby: LobbyServerMessage[] = []
  const game: ServerMessage[] = []
  return {
    lobby,
    game,
    send(message) {
      lobby.push(message)
    },
    sendGame(message) {
      game.push(message)
    },
  }
}

function settled(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function latest<T extends LobbyServerMessage>(sock: { lobby: LobbyServerMessage[] }, kind: T['kind']): T {
  for (let i = sock.lobby.length - 1; i >= 0; i--) {
    const message = sock.lobby[i]
    if (message.kind === kind) return message as T
  }
  throw new Error(`missing ${kind}`)
}

function opened(lobby: Lobby) {
  return lobby as unknown as {
    games: Map<number, { match: { host: { game: Game }; factions: Faction[] } | null }>
  }
}

describe('lobby', () => {
  it('keeps joiners unseated until they take a slot, then starts and lets others spectate', async () => {
    const lobby = new Lobby()
    const hostSock = fake()
    const guestSock = fake()
    const laterSock = fake()
    const host = lobby.connect(hostSock)
    const guest = lobby.connect(guestSock)

    lobby.onLobby(host, { kind: LobbyClientKind.CreateGame })
    await settled()
    const created = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    expect(created.slots.every((slot) => slot.kind === SlotKind.Open)).toBe(true)
    expect(created.slots).toHaveLength(4)
    const preview = latest<MapPreview>(hostSock, LobbyServerKind.Preview)
    expect(preview.width).toBe(MapSize.Small)
    expect(preview.starts).toHaveLength(4)

    lobby.onLobby(guest, { kind: LobbyClientKind.JoinGame, gameId: created.gameId })
    const joined = latest<GameLobbyState>(guestSock, LobbyServerKind.GameLobby)
    expect(joined.slots.every((slot) => slot.kind === SlotKind.Open)).toBe(true)
    expect(joined.waiting.map((person) => person.id)).toContain(guest.id)

    lobby.onLobby(host, { kind: LobbyClientKind.TakeSlot, index: 3 })
    lobby.onLobby(host, { kind: LobbyClientKind.SetMapSize, size: MapSize.Tiny })
    await settled()
    const shrunk = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    expect(shrunk.slots).toHaveLength(2)
    expect(shrunk.slots.every((slot) => slot.kind === SlotKind.Open)).toBe(true)
    expect(shrunk.waiting.some((person) => person.id === host.id)).toBe(true)
    const shrunkPreview = latest<MapPreview>(hostSock, LobbyServerKind.Preview)
    expect(shrunkPreview.width).toBe(MapSize.Tiny)
    expect(shrunkPreview.starts).toHaveLength(2)

    lobby.onLobby(host, { kind: LobbyClientKind.StartGame })
    expect(latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby).status).toBe(RoomStatus.Waiting)

    lobby.onLobby(host, { kind: LobbyClientKind.SetName, name: 'Ada' })
    lobby.onLobby(host, { kind: LobbyClientKind.Chat, text: 'ready' })
    lobby.onLobby(host, { kind: LobbyClientKind.TakeSlot, index: 0 })
    lobby.onLobby(host, { kind: LobbyClientKind.SetSlotAi, index: 1 })
    const seated = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    expect(seated.slots[0]).toMatchObject({ kind: SlotKind.Human, name: 'Ada', clientId: host.id })
    expect(seated.slots[1].kind).toBe(SlotKind.Ai)
    expect(seated.chat.at(-1)).toEqual({ name: 'Ada', text: 'ready' })
    expect(seated.waiting.some((person) => person.id === guest.id)).toBe(true)

    lobby.onLobby(host, { kind: LobbyClientKind.StartGame })
    const playing = latest<GameLobbyState>(guestSock, LobbyServerKind.GameLobby)
    expect(playing.status).toBe(RoomStatus.Playing)
    expect(playing.spectating).toBe(true)
    expect(playing.factions).toHaveLength(2)
    expect(guestSock.game.some((message) => message.kind === ServerMessageKind.World)).toBe(true)
    expect(guestSock.game.some((message) => message.kind === ServerMessageKind.Welcome)).toBe(true)
    const hostLobby = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    expect(hostLobby.spectating).toBe(false)

    const watcher = lobby.connect(laterSock)
    const hall = latest<WaitingRoom>(laterSock, LobbyServerKind.Waiting)
    expect(hall.games[0]?.status).toBe(RoomStatus.Playing)
    expect(hall.games[0]?.slots[0]?.name).toBe('Ada')
    lobby.onLobby(watcher, { kind: LobbyClientKind.JoinGame, gameId: created.gameId })
    expect(latest<GameLobbyState>(laterSock, LobbyServerKind.GameLobby).spectating).toBe(true)
    expect(laterSock.game.some((message) => message.kind === ServerMessageKind.World)).toBe(true)

    const view = playing.factions[1]?.playerId
    expect(view).toBeTypeOf('number')
    if (view === undefined) return
    lobby.onLobby(guest, { kind: LobbyClientKind.ViewAs, playerId: view })
    const welcome = guestSock.game.filter((message) => message.kind === ServerMessageKind.Welcome)
    expect(welcome.at(-1)).toMatchObject({ playerId: view })
  })

  it('marks a wiped faction defeated and turns that human into a spectator', async () => {
    const lobby = new Lobby()
    const hostSock = fake()
    const foeSock = fake()
    const host = lobby.connect(hostSock)
    const foe = lobby.connect(foeSock)
    lobby.onLobby(host, { kind: LobbyClientKind.CreateGame })
    await settled()
    const created = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    lobby.onLobby(foe, { kind: LobbyClientKind.JoinGame, gameId: created.gameId })
    lobby.onLobby(host, { kind: LobbyClientKind.SetName, name: 'Ada' })
    lobby.onLobby(foe, { kind: LobbyClientKind.SetName, name: 'Bea' })
    lobby.onLobby(host, { kind: LobbyClientKind.TakeSlot, index: 0 })
    lobby.onLobby(foe, { kind: LobbyClientKind.TakeSlot, index: 1 })
    lobby.onLobby(host, { kind: LobbyClientKind.StartGame })
    await settled()

    const started = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    expect(started.spectating).toBe(false)
    expect(started.seatId).toBe(started.factions[0]?.playerId)
    expect(started.factions.every((faction) => !faction.defeated)).toBe(true)

    const match = opened(lobby).games.get(created.gameId)?.match
    expect(match).toBeTruthy()
    if (!match) return
    const loser = match.factions[1]
    expect(loser).toBeTruthy()
    if (!loser) return
    for (const unit of match.host.game.units) {
      if (unit.ownerId === loser.playerId) unit.health = 0
    }
    for (const town of match.host.game.scenery.towns) match.host.game.claimCity(town, started.seatId)
    lobby.tick(1 / 30)

    const after = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    expect(after.factions.find((faction) => faction.playerId === loser.playerId)?.defeated).toBe(true)
    expect(after.factions.find((faction) => faction.playerId === started.seatId)?.defeated).toBe(false)
    expect(after.spectating).toBe(false)
    const foeLobby = latest<GameLobbyState>(foeSock, LobbyServerKind.GameLobby)
    expect(foeLobby.spectating).toBe(true)
    expect(foeLobby.seatId).toBe(loser.playerId)
    const watched = foeSock.game.filter((message) => message.kind === ServerMessageKind.Welcome).at(-1)
    expect(watched).toMatchObject({ playerId: started.seatId })

    lobby.onLobby(foe, { kind: LobbyClientKind.LeaveRoom })
    expect(latest<WaitingRoom>(foeSock, LobbyServerKind.Waiting).you.id).toBe(foe.id)
  })

  it('ignores destroy until that client has claimed admin', async () => {
    const lobby = new Lobby()
    const hostSock = fake()
    const adminSock = fake()
    const host = lobby.connect(hostSock)
    const admin = lobby.connect(adminSock)
    lobby.onLobby(host, { kind: LobbyClientKind.CreateGame })
    await settled()
    const created = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)

    lobby.onLobby(admin, { kind: LobbyClientKind.DestroyGame, gameId: created.gameId })
    expect(latest<WaitingRoom>(adminSock, LobbyServerKind.Waiting).games.map((game) => game.id)).toContain(created.gameId)

    lobby.onLobby(admin, { kind: LobbyClientKind.ClaimAdmin })
    lobby.onLobby(admin, { kind: LobbyClientKind.DestroyGame, gameId: created.gameId })
    const hall = latest<WaitingRoom>(hostSock, LobbyServerKind.Waiting)
    expect(hall.games).toEqual([])
    expect(hall.you.id).toBe(host.id)
    expect(opened(lobby).games.has(created.gameId)).toBe(false)
  })

  it('destroys a live game, stops its AI, and returns everyone to the hall', async () => {
    const lobby = new Lobby()
    const hostSock = fake()
    const foeSock = fake()
    const watchSock = fake()
    const adminSock = fake()
    const host = lobby.connect(hostSock)
    const foe = lobby.connect(foeSock)
    const admin = lobby.connect(adminSock)
    lobby.onLobby(admin, { kind: LobbyClientKind.ClaimAdmin })
    lobby.onLobby(host, { kind: LobbyClientKind.CreateGame })
    await settled()
    const created = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    lobby.onLobby(foe, { kind: LobbyClientKind.JoinGame, gameId: created.gameId })
    lobby.onLobby(host, { kind: LobbyClientKind.TakeSlot, index: 0 })
    lobby.onLobby(foe, { kind: LobbyClientKind.TakeSlot, index: 1 })
    lobby.onLobby(host, { kind: LobbyClientKind.SetSlotAi, index: 2 })
    lobby.onLobby(host, { kind: LobbyClientKind.StartGame })
    expect(latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby).status).toBe(RoomStatus.Playing)

    const watcher = lobby.connect(watchSock)
    lobby.onLobby(watcher, { kind: LobbyClientKind.JoinGame, gameId: created.gameId })
    expect(latest<GameLobbyState>(watchSock, LobbyServerKind.GameLobby).spectating).toBe(true)

    const match = opened(lobby).games.get(created.gameId)?.match
    expect(match).toBeTruthy()
    if (!match) return
    const sim = match.host as unknown as { sessions: unknown[]; ais: unknown[]; tick(dt: number): void }
    expect(sim.sessions.length).toBeGreaterThan(0)
    expect(sim.ais.length).toBe(1)

    lobby.onLobby(admin, { kind: LobbyClientKind.DestroyGame, gameId: created.gameId })
    expect(latest<WaitingRoom>(hostSock, LobbyServerKind.Waiting).you.id).toBe(host.id)
    expect(latest<WaitingRoom>(foeSock, LobbyServerKind.Waiting).you.id).toBe(foe.id)
    expect(latest<WaitingRoom>(watchSock, LobbyServerKind.Waiting).you.id).toBe(watcher.id)
    expect(latest<WaitingRoom>(adminSock, LobbyServerKind.Waiting).games).toEqual([])
    expect(opened(lobby).games.has(created.gameId)).toBe(false)
    expect(sim.sessions).toEqual([])
    expect(sim.ais).toEqual([])
    sim.tick(1)
    lobby.tick(1)
  })

  it('drops an unstarted game while its map is still drawing', async () => {
    const lobby = new Lobby()
    const hostSock = fake()
    const adminSock = fake()
    const host = lobby.connect(hostSock)
    const admin = lobby.connect(adminSock)
    lobby.onLobby(host, { kind: LobbyClientKind.CreateGame })
    const created = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    lobby.onLobby(admin, { kind: LobbyClientKind.ClaimAdmin })
    lobby.onLobby(admin, { kind: LobbyClientKind.DestroyGame, gameId: created.gameId })
    expect(latest<WaitingRoom>(hostSock, LobbyServerKind.Waiting).games).toEqual([])
    await settled()
    expect(latest<WaitingRoom>(hostSock, LobbyServerKind.Waiting).games).toEqual([])
    expect(opened(lobby).games.has(created.gameId)).toBe(false)
  })

  it('pauses AI and mechanics while nobody is in a live match, then resumes', async () => {
    const lobby = new Lobby()
    const hostSock = fake()
    const watchSock = fake()
    const host = lobby.connect(hostSock)
    lobby.onLobby(host, { kind: LobbyClientKind.CreateGame })
    await settled()
    const created = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    lobby.onLobby(host, { kind: LobbyClientKind.TakeSlot, index: 0 })
    lobby.onLobby(host, { kind: LobbyClientKind.SetSlotAi, index: 1 })
    lobby.onLobby(host, { kind: LobbyClientKind.StartGame })
    expect(latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby).status).toBe(RoomStatus.Playing)

    const match = opened(lobby).games.get(created.gameId)?.match
    expect(match).toBeTruthy()
    if (!match) return
    const human = match.factions.find((faction) => !faction.ai)
    expect(human).toBeTruthy()
    if (!human) return
    const credits = () => match.host.game.player(human.playerId)?.credits ?? 0
    const started = credits()
    lobby.tick(10)
    const played = credits()
    expect(played).toBeGreaterThan(started)

    lobby.disconnect(host)
    expect(opened(lobby).games.has(created.gameId)).toBe(true)
    lobby.tick(30)
    expect(credits()).toBe(played)

    const watcher = lobby.connect(watchSock)
    lobby.onLobby(watcher, { kind: LobbyClientKind.JoinGame, gameId: created.gameId })
    expect(latest<GameLobbyState>(watchSock, LobbyServerKind.GameLobby).spectating).toBe(true)
    lobby.tick(10)
    expect(credits()).toBeGreaterThan(played)
  })

  it('ends a match when the last human leaves, and when every human is defeated', async () => {
    const lobby = new Lobby()
    const hostSock = fake()
    const foeSock = fake()
    const watchSock = fake()
    const host = lobby.connect(hostSock)
    const foe = lobby.connect(foeSock)
    lobby.onLobby(host, { kind: LobbyClientKind.CreateGame })
    await settled()
    const created = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    lobby.onLobby(foe, { kind: LobbyClientKind.JoinGame, gameId: created.gameId })
    lobby.onLobby(host, { kind: LobbyClientKind.TakeSlot, index: 0 })
    lobby.onLobby(foe, { kind: LobbyClientKind.TakeSlot, index: 1 })
    lobby.onLobby(host, { kind: LobbyClientKind.SetSlotAi, index: 2 })
    lobby.onLobby(host, { kind: LobbyClientKind.StartGame })

    const watcher = lobby.connect(watchSock)
    lobby.onLobby(watcher, { kind: LobbyClientKind.JoinGame, gameId: created.gameId })
    lobby.onLobby(foe, { kind: LobbyClientKind.LeaveRoom })
    expect(opened(lobby).games.has(created.gameId)).toBe(true)
    expect(latest<WaitingRoom>(foeSock, LobbyServerKind.Waiting).you.id).toBe(foe.id)

    const match = opened(lobby).games.get(created.gameId)?.match
    expect(match).toBeTruthy()
    if (!match) return
    const sim = match.host as unknown as { ais: unknown[] }
    lobby.onLobby(host, { kind: LobbyClientKind.LeaveRoom })
    expect(latest<WaitingRoom>(hostSock, LobbyServerKind.Waiting).games).toEqual([])
    expect(latest<WaitingRoom>(watchSock, LobbyServerKind.Waiting).you.id).toBe(watcher.id)
    expect(opened(lobby).games.has(created.gameId)).toBe(false)
    expect(sim.ais).toEqual([])

    const again = new Lobby()
    const soloSock = fake()
    const solo = again.connect(soloSock)
    again.onLobby(solo, { kind: LobbyClientKind.CreateGame })
    await settled()
    const second = latest<GameLobbyState>(soloSock, LobbyServerKind.GameLobby)
    again.onLobby(solo, { kind: LobbyClientKind.TakeSlot, index: 0 })
    again.onLobby(solo, { kind: LobbyClientKind.SetSlotAi, index: 1 })
    again.onLobby(solo, { kind: LobbyClientKind.StartGame })
    const live = opened(again).games.get(second.gameId)?.match
    expect(live).toBeTruthy()
    if (!live) return
    const human = live.factions.find((faction) => !faction.ai)
    const bot = live.factions.find((faction) => faction.ai)
    expect(human && bot).toBeTruthy()
    if (!human || !bot) return
    for (const unit of live.host.game.units) {
      if (unit.ownerId === human.playerId) unit.health = 0
    }
    for (const town of live.host.game.scenery.towns) live.host.game.claimCity(town, bot.playerId)
    const purse = () => live.host.game.player(bot.playerId)?.credits ?? 0
    again.tick(1 / 30)
    expect(opened(again).games.has(second.gameId)).toBe(true)
    expect(latest<GameLobbyState>(soloSock, LobbyServerKind.GameLobby).factions.find((faction) => faction.playerId === human.playerId)?.defeated).toBe(true)
    const frozen = purse()
    again.tick(10)
    expect(purse()).toBe(frozen)
    again.disconnect(solo)
    expect(opened(again).games.has(second.gameId)).toBe(true)
    again.onLobby(solo, { kind: LobbyClientKind.LeaveRoom })
    expect(opened(again).games.has(second.gameId)).toBe(false)
  })

  it('returns a refreshed player to the same seat', async () => {
    const token = 'abc123abc123abc123abc123abc123ab'
    const lobby = new Lobby()
    const hostSock = fake()
    const host = lobby.connect(hostSock, token)
    lobby.onLobby(host, { kind: LobbyClientKind.SetName, name: 'Ada' })
    lobby.onLobby(host, { kind: LobbyClientKind.CreateGame })
    await settled()
    const created = latest<GameLobbyState>(hostSock, LobbyServerKind.GameLobby)
    expect(created.token).toBe(token)
    lobby.onLobby(host, { kind: LobbyClientKind.TakeSlot, index: 0 })
    lobby.onLobby(host, { kind: LobbyClientKind.SetSlotAi, index: 1 })
    lobby.disconnect(host)

    const backSock = fake()
    const back = lobby.connect(backSock, token)
    expect(back.id).toBe(host.id)
    const restored = latest<GameLobbyState>(backSock, LobbyServerKind.GameLobby)
    expect(restored.gameId).toBe(created.gameId)
    expect(restored.hostId).toBe(host.id)
    expect(restored.slots[0]).toMatchObject({ kind: SlotKind.Human, name: 'Ada', clientId: host.id })

    lobby.onLobby(back, { kind: LobbyClientKind.StartGame })
    const playing = latest<GameLobbyState>(backSock, LobbyServerKind.GameLobby)
    expect(playing.status).toBe(RoomStatus.Playing)
    expect(playing.spectating).toBe(false)
    const seat = playing.seatId
    lobby.disconnect(back)

    const againSock = fake()
    const again = lobby.connect(againSock, token)
    expect(again.id).toBe(host.id)
    const resumed = latest<GameLobbyState>(againSock, LobbyServerKind.GameLobby)
    expect(resumed.spectating).toBe(false)
    expect(resumed.seatId).toBe(seat)
    expect(againSock.game.some((message) => message.kind === ServerMessageKind.World)).toBe(true)
    expect(againSock.game.some((message) => message.kind === ServerMessageKind.Welcome && message.playerId === seat)).toBe(true)

    const otherSock = fake()
    const other = lobby.connect(otherSock, token)
    expect(other.id).not.toBe(host.id)
    expect(latest<WaitingRoom>(otherSock, LobbyServerKind.Waiting).token).not.toBe(token)
  })
})
