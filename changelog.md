# Changelog

## Current

- Selection works like Red Alert: Shift+click adds or removes a unit, Shift+drag adds a box, right-click deselects, double-click or double-tap selects every unit of that type on screen.
- Control groups: Ctrl+1–9 (or Alt+1–9) assigns, 1–9 selects, pressing the number twice centers the camera, Shift+number adds the group.
- Minimap: left press jumps the camera at once and dragging keeps panning; right click sends the selected units there.
- Units can be ordered into the fog. A group spreads over free tiles around the target, and a target on water, forest, or an enclosed spot sends units to the nearest reachable tile.
- Middle-click panning always lets go when the button is released.
- Smoother play over the network: units glide between server updates, corrections blend in instead of jumping, units start moving the moment you give an order, and a backgrounded tab catches up without reloading the map.
- Much less network traffic (about 5x less during battles and captures) and faster pathfinding, so large orders no longer stall the server.
- Steady unit speed on jittery connections: late network packets no longer slow the game down and speed it back up.
- Orders get their answer from the server straight away instead of on the next server tick.
- No more stutter while scouting or capturing cities: the island is rebuilt at most twice a second, and never for city changes.
- Turrets turn toward their target between server updates, and attack orders start turning and moving at once.
- The server does about a sixth of the fog-of-war work per player, leaving more headroom on small hosts.
- The HUD shows your ping to the server.
- Queued units, rally flags, the primary factory star and new building sites show the moment you click, then settle to the server's answer.
- The game connection is compressed, cutting traffic about 4x again.
- The minimap fog repaints a few times a second instead of every frame.
- Fewer network messages: routine updates (credits, training and build progress, map reveals, capture progress, position checks) are batched about five times a second, roughly halving messages in battle and cutting them by four fifths while only training.
- A connection that goes silent, for example when a phone switches networks, reconnects within seconds and keeps your seat.
- Reloading the page keeps your seat, and the server notices dropped connections within about twenty seconds.
- Move orders take the exact route at once: your game plans the same path the server will, and the server allows for your ping so both stay in step.
- Units are corrected only when your view drifts from the server, about ninety percent fewer position updates.
- Long matches no longer slow down as cities get damaged: the server keeps each city's layout instead of rebuilding it for every unit every tick (about 12x faster in a war-torn match).
- If the server ever falls behind, the game slows down with it instead of throwing away updates, which left holes in the map and kept asking for full resyncs.

## 0.4

- New structures: Airports, helipads, shipyards, 
- New units: jets, gunship, cruisers
- Fight on water, air, land.
- Credits cap at 10,000 plus 500 per population. Losing population throws away anything above the new cap.
- Structures require population
- Unit rebalancing
- Phones get a narrow order bar. Two fingers pan and pinch the map; the page itself does not zoom
- Nicer shroud / fog of war edges

## 0.3

- Cities and trees can be destroyed. 
- Armies require populations to sustain and build.
- Improved unit steering & pathing in narow paths
- Reduce artilery range
- Increased tank armours

## 0.2

- Conquer cities and hold them to earn credits. Leave units in a city and it grows.
- Improved fog of war.
- Construction spends credits while the work is underway, not when you queue it.
- Turn the camera with Q and E.
- Forests are denser.

## 0.1

- Island skirmish with selection, move, and attack orders.
- Pan, rotate, and zoom the camera.
