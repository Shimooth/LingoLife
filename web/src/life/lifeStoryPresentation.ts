import type {LifeStory} from '../types'

/**
 * City snapshots are already the server's observable surface. Newer servers
 * add an explicit presentation flag/expiry; older mixed-version snapshots do
 * not, so absence must remain presentable instead of hiding settled moments.
 */
export function lifeStoryIsPresentable(story:Pick<LifeStory,'presentable'|'presentation_expires_at'|'observed_at'>,serverNow=Date.now()):boolean{
 if(typeof story.presentable==='boolean')return story.presentable
 // The server deliberately retains an unwitnessed moment past its minimum TTL.
 if(!story.observed_at)return true
 const expiresAt=Date.parse(story.presentation_expires_at??'')
 return !Number.isFinite(expiresAt)||serverNow<expiresAt
}

const TERMINAL_STORY_STATUS=new Set<LifeStory['status']>(['resolved_autonomously','resolved_with_management','closed'])
const epoch=(value?:string|null)=>{
 const parsed=Date.parse(value??'')
 return Number.isFinite(parsed)?parsed:undefined
}

/**
 * Prevent a stale city request from replacing the direct response of a story
 * mutation. Once a candidate contains the same observation/terminal progress
 * and is not older, normal snapshot reconciliation may resume.
 */
export function lifeStoryViewIncludesBaseline(candidate:LifeStory,baseline:LifeStory):boolean{
 if(candidate.id!==baseline.id)return false
 const candidateTerminal=TERMINAL_STORY_STATUS.has(candidate.status)
 const baselineTerminal=TERMINAL_STORY_STATUS.has(baseline.status)
 if(baselineTerminal&&!candidateTerminal)return false
 if(candidateTerminal&&!baselineTerminal)return true
 if(baseline.observed_at&&!candidate.observed_at)return false
 const candidateUpdated=epoch(candidate.updated_at),baselineUpdated=epoch(baseline.updated_at)
 if(candidateUpdated!==undefined&&baselineUpdated!==undefined&&candidateUpdated<baselineUpdated)return false
 return true
}
