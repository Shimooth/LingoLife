/** Metres in the shared LingoLife source-asset coordinate system. Characters
 * stand 2.7 units tall. These anchors are data, not browser-only scene objects. */
export const ORIGINAL_NEIGHBORHOOD_LAYOUT = {
  version: 1,
  groundY: 0,
  characterHeight: 2.7,
  bounds: {width: 28, depth: 23},
  anchors: {
    introduction: [-1.6, 0, 3.25],
    companion: [1.7, 0, 3.05],
    fountain: [0, 0, -3.25],
    homeDoor: [-7.38, 0, -.42],
    cafeDoor: [7.08, 0, -.45],
    wardrobeDoor: [-.35, 0, -6.7],
    leftBench: [-4.4, .8875, 1.16],
    rightBench: [4.7, .8875, -.05],
  },
  buildings: [
    {id: 'home', position: [-7.6, 0, -3.2], rotation: .08, width: 5.5, depth: 5.4, doorHeight: 3.5},
    {id: 'cafe', position: [7.35, 0, -3.2], rotation: -.10, width: 5.8, depth: 5.3, doorHeight: 3.5},
    {id: 'wardrobe', position: [-.35, 0, -8.3], rotation: 0, width: 5.3, depth: 3.3, doorHeight: 3.5},
  ],
  walkable: {minX: -5, maxX: 5, minZ: -.4, maxZ: 7},
} as const

export type OriginalTimeOfDay = 'day' | 'sunset' | 'night'
export type OriginalQuality = 'high' | 'low'
export type OriginalTheme = {wall: string; roof: string; accent: string}
export const ORIGINAL_THEME: OriginalTheme = {wall: '#f1dfc3', roof: '#bb6956', accent: '#627c6b'}

export const ORIGINAL_LIGHTING_RECIPES = {
  day: {background: '#d6e5df', ambient: .75, key: 3.2, keyColor: '#fff3df', keyPosition: [-10, 16, 12]},
  sunset: {background: '#efd8ca', ambient: .55, key: 3.5, keyColor: '#ffc28b', keyPosition: [-13, 9, 7]},
  night: {background: '#263d50', ambient: .8, key: 1.5, keyColor: '#b0d4ec', keyPosition: [-9, 15, 5]},
} as const
