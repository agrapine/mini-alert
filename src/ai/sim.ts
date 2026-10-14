import { createWriteStream, type WriteStream } from 'node:fs'
import { finished } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { AiPlayer } from './player.ts'
import { laneName, scenarioName, type Thought } from './scenarios.ts'
import { generateIsland } from '../server/mapgen/generate.ts'
import { seatIsland } from '../server/island-match.ts'
import { ServerHost } from '../server/host.ts'
import { CREDIT_PER_POPULATION } from '../server/player.ts'
import type { Game } from '../server/game.ts'
import { clampAiPace, MapSize, slotsForSize } from '../shared/lobby.ts'
import { SIM_STEP } from '../shared/motion.ts'
import { playerColor } from '../shared/players.ts'
import { ClientMessageKind, type ClientMessage } from '../shared/protocol.ts'
import { UNIT_TYPES } from '../shared/unit-types.ts'

const NAMES = ['Blue', 'Red', 'Green', 'Gold', 'Purple', 'Teal', 'Orange', 'Pink', 'Lime', 'Sky', 'Tan', 'Coral', 'Aqua', 'Yellow', 'Violet', 'White']

const USAGE = `Usage: npm run ai -- [options]

Run AI against AI as fast as the CPU allows. Each bot plays through the same
fog and orders as a live match. Time is simulated one step at a time with no
wall-clock wait.

Options:
  --seed <n>       Map seed. Default: random. A collapsed map tries the next seeds.
  --size <name>    tiny (64), small (128), medium (192), or large (256). Default: tiny
  --players <n>    AI seats. Default: 2, capped by the map size
  --minutes <n>    Stop after this many simulated minutes. Default: 20
  --pace <n>       How often bots think, on the lobby pace scale. Default: 1
  --log <file>     JSONL thought trace, replaced each run. Default: ai-trace.jsonl
  --quiet          Skip the dashboard. Still writes the log and a summary
  --help           Show this help
`

type Options = {
  seed: number
  size: MapSize
  players: number
  minutes: number
  pace: number
  log: string
  quiet: boolean
}

type Seat = {
  id: number
  name: string
  color: number
  bot: AiPlayer
}

type Summary = {
  reason: string
  seed: number
  size: number
  minutes: number
  pace: number
  simSeconds: number
  wallSeconds: number
  speedup: number
  seats: { name: string; color: number; id: number; credits: number; pop: number; supply: number; cities: number; army: number; standing: boolean }[]
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : ''
if (import.meta.url === entry) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(USAGE)
    return
  }
  const options = parseOptions()
  const log = createWriteStream(options.log, { flags: 'w' })
  let tui = false
  try {
    tui = !options.quiet && Boolean(process.stdout.isTTY)
    if (tui) process.stdout.write('\x1b[?1049h\x1b[?25l')
    const summary = await simulate(options, log, tui)
    if (tui) {
      process.stdout.write('\x1b[?25h\x1b[?1049l')
      tui = false
    }
    console.log(summaryText(summary))
  } finally {
    if (tui) process.stdout.write('\x1b[?25h\x1b[?1049l')
    log.end()
    await finished(log)
  }
}

function parseOptions(): Options {
  const size = sizeArg()
  const cap = slotsForSize(size)
  const asked = Math.max(2, Math.floor(numberArg('--players', 2)))
  return {
    seed: Math.floor(numberArg('--seed', Math.random() * 1_000_000_000)),
    size,
    players: Math.min(cap, asked),
    minutes: Math.max(0.1, numberArg('--minutes', 20)),
    pace: clampAiPace(numberArg('--pace', 1)),
    log: stringArg('--log', 'ai-trace.jsonl'),
    quiet: process.argv.includes('--quiet'),
  }
}

async function simulate(options: Options, log: WriteStream, tui: boolean): Promise<Summary> {
  const rolled = openIsland(options.seed, options.size, options.players)
  options.seed = rolled.seed
  const island = rolled.island
  const colors = Array.from({ length: options.players }, (_, index) => ({ ai: true, color: playerColor(index + 1) }))
  const { game, players } = seatIsland(island, colors)
  const host = new ServerHost(game)
  const seats: Seat[] = players.map((player, index) => {
    const port = host.join(player)
    const bot = new AiPlayer(port)
    host.addAi(bot)
    host.sync(player.id)
    return { id: player.id, name: NAMES[index % NAMES.length], color: player.color, bot }
  })
  host.setAiPace(options.pace)
  write(log, { kind: 'start', seed: options.seed, size: options.size, players: options.players, minutes: options.minutes, pace: options.pace })

  let stop = false
  const onSigint = () => {
    stop = true
  }
  process.on('SIGINT', onSigint)
  const seen = new Map<number, number>()
  const lines: string[] = []
  const started = performance.now()
  let nextPaint = started
  let nextQuiet = 60
  let steps = 0
  let reason = 'time'
  const limit = options.minutes * 60
  try {
    while (!stop) {
      host.tick(SIM_STEP)
      steps += 1
      const sim = steps * SIM_STEP
      for (const seat of seats) {
        if (seat.bot.thinks === (seen.get(seat.id) ?? 0)) continue
        seen.set(seat.id, seat.bot.thinks)
        const thought = seat.bot.lastThought
        if (!thought) continue
        const text = `${clock(sim)}  ${seat.name}  ${thoughtText(thought)}`
        lines.push(text)
        if (lines.length > 8) lines.shift()
        write(log, { kind: 'think', t: round(sim), player: seat.id, name: seat.name, candidates: thought.candidates, orders: thought.orders })
      }
      if (sim >= limit) break
      if (steps % 30 === 0 && standingIds(game, seats).length <= 1) {
        reason = 'winner'
        break
      }
      const now = performance.now()
      if (tui && now >= nextPaint) {
        paint(options, game, seats, sim, (now - started) / 1000, lines)
        nextPaint = now + 100
      } else if (options.quiet && sim >= nextQuiet) {
        process.stderr.write(`${clock(sim)}  x${speedup(sim, (now - started) / 1000).toFixed(0)}  ${statusLine(game, seats)}\n`)
        nextQuiet += 60
      }
      if (steps % 30 === 0) await new Promise((resolve) => setImmediate(resolve))
    }
  } finally {
    process.off('SIGINT', onSigint)
  }
  if (stop) reason = 'stopped'
  const simSeconds = steps * SIM_STEP
  const wallSeconds = Math.max(0.001, (performance.now() - started) / 1000)
  const summary = finish(options, game, seats, reason, simSeconds, wallSeconds)
  write(log, { kind: 'end', reason, simSeconds: round(simSeconds), wallSeconds: round(wallSeconds), speedup: round(summary.speedup), winner: summary.seats.filter((seat) => seat.standing).map((seat) => seat.name) })
  return summary
}

function finish(options: Options, game: Game, seats: readonly Seat[], reason: string, simSeconds: number, wallSeconds: number): Summary {
  const alive = new Set(standingIds(game, seats))
  return {
    reason,
    seed: options.seed,
    size: options.size,
    minutes: options.minutes,
    pace: options.pace,
    simSeconds,
    wallSeconds,
    speedup: speedup(simSeconds, wallSeconds),
    seats: seats.map((seat) => {
      const stats = tally(game, seat.id)
      return { name: seat.name, color: seat.color, id: seat.id, ...stats, standing: alive.has(seat.id) }
    }),
  }
}

function paint(options: Options, game: Game, seats: readonly Seat[], sim: number, wall: number, lines: readonly string[]) {
  const width = Math.max(40, process.stdout.columns || 80)
  const header = `RTS  ${clock(sim)}   x${speedup(sim, wall).toFixed(0)}   seed ${options.seed}   ${options.size}x${options.size}   pace ${options.pace.toFixed(2)}`
  const body = seats.flatMap((seat) => {
    const stats = tally(game, seat.id)
    const name = colorText(seat.color, seat.name.padEnd(7))
    const row = `${name} ${String(Math.round(stats.credits)).padStart(6)} cr   pop ${String(stats.pop).padStart(3)}   sup ${String(stats.supply).padStart(3)}   cities ${stats.cities}   army ${stats.army}`
    return [row, `        ${thoughtText(seat.bot.lastThought)}`]
  })
  const rows = [header, '', ...body, '', ...lines].map((line) => `${fit(line, width)}\x1b[K`)
  process.stdout.write(`\x1b[H${rows.join('\n')}\x1b[J`)
}

function fit(line: string, width: number): string {
  let visible = 0
  let out = ''
  for (let i = 0; i < line.length && visible < width; i++) {
    if (line[i] !== '\x1b') {
      out += line[i]
      visible += 1
      continue
    }
    const end = line.indexOf('m', i)
    if (end < 0) break
    out += line.slice(i, end + 1)
    i = end
  }
  if (visible >= width) out += '\x1b[0m'
  return out
}

function summaryText(summary: Summary): string {
  const alive = summary.seats.filter((seat) => seat.standing)
  const winner = summary.reason === 'winner' && alive.length === 1 ? alive[0].name : summary.reason
  const rows = summary.seats.map((seat) => {
    const mark = seat.standing ? 'up' : 'out'
    return `${seat.name.padEnd(7)} ${mark.padEnd(4)} ${String(Math.round(seat.credits)).padStart(6)} cr   pop ${String(seat.pop).padStart(3)}   sup ${String(seat.supply).padStart(3)}   cities ${seat.cities}   army ${seat.army}`
  })
  return [
    `AI sim ${winner}   seed ${summary.seed}   ${summary.size}x${summary.size}   pace ${summary.pace.toFixed(2)}`,
    `sim ${clock(summary.simSeconds)}   wall ${summary.wallSeconds.toFixed(1)}s   x${summary.speedup.toFixed(0)}`,
    ...rows,
  ].join('\n')
}

function thoughtText(thought: Thought | null): string {
  if (!thought || thought.candidates.length === 0) return 'waiting'
  const parts = thought.candidates.map((candidate) => {
    const name = `${laneName(candidate.lane)} ${scenarioName(candidate.scenario)}`
    if (candidate.blocked) return `${name} blocked: ${candidate.blocked}`
    if (candidate.orders === 0) return `${name} holding`
    return name
  })
  const orders = thought.orders.map(describeOrder)
  if (orders.length > 0) parts.push(orders.join(', '))
  return parts.join(' · ')
}

function describeOrder(order: ClientMessage): string {
  if (order.kind === ClientMessageKind.OrderMove) return `move #${order.unitIds.join(',#')} ${order.tile.x},${order.tile.y}`
  if (order.kind === ClientMessageKind.OrderAttack) return `attack #${order.unitIds.join(',#')} #${order.targetId}`
  if (order.kind === ClientMessageKind.Spawn) return `train ${UNIT_TYPES[order.typeId].label}`
  if (order.kind === ClientMessageKind.PlaceBuilding) return `build ${UNIT_TYPES[order.typeId].label} ${order.tile.x},${order.tile.y}`
  return 'order'
}

function statusLine(game: Game, seats: readonly Seat[]): string {
  return seats.map((seat) => {
    const stats = tally(game, seat.id)
    return `${seat.name} cities ${stats.cities} army ${stats.army}`
  }).join('  ')
}

function tally(game: Game, playerId: number): { credits: number; pop: number; supply: number; cities: number; army: number } {
  const player = game.player(playerId)
  let supply = 0
  let army = 0
  for (const unit of game.units) {
    if (unit.ownerId !== playerId || unit.health <= 0) continue
    supply += unit.type.supply
    if (unit.type.topSpeed > 0 && unit.progress >= 1) army += 1
  }
  let cities = 0
  for (const city of game.cityStates()) if (city.ownerId === playerId) cities += 1
  return {
    credits: player?.credits ?? 0,
    pop: game.creditIncome(playerId) / CREDIT_PER_POPULATION,
    supply,
    cities,
    army,
  }
}

function standingIds(game: Game, seats: readonly Seat[]): number[] {
  return seats.filter((seat) => standing(game, seat.id)).map((seat) => seat.id)
}

function standing(game: Game, playerId: number): boolean {
  for (const unit of game.units) {
    if (unit.ownerId === playerId && unit.health > 0) return true
  }
  for (const city of game.cityStates()) {
    if (city.ownerId === playerId) return true
  }
  return false
}

function colorText(color: number, text: string): string {
  const red = (color >> 16) & 255
  const green = (color >> 8) & 255
  const blue = color & 255
  return `\x1b[38;2;${red};${green};${blue}m${text}\x1b[0m`
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole / 60) % 60
  const secs = whole % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  if (hours > 0) return `${hours}:${mm}:${ss}`
  return `${mm}:${ss}`
}

function speedup(simSeconds: number, wallSeconds: number): number {
  return simSeconds / Math.max(0.001, wallSeconds)
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function write(log: WriteStream, record: unknown) {
  log.write(`${JSON.stringify(record)}\n`)
}

function numberArg(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) ? value : fallback
}

function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value && !value.startsWith('--') ? value : fallback
}

function openIsland(seed: number, size: number, players: number) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const next = seed + attempt
    try {
      const island = generateIsland(next, size, size)
      if (island.towns.length >= players) return { island, seed: next }
    } catch {
      // The coast ate every county but one. The lobby skips these seeds too.
    }
  }
  throw new Error('island collapsed')
}

function sizeArg(): MapSize {
  const name = stringArg('--size', 'tiny')
  if (name === 'tiny') return MapSize.Tiny
  if (name === 'small') return MapSize.Small
  if (name === 'medium') return MapSize.Medium
  if (name === 'large') return MapSize.Large
  throw new Error(`unknown size ${name}. Use tiny, small, medium, or large.`)
}
