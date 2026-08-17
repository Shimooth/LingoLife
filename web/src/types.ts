export type Mood='sad'|'idle'|'happy'
export type Stats={relationship:number;mood:number;english_xp:number}
export type Message={speaker:'player'|'npc';text:string}
export type Feedback={is_understandable:boolean;corrected_text:string;tip:string;tags:string[]}
export type Room={npc:{name:string;animation:Mood};stats:Stats;messages:Message[]}
export type ChatResponse={npc_reply:string;stats:Stats;animation:Mood;english_feedback:Feedback;relationship_change:number;mood_change:number;english_xp_change:number}
