import { logGameIn, logGameOut, logGameUndecodable, logLobbyIn, logLobbyOut } from './debug-net.ts'
import { ensureSeatToken } from './seat.ts'
import { decodeServerFrame, encodeClientMessage } from '../shared/codec.ts'
import { Channel, type LobbyClientMessage, type LobbyServerMessage } from '../shared/lobby.ts'
import { type ClientMessage, type ServerFrame } from '../shared/protocol.ts'

export class Net {
  onLobby: (message: LobbyServerMessage) => void = () => {}
  onGame: (message: ServerFrame) => void = () => {}
  onOpen: () => void = () => {}
  onClose: () => void = () => {}

  private socket: WebSocket | null = null
  private retry = 0

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const seat = encodeURIComponent(ensureSeatToken())
    const socket = new WebSocket(`${protocol}://${location.host}/ws?seat=${seat}`)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.retry = 0
      this.onOpen()
    })
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return
      if (typeof event.data === 'string') {
        const wire = readWire(event.data)
        if (!wire) return
        if (wire.channel === Channel.Lobby) {
          const message = wire.message as LobbyServerMessage
          logLobbyIn(message)
          this.onLobby(message)
        }
        return
      }
      const bytes = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : null
      if (!bytes && event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buffer) => {
          if (this.socket !== socket) return
          const frame = decodeServerFrame(new Uint8Array(buffer))
          if (!frame) {
            logGameUndecodable(buffer.byteLength)
            return
          }
          logGameIn(frame)
          this.onGame(frame)
        })
        return
      }
      if (!bytes) return
      const frame = decodeServerFrame(bytes)
      if (!frame) {
        logGameUndecodable(bytes.byteLength)
        return
      }
      logGameIn(frame)
      this.onGame(frame)
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
    if (this.socket?.readyState !== WebSocket.OPEN) return
    logLobbyOut(message)
    this.socket.send(JSON.stringify({ channel: Channel.Lobby, message }))
  }

  sendGame(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    logGameOut(message)
    const payload = encodeClientMessage(message)
    const copy = new ArrayBuffer(payload.byteLength)
    new Uint8Array(copy).set(payload)
    this.socket.send(copy)
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
