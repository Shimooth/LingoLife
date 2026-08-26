import {
  OPPOSITE_ROAD_DIRECTION,
  ROAD_DIRECTION_OFFSET,
  ROAD_TILES,
  ROAD_TILE_STEP,
  SKY_ROAD_EXITS,
  roadConnections,
} from '../src/three/world/worldData.ts'

const fail = message => {
  throw new Error(`World road guard failed: ${message}`)
}

const close = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance
const cellFor = ([x, z]) => [Math.round(x / ROAD_TILE_STEP), Math.round(z / ROAD_TILE_STEP)]
const cellKey = ([gx, gz]) => `${gx},${gz}`
const portKey = (cell, direction) => `${cellKey(cell)}:${direction}`

// These are the only road ports intentionally left without another KayKit
// tile. Each one continues over a suspended deck into the surrounding world.
const outboundPorts = new Map([
  ['-14,0:west', 'west-cloudway'],
  ['14,0:east', 'east-cloudway'],
  ['-2,-10:north', 'north-aetherway'],
])

const exits = new Set(SKY_ROAD_EXITS.map(exit => exit.id))
for (const exitId of outboundPorts.values()) {
  if (!exits.has(exitId)) fail(`outbound port references missing sky-road ${exitId}`)
}
if (SKY_ROAD_EXITS.length !== outboundPorts.size) {
  fail(`${SKY_ROAD_EXITS.length} sky-road decks exist for ${outboundPorts.size} outbound ports`)
}

const byCell = new Map()
const byId = new Set()
for (const road of ROAD_TILES) {
  if (byId.has(road.id)) fail(`duplicate road id ${road.id}`)
  byId.add(road.id)
  const cell = cellFor(road.position)
  const key = cellKey(cell)
  if (byCell.has(key)) fail(`duplicate road cell ${key}`)
  if (!close(road.position[0], cell[0] * ROAD_TILE_STEP) || !close(road.position[1], cell[1] * ROAD_TILE_STEP)) {
    fail(`${road.id} is not aligned to the ${ROAD_TILE_STEP}-unit grid`)
  }
  if (!close(road.rotation / (Math.PI / 2), Math.round(road.rotation / (Math.PI / 2)))) {
    fail(`${road.id} rotation is not a quarter turn`)
  }
  byCell.set(key, road)
}

const graph = new Map(ROAD_TILES.map(road => [road.id, new Set()]))
const seenOutbound = new Set()
for (const road of ROAD_TILES) {
  const cell = cellFor(road.position)
  const ports = new Set(roadConnections(road))
  for (const [direction, offset] of Object.entries(ROAD_DIRECTION_OFFSET)) {
    const neighbourCell = [cell[0] + offset[0], cell[1] + offset[1]]
    const neighbour = byCell.get(cellKey(neighbourCell))
    const hasPort = ports.has(direction)
    const neighbourHasPort = neighbour
      ? new Set(roadConnections(neighbour)).has(OPPOSITE_ROAD_DIRECTION[direction])
      : false

    if (neighbour && hasPort !== neighbourHasPort) {
      fail(`${road.id} ${direction} port disagrees with ${neighbour.id}`)
    }
    // Adjacent modules that both present closed curbs form a visual seam and
    // are almost always an accidental overlap in this grid-authored city.
    if (neighbour && !hasPort && !neighbourHasPort) {
      fail(`${road.id} touches ${neighbour.id} without a connecting road port`)
    }
    if (neighbour && hasPort) graph.get(road.id).add(neighbour.id)
    if (!neighbour && hasPort) {
      const key = portKey(cell, direction)
      if (!outboundPorts.has(key)) fail(`${road.id} has an unregistered open ${direction} edge`)
      seenOutbound.add(key)
    }
  }
}

for (const key of outboundPorts.keys()) {
  if (!seenOutbound.has(key)) fail(`sky-road port ${key} is not open in the rendered network`)
}

const first = ROAD_TILES[0]
if (!first) fail('road network is empty')
const visited = new Set([first.id])
const queue = [first.id]
while (queue.length) {
  const id = queue.shift()
  for (const neighbour of graph.get(id) ?? []) {
    if (visited.has(neighbour)) continue
    visited.add(neighbour)
    queue.push(neighbour)
  }
}
if (visited.size !== ROAD_TILES.length) {
  const missing = ROAD_TILES.filter(road => !visited.has(road.id)).map(road => road.id)
  fail(`road network is disconnected at ${missing.slice(0, 8).join(', ')}`)
}

console.log(`World road guard passed (${ROAD_TILES.length} reciprocal tiles, ${seenOutbound.size} sky-road exits).`)
