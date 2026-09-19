import {createContext} from 'react'
import type {QualityMode} from './visualQuality'
export const VisualQualityContext=createContext<QualityMode>('auto')
