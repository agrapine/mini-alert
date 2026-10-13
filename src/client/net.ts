import { logGameIn, logGameOut, logGameUndecodable, logLobbyIn, logLobbyOut } from './debug-net.ts'
import { seatToken } from './seat.ts'
import { decodeServerFrame, encodeClientMessage } from '../shared/codec.ts'
import { Channel, type LobbyClientMessage, type LobbyServerMessage } from '../shared/lobby.ts'
import { type ClientMessage, type ServerFrame } from '../shared/protocol.ts'

const RTT_BLEND = 0.25

export class Net {
  onLobby: (message: LobbyServerMessage) => void = () => {}
  onGame: (message: ServerFrame) => void = () => {}
  onOpen: () => void = () => {}
  onClose: () => void = () => {}
  /** Smoothed time from sending a command to the frame that acknowledges it, in milliseconds. */
  rtt: number | null = null

  private socket: WebSocket | null = null
  private retry = 0
  private seq = 0
  private readonly sentAt = new Map<number, number>()
  private heardAt = 0
  private readonly seat = seatToken()

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${protocol}://${location.host}/ws?seat=${this.seat}`)
    socket.binaryType = 'arraybuffer'
    this.socket = socket
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return
      this.retry = 0
      this.heardAt = performance.now()
      this.onOpen()
    })
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return
      this.heardAt = performance.now()
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
          this.noteAck(frame.ack)
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
      this.noteAck(frame.ack)
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

  /** Milliseconds since the open socket last delivered anything; null while no socket is open. */
  quietFor(): number | null {
    if (this.socket?.readyState !== WebSocket.OPEN) return null
    return performance.now() - this.heardAt
  }

  /** Abandons the current socket without waiting for its close handshake and connects again at once. */
  drop() {
    const socket = this.socket
    if (!socket) return
    this.socket = null
    socket.close()
    this.onClose()
    this.connect()
  }

  /** Closes the socket and stays offline until `connect` is called again. */
  pause() {
    const socket = this.socket
    this.socket = null
    socket?.close()
  }

  sendLobby(message: LobbyClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    logLobbyOut(message)
    this.socket.send(JSON.stringify({ channel: Channel.Lobby, message }))
  }

  sendGame(message: ClientMessage, tick: number): number | null {
    if (this.socket?.readyState !== WebSocket.OPEN) return null
    logGameOut(message)
    this.seq += 1
    const payload = encodeClientMessage(message, this.seq, tick)
    const copy = new ArrayBuffer(payload.byteLength)
    new Uint8Array(copy).set(payload)
    this.socket.send(copy)
    this.sentAt.set(this.seq, performance.now())
    return this.seq
  }

  private noteAck(ack: number) {
    for (const [seq, at] of this.sentAt) {
      if (seq > ack) continue
      const sample = performance.now() - at
      this.rtt = this.rtt === null ? sample : this.rtt + (sample - this.rtt) * RTT_BLEND
      this.sentAt.delete(seq)
    }
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
