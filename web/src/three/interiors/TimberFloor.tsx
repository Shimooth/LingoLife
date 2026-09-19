import { useEffect, useMemo } from 'react'
import { BufferGeometry, Color, Float32BufferAttribute } from 'three'

/** Staggered boards, one draw call, no texture download or per-board React meshes. */
export function TimberFloor({ color }: { color: string }) {
  const geometry = useMemo(() => {
    const positions: number[] = [], colors: number[] = [], normals: number[] = []
    const base = new Color(color), tint = new Color()
    const left = -5.275, right = 5.275, back = -3.925, front = 3.225
    for (let row = 0; row < 11; row++) {
      const z0 = back + row * .65, z1 = Math.min(front, z0 + .65) - .008
      for (let column = -1; column < 7; column++) {
        const start = left + column * 1.9 + (row % 3) * .63
        const x0 = Math.max(left, start) + .008, x1 = Math.min(right, start + 1.9) - .008
        if (x1 <= x0 || z1 <= z0) continue
        tint.copy(base).multiplyScalar(.91 + ((row * 7 + column * 11 + 77) % 9) * .022)
        for (const [x, z] of [[x0,z0],[x0,z1],[x1,z1],[x0,z0],[x1,z1],[x1,z0]]) {
          positions.push(x, -.031, z); normals.push(0,1,0); colors.push(tint.r,tint.g,tint.b)
        }
      }
    }
    const result = new BufferGeometry()
    result.setAttribute('position', new Float32BufferAttribute(positions, 3))
    result.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    result.setAttribute('color', new Float32BufferAttribute(colors, 3))
    result.computeBoundingSphere()
    return result
  }, [color])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} receiveShadow name="staggered-timber-floor"><meshStandardMaterial vertexColors roughness={.84}/></mesh>
}
