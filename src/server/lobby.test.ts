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
})
