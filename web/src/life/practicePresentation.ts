import type {CityPractice} from '../types'
import {storyHasOutcome} from './storyOutcome.ts'

export function practicePresentation(data:CityPractice|null,language:'zh'|'en'){
 const zh=language==='zh',progress=data?.progress,story=data?.story??data?.candidate
 if(progress?.step==='result')return {kind:'result',title:zh?'结果已保存，最后确认一下':'The outcome is saved',button:zh?'查看结果并完成引导':'Review and finish',detail:zh?'进入结果页，点击固定在底部的「我看到了后果」。':'Open the outcome, then use “I see the consequences” at the bottom.'}
 if(progress?.step==='discover')return {kind:'discover',title:zh?'先认识一位居民':'Meet a resident',button:zh?'看看这位居民':'Meet this resident',detail:zh?'选择居民，看看他在哪里、正在做什么。在家的居民会打开住宅。':'Choose a resident to see where they are and what they are doing. Indoor residents open their home.'}
 if(!story)return {kind:'waiting_story',title:zh?'还没有双人故事，先去家里看看':'No shared story yet',button:zh?'去共享住宅':'Visit the shared home',detail:zh?'不必停在这里等。可以去住宅提议一起吃饭，或继续逛城市；有真实故事时这里会更新。':'Explore or suggest a shared meal at home. This guide updates when a real story is available.'}
 if(storyHasOutcome(story))return {kind:'recap',title:zh?'这是一段已发生的故事':'This is a past moment',button:zh?'回顾这件事 · 确认见证':'Review · Mark as witnessed',detail:zh?'不是等它再次发生。打开回顾，点击底部「记下这一刻 · 查看后果」，就能继续第三步。':'Do not wait for a replay. Open the recap and choose “Remember this moment · See consequences” at the bottom.'}
 if(progress?.participation)return {kind:'waiting_result',title:zh?'已参与，等待居民作出后续选择':'Participation recorded · Outcome pending',button:zh?'返回现场':'Return to the scene',detail:zh?'你已经完成观察，不需要反复点击。居民还在处理这件事；可以先逛城市，结果产生后会提醒。':'Your observation is recorded. No repeated clicks are needed. Explore while residents decide what happens next.'}
 return {kind:'live',title:zh?'正在发生 · 进入现场':'Happening now · Join the scene',button:zh?'进入现场 · 观察或帮忙':'Join · Observe or help',detail:zh?'看完交流后，底部按钮可以记录观察，也可以跳到可用的帮助选项。只打开窗口还不算见证。':'After the exchange, use the bottom action to witness or view available help. Opening the window alone does not record participation.'}
}
