import { DataTexture, LinearFilter, RGBAFormat } from 'three'

/** Tiny shared analytical contact mask. It follows authored furniture transforms;
 * unlike a whole-room bake it cannot leave a shadow behind after a map edit. */
let contactTexture: DataTexture | undefined
export function furnitureContactTexture(): DataTexture {
  if (contactTexture) return contactTexture
  const size = 64, pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1
    const distance = Math.pow(Math.pow(Math.abs(u), 4) + Math.pow(Math.abs(v), 4), .25)
    const edge = Math.max(0, Math.min(1, (1 - distance) / .48))
    const offset = (y * size + x) * 4
    pixels[offset] = 48; pixels[offset + 1] = 40; pixels[offset + 2] = 33
    pixels[offset + 3] = Math.round(edge * edge * (3 - 2 * edge) * 255)
  }
  contactTexture = new DataTexture(pixels, size, size, RGBAFormat)
  contactTexture.magFilter = LinearFilter; contactTexture.minFilter = LinearFilter
  contactTexture.needsUpdate = true
  return contactTexture
}
