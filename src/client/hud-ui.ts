import type { Faction } from '../shared/lobby.ts'
import { Locomotion, UNIT_TYPES, UnitTypeId } from '../shared/unit-types.ts'
import { focusLabel, PingState, TileKind, Trend, type HudModel, type HudTile } from './hud-model.ts'
import { bindTrace, type TracePaint } from './trace-pie.ts'

export type HudActions = {
  armBuilding(typeId: UnitTypeId): void
  cancelBuild(typeId: UnitTypeId): void
  armCity(): void
  spawn(typeId: UnitTypeId): void
  cancelSpawn(typeId: UnitTypeId, yardId: number): void
  cancelQueued(typeId: UnitTypeId): void
  setCityFocus(step: number): void
  viewAs(playerId: number): void
  leave(): void
}

export type CreditReadout = { shown: number; trend: Trend }

const MARKUP = `
<nav id="menubar">
  <div id="menu" class="menu">
    <button type="button" data-open="menu">Menu</button>
    <div class="dropdown">
      <button type="button" data-dismiss>Surrender</button>
      <div class="submenu">
        <button type="button">Settings <span class="caret">›</span></button>
        <div class="flyout">
          <button type="button" data-toggle="music" aria-pressed="true">Music <span class="mark">On</span></button>
          <div class="volume">
            <label for="music-volume">Music volume</label>
            <output class="mark" for="music-volume"></output>
            <input type="range" id="music-volume" data-volume="musicVolume" min="0" max="100" step="5" value="40">
          </div>
          <button type="button" data-toggle="sounds" aria-pressed="true">Sounds <span class="mark">On</span></button>
          <div class="volume">
            <label for="sounds-volume">Sounds volume</label>
            <output class="mark" for="sounds-volume"></output>
            <input type="range" id="sounds-volume" data-volume="soundsVolume" min="0" max="100" step="5" value="100">
          </div>
          <button type="button" data-toggle aria-pressed="true">Input <span class="mark">On</span></button>
        </div>
      </div>
    </div>
  </div>
  <button type="button" data-open="changelog">Changelog</button>
  <button type="button" data-open="help">Help</button>
  <button type="button" id="fullscreen" data-open="fullscreen" aria-label="Full screen" title="Full screen">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>
  </button>
</nav>
<div id="sheet" hidden>
  <div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <header>
      <h2 id="sheet-title"></h2>
      <button type="button" id="sheet-close">Close</button>
    </header>
    <div id="sheet-body"></div>
  </div>
</div>
<div id="stats">
  <div class="stat" title="Credits">
    <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="16" rx="7" ry="3" fill="none" stroke="currentColor" stroke-width="1.7"/><ellipse cx="12" cy="12" rx="7" ry="3" fill="none" stroke="currentColor" stroke-width="1.7"/><ellipse cx="12" cy="8" rx="7" ry="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>
    <span id="credits"></span>
  </div>
  <div class="stat" title="Units">
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="6" height="6" rx="1" fill="currentColor"/><rect x="9" y="5" width="6" height="6" rx="1" fill="currentColor"/><rect x="15" y="13" width="6" height="6" rx="1" fill="currentColor"/></svg>
    <span id="forces"></span>
  </div>
  <div class="stat" title="Population">
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="2.2" fill="currentColor"/><circle cx="16" cy="9" r="1.8" fill="currentColor"/><path d="M4.5 18c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M13 18c.4-2 1.7-3.2 3.3-3.2 1.5 0 2.7 1 3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    <span id="population"></span>
  </div>
  <div class="stat" title="Cities">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10l5-3v13M9 20V7l6-3v16M15 20V9l5 2v9M3 20h18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
    <span id="cities"></span>
  </div>
  <div class="stat ping" title="Round trip to the server">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h2v-3H4zM9 19h2v-6H9zM14 19h2V9h-2zM19 19h2V5h-2z" fill="currentColor"/></svg>
    <span id="ping"></span>
  </div>
</div>
<aside id="side">
  <div id="minimap">
    <canvas id="minimap-map"></canvas>
    <canvas id="minimap-marks"></canvas>
  </div>
  <div id="orders"></div>
  <div id="city-focus" hidden>
    <p id="city-focus-name">City hall</p>
    <p id="city-focus-label">Balanced</p>
    <input id="city-focus-range" type="range" min="-2" max="2" step="1" value="0" aria-label="City focus">
  </div>
</aside>
<div id="vision" hidden></div>
<div id="legend" hidden></div>
<div id="outcome" hidden>
  <div class="outcome-card" role="dialog" aria-modal="true" aria-labelledby="outcome-title">
    <h2 id="outcome-title"></h2>
    <p id="outcome-text"></p>
    <button type="button" id="outcome-close">Close</button>
  </div>
</div>
<div id="trace" hidden>
  <div id="trace-pie"><span id="trace-hole"></span></div>
  <div id="trace-readout">
    <ul id="trace-list"></ul>
    <p id="trace-total"></p>
  </div>
</div>
`

type TileNode = {
  tile: HudTile
  button: HTMLButtonElement
  pie: HTMLElement
  badge: HTMLElement
  hotkey: HTMLElement
  cost: HTMLElement
}

export class HudView {
  private readonly credits: HTMLElement
  private readonly forces: HTMLElement
  private readonly population: HTMLElement
  private readonly cities: HTMLElement
  private readonly ping: HTMLElement
  private readonly orders: HTMLElement
  private readonly queueSplit: HTMLElement
  private readonly cityFocus: HTMLElement
  private readonly focusLabel: HTMLElement
  private readonly focusRange: HTMLInputElement
  private readonly vision: HTMLElement
  private readonly legend: HTMLElement
  private readonly outcome: HTMLElement
  private readonly outcomeTitle: HTMLElement
  private readonly outcomeText: HTMLElement
  private readonly trace: ReturnType<typeof bindTrace>
  private readonly tiles: TileNode[] = []
  private yard: number | null = null

  constructor(
    root: HTMLElement,
    private readonly actions: HudActions,
  ) {
    root.innerHTML = MARKUP
    const find = <T extends HTMLElement = HTMLElement>(selector: string): T => {
      const found = root.querySelector<T>(selector)
      if (!found) throw new Error(`missing ${selector}`)
      return found
    }
    this.credits = find('#credits')
    this.forces = find('#forces')
    this.population = find('#population')
    this.cities = find('#cities')
    this.ping = find('#ping')
    this.orders = find('#orders')
    this.queueSplit = document.createElement('div')
    this.queueSplit.className = 'queue-split'
    this.queueSplit.textContent = 'Queued: '
    this.queueSplit.hidden = true
    this.cityFocus = find('#city-focus')
    this.focusLabel = find('#city-focus-label')
    this.focusRange = find<HTMLInputElement>('#city-focus-range')
    this.focusRange.addEventListener('input', () => {
      const step = Number(this.focusRange.value)
      this.focusLabel.textContent = focusLabel(step)
      this.actions.setCityFocus(step)
    })
    this.vision = find('#vision')
    this.legend = find('#legend')
    this.outcome = find('#outcome')
    this.outcomeTitle = find('#outcome-title')
    this.outcomeText = find('#outcome-text')
    find('#outcome-close').addEventListener('click', () => {
      this.outcome.hidden = true
    })
    this.outcome.addEventListener('click', (event) => {
      if (event.target === this.outcome) this.outcome.hidden = true
    })
    this.trace = bindTrace(find('#trace'))
  }

  paint(model: HudModel, credits: CreditReadout) {
    setText(this.credits, Math.round(credits.shown).toLocaleString('en-US'))
    this.credits.classList.toggle('up', credits.trend === Trend.Up)
    this.credits.classList.toggle('down', credits.trend === Trend.Down)
    setText(this.forces, String(model.army))
    this.forces.classList.toggle('over', model.over)
    setText(this.population, String(model.population))
    setText(this.cities, String(model.cities))
    const ping = model.ping
    setText(this.ping, ping.state === PingState.None ? '–' : `${ping.ms} ms`)
    this.ping.classList.toggle('slow', ping.state === PingState.Slow || ping.state === PingState.Bad)
    this.ping.classList.toggle('bad', ping.state === PingState.Bad)
    this.orders.hidden = model.hall !== null
    this.cityFocus.hidden = model.hall === null
    if (model.hall !== null && document.activeElement !== this.focusRange) {
      const focus = String(model.hall.focus)
      if (this.focusRange.value !== focus) this.focusRange.value = focus
      setText(this.focusLabel, model.hall.label)
    }
    this.queueSplit.hidden = !model.queued
    this.yard = model.yard
    for (let i = 0; i < model.tiles.length; i++) {
      const tile = model.tiles[i]
      paintTile(this.tiles[i] ?? this.createTile(tile), tile)
    }
  }

  setFactions(factions: readonly Faction[], spectating: boolean, viewedId: number | null) {
    this.vision.hidden = !spectating
    this.vision.replaceChildren()
    if (spectating) {
      for (const faction of factions) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = faction.name
        button.style.color = cssColor(faction.color)
        button.classList.toggle('on', faction.playerId === viewedId)
        button.addEventListener('click', () => this.actions.viewAs(faction.playerId))
        this.vision.append(button)
      }
      const leave = document.createElement('button')
      leave.type = 'button'
      leave.textContent = 'Leave'
      leave.addEventListener('click', () => this.actions.leave())
      this.vision.append(leave)
    }
    this.legend.hidden = false
    this.legend.replaceChildren()
    for (const faction of factions) {
      const row = document.createElement('div')
      row.className = 'legend-row'
      row.classList.toggle('defeated', faction.defeated)
      const swatch = document.createElement('i')
      swatch.style.background = cssColor(faction.color)
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = faction.name
      row.append(swatch, name)
      if (faction.defeated) {
        const tag = document.createElement('span')
        tag.className = 'tag'
        tag.textContent = 'defeated'
        row.append(tag)
      }
      this.legend.append(row)
    }
  }

  showOutcome(title: string, text: string) {
    this.outcomeTitle.textContent = title
    this.outcomeText.textContent = text
    this.outcome.hidden = false
  }

  paintTrace(frame: TracePaint) {
    this.trace.paint(frame)
  }

  clear() {
    this.vision.hidden = true
    this.vision.replaceChildren()
    this.legend.hidden = true
    this.legend.replaceChildren()
    this.outcome.hidden = true
    this.trace.hide()
  }

  /** Presses the tile labelled F<slot>; false when no shown tile carries that label. */
  pressSlot(slot: number, shift: boolean): boolean {
    const node = this.tiles.find((entry) => entry.tile.slot === slot)
    if (!node) return false
    if (shift) this.remove(node.tile)
    else if (node.tile.ready) this.add(node.tile)
    return true
  }

  private add(tile: HudTile) {
    if (tile.kind === TileKind.City) this.actions.armCity()
    else if (tile.kind === TileKind.Structure) this.actions.armBuilding(tile.type)
    else if (tile.kind === TileKind.Train) this.actions.spawn(tile.type)
  }

  private remove(tile: HudTile) {
    if (tile.kind === TileKind.Structure) this.actions.cancelBuild(tile.type)
    else if (tile.kind === TileKind.Queued) this.actions.cancelQueued(tile.type)
    else if (tile.kind === TileKind.Train && this.yard !== null) this.actions.cancelSpawn(tile.type, this.yard)
  }

  private createTile(tile: HudTile): TileNode {
    const name = tile.kind === TileKind.City ? 'Building' : UNIT_TYPES[tile.type].label
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `tile ${tileClass(tile.kind === TileKind.City ? null : tile.type)}`
    button.title = name
    const pie = document.createElement('span')
    pie.className = 'pie'
    const label = document.createElement('span')
    label.className = 'name'
    label.textContent = name
    const cost = document.createElement('span')
    cost.className = 'cost'
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.hidden = true
    const hotkey = document.createElement('span')
    hotkey.className = 'hotkey'
    button.append(pie, label, cost, badge, hotkey)
    const node: TileNode = { tile, button, pie, badge, hotkey, cost }
    button.addEventListener('click', (event) => {
      if (node.tile.kind === TileKind.Queued || event.shiftKey) this.remove(node.tile)
      else if (node.tile.ready) this.add(node.tile)
    })
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      this.remove(node.tile)
    })
    if (tile.kind === TileKind.Queued && !this.queueSplit.isConnected) this.orders.append(this.queueSplit)
    this.orders.append(button)
    this.tiles.push(node)
    return node
  }
}

function paintTile(node: TileNode, tile: HudTile) {
  node.tile = tile
  node.button.hidden = !tile.visible
  const amount = Math.max(0, Math.min(1, tile.progress))
  node.pie.style.setProperty('--p', String(amount))
  node.pie.classList.toggle('on', amount > 0)
  node.badge.hidden = !tile.badge
  setText(node.badge, tile.badge ? String(tile.count) : '')
  node.button.classList.toggle('ready', tile.ready)
  node.button.classList.toggle('live', tile.count > 0 || tile.progress > 0 || tile.armed)
  node.button.classList.toggle('armed', tile.armed)
  setText(node.cost, tile.cost)
  setText(node.hotkey, tile.slot === null ? '' : `F${tile.slot}`)
}

function setText(element: HTMLElement, text: string) {
  if (element.textContent !== text) element.textContent = text
}

function tileClass(id: UnitTypeId | null): 'structure' | 'vehicle' | 'air' | 'boat' {
  if (id === null) return 'structure'
  const type = UNIT_TYPES[id]
  if (type.topSpeed <= 0) return 'structure'
  if (type.locomotion === Locomotion.Plane || type.locomotion === Locomotion.Rotor) return 'air'
  if (type.locomotion === Locomotion.Hull) return 'boat'
  return 'vehicle'
}

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}
