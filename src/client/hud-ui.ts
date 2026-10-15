import type { Faction } from '../shared/lobby.ts'
import { Locomotion, UNIT_TYPES, UnitTypeId } from '../shared/unit-types.ts'
import { focusLabel, PingState, TileKind, Trend, type HudModel, type HudTile } from './hud-model.ts'
import { bindTrace, type TracePaint } from './trace-pie.ts'
import '@fontsource/saira-stencil-one/latin-400.css'
import './console.css'
import './hud.css'

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
<header id="menubar">
  <p class="hud-logo">MINI ALERT</p>
  <p id="battle"></p>
  <div id="stats">
    <p class="readout"><span class="readout-label">Credits</span><span class="readout-value"><span id="credits"></span><span class="trend" aria-hidden="true"></span></span></p>
    <p class="readout"><span class="readout-label">Units</span><span class="readout-value"><span id="forces"></span><span> / </span><span class="cap"></span></span></p>
    <p class="readout pop"><span class="readout-label">Pop</span><span class="readout-value" id="population"></span></p>
    <p class="readout"><span class="readout-label">Cities</span><span class="readout-value" id="cities"></span></p>
  </div>
  <div class="hud-controls">
    <p class="ping" title="Round trip to the server"><span id="ping"></span><span class="ping-dot" aria-hidden="true">◉</span></p>
    <div id="menu" class="menu">
      <button type="button" class="plate" data-open="menu">Menu</button>
      <div class="dropdown">
        <div class="menu-group" role="group" aria-label="Settings">
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
        <div class="menu-group">
          <button type="button" data-open="changelog">Changelog</button>
          <button type="button" data-open="fullscreen">Full screen <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg></button>
          <button type="button" class="danger" data-dismiss>Surrender</button>
        </div>
      </div>
    </div>
    <button type="button" class="plate" data-open="help" aria-label="Help" title="Help">?</button>
  </div>
</header>
<div id="sheet" hidden>
  <div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <header>
      <h2 id="sheet-title"></h2>
      <button type="button" class="plate" id="sheet-close">Close</button>
    </header>
    <div id="sheet-body"></div>
  </div>
</div>
<aside id="side">
  <section class="hud-panel" id="radar-panel" aria-labelledby="radar-title">
    <header class="panel-head"><span class="panel-index" aria-hidden="true">01</span><h2 id="radar-title">Radar</h2></header>
    <div class="radar-frame">
      <div id="minimap">
        <canvas id="minimap-map"></canvas>
        <canvas id="minimap-marks"></canvas>
      </div>
      <span class="radar-ring" aria-hidden="true"></span>
    </div>
  </section>
  <section class="hud-panel" id="build-panel" aria-labelledby="build-title">
    <header class="panel-head"><span class="panel-index" aria-hidden="true">02</span><h2 id="build-title">Build</h2></header>
    <div class="panel-scroll">
      <div id="orders"></div>
      <div id="city-focus" hidden>
        <p id="city-focus-name">City hall</p>
        <p id="city-focus-label">Balanced</p>
        <input id="city-focus-range" type="range" min="-2" max="2" step="1" value="0" aria-label="City focus">
      </div>
    </div>
  </section>
  <section class="hud-panel" id="vision-panel" aria-labelledby="vision-title" hidden>
    <header class="panel-head"><span class="panel-index" aria-hidden="true">02</span><h2 id="vision-title">Vision</h2></header>
    <div class="panel-scroll" id="plates"></div>
  </section>
</aside>
<div id="legend" hidden></div>
<div id="outcome" hidden>
  <div class="outcome-card" role="dialog" aria-modal="true" aria-labelledby="outcome-title">
    <h2 id="outcome-title"></h2>
    <p id="outcome-text"></p>
    <button type="button" class="plate" id="outcome-close">Close</button>
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
  private readonly battle: HTMLElement
  private readonly credits: HTMLElement
  private readonly trend: HTMLElement
  private readonly forces: HTMLElement
  private readonly cap: HTMLElement
  private readonly population: HTMLElement
  private readonly cities: HTMLElement
  private readonly ping: HTMLElement
  private readonly orders: HTMLElement
  private readonly queueSplit: HTMLElement
  private readonly cityFocus: HTMLElement
  private readonly focusLabel: HTMLElement
  private readonly focusRange: HTMLInputElement
  private readonly build: HTMLElement
  private readonly vision: HTMLElement
  private readonly plates: HTMLElement
  private readonly leave: HTMLButtonElement
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
    this.battle = find('#battle')
    this.credits = find('#credits')
    this.trend = find('#stats .trend')
    this.forces = find('#forces')
    this.cap = find('#stats .cap')
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
    this.build = find('#build-panel')
    this.vision = find('#vision-panel')
    this.plates = find('#plates')
    this.leave = document.createElement('button')
    this.leave.type = 'button'
    this.leave.className = 'plate'
    this.leave.textContent = 'Leave'
    this.leave.addEventListener('click', () => this.actions.leave())
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
    setText(this.trend, credits.trend === Trend.Up ? '▲' : credits.trend === Trend.Down ? '▼' : '')
    setText(this.forces, String(model.army))
    this.forces.classList.toggle('over', model.over)
    setText(this.cap, String(model.population))
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

  setBattle(gameId: number) {
    setText(this.battle, `Battle #${gameId}`)
  }

  setFactions(factions: readonly Faction[], spectating: boolean, viewedId: number | null) {
    this.build.hidden = spectating
    this.vision.hidden = !spectating
    this.plates.replaceChildren()
    if (spectating) {
      for (const faction of factions) {
        const plate = document.createElement('button')
        plate.type = 'button'
        plate.className = 'faction-plate'
        plate.setAttribute('aria-pressed', String(faction.playerId === viewedId))
        plate.append(...factionMark(faction))
        plate.addEventListener('click', () => this.actions.viewAs(faction.playerId))
        this.plates.append(plate)
      }
      this.plates.append(this.leave)
    }
    this.legend.hidden = false
    this.legend.replaceChildren()
    for (const faction of factions) {
      const row = document.createElement('div')
      row.className = 'legend-row'
      row.classList.toggle('defeated', faction.defeated)
      row.append(...factionMark(faction))
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
    this.build.hidden = false
    this.vision.hidden = true
    this.plates.replaceChildren()
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

function factionMark(faction: Faction): [HTMLElement, HTMLElement] {
  const swatch = document.createElement('i')
  swatch.className = 'swatch'
  swatch.style.background = cssColor(faction.color)
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = faction.name
  return [swatch, name]
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
