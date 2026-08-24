import {
  BUILDING_LOTS,
  CITY_PLATFORM_OUTLINE,
  ROAD_TILES,
  ROAD_TILE_STEP,
} from '../src/three/world/worldData.ts'

const fail = message => {
  throw new Error(`World layout guard failed: ${message}`)
}

const cellKey = ([x, z]) => `${Math.round(x / ROAD_TILE_STEP)},${Math.round(z / ROAD_TILE_STEP)}`
const roadCells = new Set(ROAD_TILES.map(tile => cellKey(tile.position)))
const lotCells = new Set()

const pointInside = (x, z) => {
  let inside = false
  for (let index = 0, previous = CITY_PLATFORM_OUTLINE.length - 1; index < CITY_PLATFORM_OUTLINE.length; previous = index, index += 1) {
    const [xi, zi] = CITY_PLATFORM_OUTLINE[index]
    const [xj, zj] = CITY_PLATFORM_OUTLINE[previous]
    if (((zi > z) !== (zj > z)) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

if (BUILDING_LOTS.length < 54) fail(`only ${BUILDING_LOTS.length} legal parcels remain`)

for (const lot of BUILDING_LOTS) {
  const key = cellKey(lot.position)
  if (lotCells.has(key)) fail(`duplicate parcel cell ${key}`)
  if (roadCells.has(key)) fail(`parcel ${lot.id} occupies road cell ${key}`)
  lotCells.add(key)

  const [gx, gz] = key.split(',').map(Number)
  const touchesRoad = [[gx - 1, gz], [gx + 1, gz], [gx, gz - 1], [gx, gz + 1]]
    .some(([x, z]) => roadCells.has(`${x},${z}`))
  if (!touchesRoad) fail(`parcel ${lot.id} has no street frontage`)

  const half = ROAD_TILE_STEP / 2 + .01
  const corners = [[-half, -half], [half, -half], [-half, half], [half, half]]
  if (!corners.every(([dx, dz]) => pointInside(lot.position[0] + dx, lot.position[1] + dz))) {
    fail(`parcel ${lot.id} overhangs the city platform`)
  }
}

console.log(`World layout guard passed (${BUILDING_LOTS.length} legal road-safe parcels).`)
