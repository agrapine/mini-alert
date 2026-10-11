import { createServer } from 'node:http'
import { Buffer } from 'node:buffer'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type RawData } from 'ws'
import { Channel, type LobbyClientMessage } from '../shared/lobby.ts'
import type { ClientMessage } from '../shared/protocol.ts'
import { Lobby } from './lobby.ts'
import { serveClient } from './static.ts'

const PORT = Number(process.env.PORT) || 8787
const STEP = 1 / 30
const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist')

const lobby = new Lobby()
const httpServer = createServer((req, res) => {
  serveClient(clientRoot, req, res)
})
const sockets = new WebSocketServer({ server: httpServer, path: '/ws' })

sockets.on('connection', (socket) => {
  const member = lobby.connect({
    send(message) {
      send(socket, Channel.Lobby, message)
    },
    sendGame(message) {
      send(socket, Channel.Game, message)
    },
  })
  socket.on('message', (data) => {
    const wire = readWire(data)
    if (!wire) return
    if (wire.channel === Channel.Lobby) lobby.onLobby(member, wire.message as LobbyClientMessage)
    else if (wire.channel === Channel.Game) lobby.onGame(member, wire.message as ClientMessage)
  })
  socket.on('close', () => lobby.disconnect(member))
})

setInterval(() => lobby.tick(STEP), STEP * 1000)

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`server listening on ${PORT}`)
})

function send(socket: { readyState: number; send(data: string): void }, channel: Channel, message: unknown) {
  if (socket.readyState !== 1) return
  socket.send(JSON.stringify({ channel, message }))
}

function textOf(data: RawData): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString()
  if (Array.isArray(data)) return Buffer.concat(data).toString()
  return data.toString()
}

function readWire(data: RawData): { channel: number; message: unknown } | null {
  try {
    const text = textOf(data)
    const wire = JSON.parse(text) as { channel?: unknown; message?: unknown }
    if (!wire || typeof wire.channel !== 'number' || !wire.message || typeof wire.message !== 'object') return null
    return { channel: wire.channel, message: wire.message }
  } catch {
    return null
  }
}
