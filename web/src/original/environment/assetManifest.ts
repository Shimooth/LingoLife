/** Renderer-independent authoring metadata; exported alongside the baked GLB.
 * Width, depth, height, and anchors use the same metre-based toy-world scale. */
export const ORIGINAL_ENVIRONMENT_ASSETS = [
  {id:'home',family:'architecture',source:'OriginalBuildings.tsx',size:[5.5,8.7,5.4],doorClearance:3.5,variants:['wall','roof','accent']},
  {id:'cafe',family:'architecture',source:'OriginalBuildings.tsx',size:[5.8,6.8,5.3],doorClearance:3.5,variants:['wall','roof','accent']},
  {id:'wardrobe',family:'architecture',source:'OriginalBuildings.tsx',size:[5.3,6.9,3.3],doorClearance:3.5,variants:['wall','roof']},
  {id:'wish-fountain',family:'landmark',source:'OriginalFountain.tsx',size:[3.68,2.2,3.68],dynamic:['water arcs','droplets','ripples']},
  {id:'sculpted-tree',family:'vegetation',source:'OriginalProps.tsx',variants:['short','tall']},
  {id:'flower-pot',family:'vegetation',source:'OriginalProps.tsx',variants:['ceramic','terracotta','flower colour','size']},
  {id:'bench',family:'furniture',source:'OriginalProps.tsx',size:[2.82,1.70,.95],seatHeight:.8875,seatWidth:2.82},
  {id:'cafe-table',family:'furniture',source:'OriginalProps.tsx',tableHeight:1.28,seatHeight:.91},
  {id:'street-lamp',family:'furniture',source:'OriginalProps.tsx',height:4.295,dynamic:['warm globe','night point light']},
  {id:'introduction-room',family:'interior',source:'OriginalRoom.tsx',size:[10.8,5.9,9],dynamic:['window glow','night floor light']},
] as const

export const ORIGINAL_ENVIRONMENT_MATERIALS = {
  plaster:{roughness:.87,metalness:0},
  terracotta:{roughness:.82,metalness:0},
  paintedWood:{roughness:.74,metalness:0},
  stone:{roughness:.88,metalness:0},
  glazedCeramic:{roughness:.25,clearcoat:.6,clearcoatRoughness:.2},
  water:{roughness:.17,clearcoat:1,clearcoatRoughness:.08},
  brass:{roughness:.25,metalness:.7},
} as const
