import {useEffect} from 'react'
import type {BufferGeometry} from 'three'
/** Parametric geometry gets replaced while sculpting. Three's dispose releases
 * GPU buffers but retains source attributes, so StrictMode replay can reupload. */
export function useOwnedGeometry(geometry:BufferGeometry){useEffect(()=>()=>geometry.dispose(),[geometry]);return geometry}
