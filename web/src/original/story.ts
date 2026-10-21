import type {OriginalEmotion,OriginalMotion} from './spec'
export const ORIGINAL_STORY_DURATION=36
export const ORIGINAL_STORY_BEATS=[
 {start:0,end:5,title:'初次见面',speaker:'you',text:'你好呀，我刚搬来。这里比想象中还温暖。',motion:'wave',friend:'idle',emotion:'happy'},
 {start:5,end:10,title:'一个小小的邀请',speaker:'friend',text:'欢迎！我正想去喷泉边坐坐，要一起吗？',motion:'idle',friend:'talk',emotion:'curious'},
 {start:10,end:15,title:'慢一点，走在一起',speaker:'narrator',text:'两个人放慢脚步，聊起今天喜欢的天气。',motion:'walk',friend:'walk',emotion:'neutral'},
 {start:15,end:21,title:'送给新邻居',speaker:'friend',text:'这个小礼物送给你。希望你在这里住得开心。',motion:'receive',friend:'talk',emotion:'happy'},
 {start:21,end:27,title:'分享一口好心情',speaker:'you',text:'谢谢你！我带了小点心，我们一起尝尝吧。',motion:'eat',friend:'eat',emotion:'happy'},
 {start:27,end:32,title:'原来我们都喜欢',speaker:'friend',text:'下次还在这里见面吧。我们一定有很多话可以聊。',motion:'idle',friend:'talk',emotion:'happy'},
 {start:32,end:36,title:'小城，多了一份熟悉',speaker:'narrator',text:'一次见面，让陌生的地方开始像家。',motion:'happy',friend:'wave',emotion:'happy'},
] as const satisfies readonly {start:number;end:number;title:string;speaker:'you'|'friend'|'narrator';text:string;motion:OriginalMotion;friend:OriginalMotion;emotion:OriginalEmotion}[]
export function originalStoryBeat(time:number){return ORIGINAL_STORY_BEATS.find(beat=>time>=beat.start&&time<beat.end)??ORIGINAL_STORY_BEATS[time<0?0:ORIGINAL_STORY_BEATS.length-1]}
