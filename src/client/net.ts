import { Channel, type LobbyClientMessage, type LobbyServerMessage } from '../shared/lobby.ts'
import { type ClientMessage, type ServerMessage } from '../shared/protocol.ts'

export class Net {
  onLobby: (message: LobbyServerMessage) => void = () => {}
  onGame: (message: ServerMessage) => void = () => {}
  onOpen: () => void = () => {}
  onClose: () => void = () => {}

  private socket: WebSocket | null = null
  private retry = 0

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${protocol}://${location.host}/ws`)
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.retry = 0
      this.onOpen()
    })
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return
      const wire = readWire(event.data)
      if (!wire) return
      if (wire.channel === Channel.Lobby) this.onLobby(wire.message as LobbyServerMessage)
      else if (wire.channel === Channel.Game) this.onGame(wire.message as ServerMessage)
    })
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return
      this.socket = null
      this.onClose()
      const wait = Math.min(4000, 400 * 2 ** this.retry)
      this.retry += 1
      window.setTimeout(() => this.connect(), wait)
    })
  }

  sendLobby(message: LobbyClientMessage) {
    this.send(Channel.Lobby, message)
  }

  sendGame(message: ClientMessage) {
    this.send(Channel.Game, message)
  }

  private send(channel: Channel, message: LobbyClientMessage | ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({ channel, message }))
  }
}

function readWire(text: string): { channel: number; message: unknown } | null {
  try {
    const wire = JSON.parse(text) as { channel?: unknown; message?: unknown }
    if (!wire || typeof wire.channel !== 'number' || !wire.message || typeof wire.message !== 'object') return null
    return { channel: wire.channel, message: wire.message }
  } catch {
    return null
  }
}
