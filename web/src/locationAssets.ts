export type LocationIconName=
 'train'|'bus'|'plane'|'office'|'idea'|'design'|'hospital'|'clinic'|'paw'|'tree'|'garden'|'hill'|'shield'|'hall'|'fire'|'community'|'market'|'mall'|'book'|'coffee'|'flower'|'restaurant'|'gallery'|'museum'|'theater'|'music'|'library'|'school'|'university'|'sun'|'fountain'|'gym'|'stadium'|'walk'|'harbor'|'cowork'

export type LocationLanguageCopy={
 name:string
 category:string
 description:string
 hours:string
 highlights:[string,string,string]
}

export type LocationAsset={
 id:string
 icon:LocationIconName
 image:string
 imagePosition?:string
 accent:string
 zh:LocationLanguageCopy
 en:LocationLanguageCopy
}

type LocationSeed={
 icon:LocationIconName
 scene:'transit'|'work'|'civic-health'|'nature'|'commerce'|'culture'|'recreation'
 accent:string
 position?:string
 zh:[string,string,string,string,[string,string,string]]
 en:[string,string,string,string,[string,string,string]]
}

const asset=(id:string,seed:LocationSeed):LocationAsset=>({
 id,icon:seed.icon,image:`/assets/locations/v2/${id}.jpg`,imagePosition:seed.position,accent:seed.accent,
 zh:{name:seed.zh[0],category:seed.zh[1],description:seed.zh[2],hours:seed.zh[3],highlights:seed.zh[4]},
 en:{name:seed.en[0],category:seed.en[1],description:seed.en[2],hours:seed.en[3],highlights:seed.en[4]},
})

export const KNOWN_LOCATION_IDS=[
 'central_station','north_bus_terminal','airport_express','business_center','innovation_hub','design_studio','city_hospital','neighborhood_clinic','animal_shelter','riverside_park','botanical_garden','hilltop_park','police_station','city_hall','fire_station','community_center','old_town_market','harbor_mall','maple_bookshop','moonlight_cafe','garden_cafe','harbor_restaurant','community_gallery','city_museum','aurora_theater','music_hall','city_library','community_school','city_university','sunny_plaza','canal_square','greenway_gym','city_stadium','canal_walk','south_harbor','co_working_loft',
] as const
export type KnownLocationId=typeof KNOWN_LOCATION_IDS[number]

const seeds:Record<KnownLocationId,LocationSeed>={
 central_station:{icon:'train',scene:'transit',accent:'#496583',zh:['中央车站','交通枢纽','城市最大的铁路枢纽。玻璃穹顶下总有人出发，也总有人带着故事回来。','05:30–00:30',['城际站台','中央大厅','旅行商店']],en:['Central Station','Transit hub','The city’s grand rail gateway, where departures and homecomings constantly cross beneath the glass roof.','05:30–00:30',['Intercity platforms','Grand concourse','Travel kiosks']]},
 north_bus_terminal:{icon:'bus',scene:'transit',accent:'#547486',position:'42% center',zh:['北门客运站','交通枢纽','连接郊区与北部小镇的长途客运站，清晨常能遇见赶第一班车的人。','06:00–23:00',['长途线路','候车大厅','行李寄存']],en:['North Bus Terminal','Transit hub','A coach terminal linking the northern towns and suburbs, busiest around the first departures of the day.','06:00–23:00',['Regional coaches','Waiting hall','Bag storage']]},
 airport_express:{icon:'plane',scene:'transit',accent:'#607a9a',position:'70% center',zh:['机场快线站','城市交通','直达机场的快速线路，节奏匆忙，却也藏着许多告别和重逢。','05:00–01:00',['机场快线','城市换乘','自助服务']],en:['Airport Express','City transit','The fast link to the airport—a hurried place full of farewells, reunions, and last-minute decisions.','05:00–01:00',['Airport trains','City connections','Self service']]},
 business_center:{icon:'office',scene:'work',accent:'#2d7776',zh:['商务中心','办公区','城市金融与商务活动的核心，高层会议和楼下咖啡都可能改变一天的方向。','08:00–22:00',['共享会议室','屋顶花园','商务休息区']],en:['Business Center','Work district','The heart of the city’s business life, where a meeting—or a coffee downstairs—can redirect an entire day.','08:00–22:00',['Meeting suites','Roof garden','Business lounge']]},
 innovation_hub:{icon:'idea',scene:'work',accent:'#387f86',position:'65% center',zh:['创新中心','科技社区','创作者和创业团队聚集的开放空间，原型、争论与意外合作每天都在发生。','08:00–23:00',['创客工坊','演示空间','深夜自习区']],en:['Innovation Hub','Tech community','An open home for makers and small teams, filled with prototypes, debates, and unlikely collaborations.','08:00–23:00',['Maker lab','Demo space','Late study zone']]},
 design_studio:{icon:'design',scene:'work',accent:'#b05f47',position:'30% center',zh:['运河设计工作室','创意工作室','临水的独立设计工作室，墙上贴满草图，窗边总有未完成的新想法。','09:00–21:00',['临水工位','材料墙','作品评审区']],en:['Canal Design Studio','Creative studio','An independent waterside studio, its walls covered with sketches and half-finished ideas by the windows.','09:00–21:00',['Canal desks','Material wall','Critique corner']]},
 city_hospital:{icon:'hospital',scene:'civic-health',accent:'#4f8f86',zh:['市立医院','医疗机构','城市全天候综合医院。这里既有紧张的决定，也有让人安心的小小好消息。','24 小时',['急诊中心','住院部','屋顶疗愈花园']],en:['City Hospital','Healthcare','The city’s round-the-clock hospital, where difficult decisions coexist with small, reassuring pieces of good news.','Open 24 hours',['Emergency care','Patient wards','Healing roof garden']]},
 neighborhood_clinic:{icon:'clinic',scene:'civic-health',accent:'#6d9d91',position:'35% center',zh:['社区诊所','医疗机构','熟悉街坊姓名的小型诊所，忙碌但亲切，适合处理日常健康问题。','08:00–20:00',['家庭门诊','健康咨询','社区药房']],en:['Neighborhood Clinic','Healthcare','A small, friendly clinic where the staff know the neighborhood and handle everyday health concerns.','08:00–20:00',['Family practice','Health advice','Community pharmacy']]},
 animal_shelter:{icon:'paw',scene:'civic-health',accent:'#c0775e',position:'20% center',zh:['城市动物救助站','公益机构','照顾流浪动物的安静院落。志愿工作很累，但每次被信任都值得纪念。','09:00–18:00',['领养中心','志愿者站','户外活动场']],en:['City Animal Shelter','Community care','A quiet refuge for lost animals. The work is tiring, but every moment of earned trust matters.','09:00–18:00',['Adoption room','Volunteer station','Outdoor run']]},
 riverside_park:{icon:'tree',scene:'nature',accent:'#4b8b67',zh:['河畔公园','城市公园','沿河展开的长公园，适合散步、慢跑，也适合把难开口的话慢慢说出来。','05:30–22:30',['河岸步道','野餐草坪','日落平台']],en:['Riverside Park','City park','A long park beside the river—good for walks, runs, and conversations that need room to unfold.','05:30–22:30',['River path','Picnic lawn','Sunset deck']]},
 botanical_garden:{icon:'garden',scene:'nature',accent:'#5b9061',position:'25% center',zh:['植物园','自然景区','收集本地与异地植物的温柔绿洲，季节变化会让每次来访都有一点不同。','08:00–19:00',['玻璃温室','香草园','季节花径']],en:['Botanical Garden','Nature attraction','A gentle green refuge of local and visiting plants, changing enough with the seasons to reward every return.','08:00–19:00',['Glasshouse','Herb garden','Seasonal trail']]},
 hilltop_park:{icon:'hill',scene:'nature',accent:'#708b50',position:'75% center',zh:['山顶公园','城市景区','能俯瞰整座城市的高地公园。路有些陡，但到达之后总让人觉得值得。','06:00–21:00',['城市观景台','山坡步道','旧凉亭']],en:['Hilltop Park','Scenic park','A hilltop park overlooking the whole city. The climb is steep, but the view usually makes it worthwhile.','06:00–21:00',['City overlook','Hillside trail','Old pavilion']]},
 police_station:{icon:'shield',scene:'civic-health',accent:'#4d6880',zh:['警察局','公共服务','负责东区治安与失物招领的公共机构，许多意外的小事件会在这里找到结果。','全天值班',['失物招领','社区警务','值班大厅']],en:['Police Station','Public service','The Eastside public-safety office, where lost property and unexpected incidents often find an ending.','Always staffed',['Lost and found','Community desk','Duty hall']]},
 city_hall:{icon:'hall',scene:'civic-health',accent:'#5c7c70',position:'70% center',zh:['市政厅','公共机构','城市公共事务的中心，也是公告、社区提案和市民活动汇合的地方。','09:00–17:30',['市民窗口','公共议事厅','城市档案']],en:['City Hall','Civic institution','The center of public affairs, where notices, neighborhood proposals, and civic events converge.','09:00–17:30',['Citizen services','Public chamber','City archive']]},
 fire_station:{icon:'fire',scene:'civic-health',accent:'#bf604d',position:'30% center',zh:['消防站','应急服务','守护西区的消防站，车库总是整洁，值班室的灯却很少真正熄灭。','24 小时',['应急车库','安全教育','值班室']],en:['Fire Station','Emergency service','The West End fire station: the garage stays ready, and the duty-room light rarely goes completely dark.','Open 24 hours',['Response garage','Safety education','Duty room']]},
 community_center:{icon:'community',scene:'civic-health',accent:'#8c7652',position:'18% center',zh:['社区活动中心','社区空间','课程、聚会和邻里互助都在这里发生，是最容易偶遇熟人的地方之一。','08:30–21:30',['活动教室','社区厨房','多功能厅']],en:['Community Center','Community space','Home to classes, gatherings, and mutual aid—and one of the easiest places to run into someone you know.','08:30–21:30',['Activity rooms','Community kitchen','Flexible hall']]},
 old_town_market:{icon:'market',scene:'commerce',accent:'#a9563f',position:'35% center',zh:['老城市场','市集','摊位和老店挤在石板街边，消息、食物与小小的人情在这里流动。','07:00–20:00',['生鲜摊位','手作小店','街边点心']],en:['Old Town Market','Market','Stalls and old shops crowd the stone lanes, carrying food, local news, and everyday kindness.','07:00–20:00',['Fresh stalls','Craft shops','Street snacks']]},
 harbor_mall:{icon:'mall',scene:'commerce',accent:'#a66c78',position:'70% center',zh:['云际商场','购物中心','靠近云路入口的综合商场，从日用品到临时礼物都能找到，也常有快闪活动。','10:00–22:00',['生活商店','中庭活动','云景露台']],en:['Skyline Mall','Shopping center','A mall beside the cloudway entrance for daily needs, last-minute gifts, and the occasional pop-up event.','10:00–22:00',['Everyday shops','Atrium events','Cloudview terrace']]},
 maple_bookshop:{icon:'book',scene:'commerce',accent:'#785644',position:'10% center',zh:['枫叶书店','独立书店','有些拥挤却很舒服的独立书店，店员会把真正喜欢的书悄悄放到显眼处。','09:30–21:00',['英文读物','二手书架','阅读角']],en:['Maple Bookshop','Independent bookshop','A crowded but comforting bookshop whose staff quietly place their true favorites where people will notice.','09:30–21:00',['English shelf','Used books','Reading corner']]},
 moonlight_cafe:{icon:'coffee',scene:'commerce',accent:'#8f5f46',position:'78% center',zh:['月光咖啡馆','咖啡馆','许多人下班后会来的暖色咖啡馆，靠窗座位很适合把一天慢慢讲完。','07:30–23:30',['手冲咖啡','靠窗座位','夜间甜点']],en:['Moonlight Café','Café','A warm café where people unwind after work; the window seats are made for telling the whole story of a day.','07:30–23:30',['Pour-over coffee','Window seats','Late desserts']]},
 garden_cafe:{icon:'flower',scene:'commerce',accent:'#a95e69',position:'58% center',zh:['花园咖啡馆','咖啡馆','藏在花架与藤蔓之间的小店，天气好时几乎所有人都愿意坐到户外。','08:00–21:30',['庭院座位','季节饮品','植物角']],en:['Garden Café','Café','A small café tucked among flowers and vines; on good days, nearly everyone chooses the courtyard.','08:00–21:30',['Courtyard tables','Seasonal drinks','Plant corner']]},
 harbor_restaurant:{icon:'restaurant',scene:'commerce',accent:'#9e563f',position:'90% center',zh:['云际餐厅','餐厅','能看到云路灯火的家庭餐厅，晚餐时间热闹，深夜则适合安静地聊重要事情。','11:00–23:00',['云路夜景','分享菜单','安静卡座']],en:['Skyline Restaurant','Restaurant','A family restaurant overlooking the cloudway lights—lively at dinner, quiet enough for important talks later.','11:00–23:00',['Cloudway view','Sharing menu','Quiet booths']]},
 community_gallery:{icon:'gallery',scene:'culture',accent:'#76506f',position:'18% center',zh:['社区画廊','文化空间','支持新人作品的小型画廊，展览不大，却常常和创作者的生活离得很近。','10:00–19:00',['新人展览','工作坊','开放评议']],en:['Community Gallery','Arts space','A small gallery supporting emerging artists; its exhibitions are modest but closely tied to real lives.','10:00–19:00',['Emerging shows','Workshops','Open critiques']]},
 city_museum:{icon:'museum',scene:'culture',accent:'#6b566f',zh:['城市博物馆','文化场馆','保存城市记忆的综合博物馆，常设展之外也会出现出人意料的小专题。','09:00–18:00',['城市历史','专题展厅','公共中庭']],en:['City Museum','Cultural venue','The keeper of the city’s memory, with a permanent collection and unexpectedly intimate special exhibitions.','09:00–18:00',['City history','Special galleries','Public atrium']]},
 aurora_theater:{icon:'theater',scene:'culture',accent:'#7e4059',position:'82% center',zh:['极光剧院','表演场馆','有百年历史的剧院翻新后重新开放，后台总比观众席多一点秘密。','10:00–23:00',['主舞台','排练厅','旧式后台']],en:['Aurora Theater','Performance venue','A century-old theater reopened after restoration; backstage always holds more secrets than the auditorium.','10:00–23:00',['Main stage','Rehearsal room','Historic backstage']]},
 music_hall:{icon:'music',scene:'culture',accent:'#584c78',position:'75% center',zh:['南岸音乐厅','音乐场馆','以温暖木质声场闻名的音乐厅，演出结束后河岸仍会留下人群的余韵。','10:00–23:00',['音乐厅','练习室','河岸前厅']],en:['Southbank Music Hall','Music venue','A concert hall known for its warm wooden acoustics; after performances, the riverbank keeps the crowd’s afterglow.','10:00–23:00',['Concert hall','Practice rooms','River foyer']]},
 city_library:{icon:'library',scene:'culture',accent:'#77614f',position:'35% center',zh:['城市图书馆','公共图书馆','安静却不沉闷的城市图书馆，有语言学习区，也有很多适合发呆的窗边位置。','08:30–21:00',['语言学习区','城市资料室','窗边阅览位']],en:['City Library','Public library','A quiet but lively library with a language-learning floor and plenty of windows made for daydreaming.','08:30–21:00',['Language floor','Local archive','Window reading seats']]},
 community_school:{icon:'school',scene:'culture',accent:'#9a704e',position:'42% center',zh:['社区学校','教育机构','服务周边家庭的社区学校，放学后的操场和社团教室依然很热闹。','07:30–20:00',['教学楼','社团教室','社区操场']],en:['Community School','Education','A neighborhood school whose club rooms and playground stay lively long after classes end.','07:30–20:00',['Classrooms','Club rooms','Community field']]},
 city_university:{icon:'university',scene:'culture',accent:'#526b87',position:'62% center',zh:['城市大学','高等教育','开放式校园连接图书馆、研究楼和草坪，经常出现讲座与临时社团活动。','07:00–23:00',['研究楼','校园草坪','公开讲座']],en:['City University','Higher education','An open campus linking libraries, research buildings, and lawns, with frequent talks and pop-up clubs.','07:00–23:00',['Research halls','Campus lawn','Public lectures']]},
 sunny_plaza:{icon:'sun',scene:'recreation',accent:'#ce784e',zh:['阳光广场','城市广场','位于城市中央的开放广场，午休、街头活动和临时约见都喜欢选在这里。','全天开放',['中央喷泉','露天座椅','周末活动']],en:['Sunny Plaza','City square','An open square at the city’s center, popular for lunch breaks, street events, and spontaneous meetups.','Always open',['Central fountain','Outdoor seating','Weekend events']]},
 canal_square:{icon:'fountain',scene:'recreation',accent:'#39859b',position:'68% center',zh:['运河广场','滨水广场','紧邻运河的现代广场，喷泉与步道让这里从清晨到夜晚都有不同气氛。','全天开放',['景观喷泉','运河台阶','夜间灯光']],en:['Canal Square','Waterfront square','A modern square beside the canal, changing character from morning calm to evening lights.','Always open',['Sculptural fountain','Canal steps','Evening lights']]},
 greenway_gym:{icon:'gym',scene:'recreation',accent:'#3e8668',position:'22% center',zh:['绿道健身房','运动场所','靠近绿道的社区健身房，既有认真训练的人，也有单纯来找回节奏的人。','06:00–23:00',['力量训练','团体课程','恢复区']],en:['Greenway Gym','Fitness','A neighborhood gym by the greenway—for serious training and for simply finding one’s rhythm again.','06:00–23:00',['Strength floor','Group classes','Recovery zone']]},
 city_stadium:{icon:'stadium',scene:'recreation',accent:'#337c91',position:'88% center',zh:['城市体育场','体育场馆','城市大型比赛与演出的举办地，没有活动时外圈跑道也向公众开放。','06:00–22:30',['主体育场','公共跑道','赛事广场']],en:['City Stadium','Sports venue','The city’s major arena for games and shows; its outer track stays open to the public between events.','06:00–22:30',['Main arena','Public track','Event plaza']]},
 canal_walk:{icon:'walk',scene:'nature',accent:'#4f8790',position:'62% center',zh:['运河步道','城市步道','贯穿多个街区的水边步道，沿途常遇见跑步者、遛狗的人和街头音乐。','全天开放',['连续步道','水边座椅','桥下空间']],en:['Canal Walk','Urban trail','A waterside path crossing several districts, shared by runners, dog walkers, and occasional street music.','Always open',['Continuous path','Waterside seats','Under-bridge spaces']]},
 south_harbor:{icon:'harbor',scene:'nature',accent:'#356f82',position:'80% center',zh:['云际车站','城市交通','连接三条外向云路的城市车站，白天务实忙碌，傍晚则被灯火和云海柔化。','05:00–23:00',['云路站台','观景连廊','城际候车厅']],en:['Cloudline Station','City transit','The city station linking three outbound cloudways—busy by day, softened by lights and cloudbanks after dusk.','05:00–23:00',['Cloudway platforms','View promenade','Intercity concourse']]},
 co_working_loft:{icon:'cowork',scene:'work',accent:'#2f706b',position:'75% center',zh:['老城共享办公阁楼','共享办公','由旧仓库改造的共享办公空间，小团队、自由职业者和临时项目在这里交汇。','07:00–00:00',['开放工位','电话间','阁楼休息区']],en:['Old Town Co-working Loft','Co-working','A converted warehouse where small teams, freelancers, and temporary projects share one airy roof.','07:00–00:00',['Open desks','Call booths','Loft lounge']]},
}

export const LOCATION_ASSETS:Record<KnownLocationId,LocationAsset>=Object.fromEntries(
 KNOWN_LOCATION_IDS.map(id=>[id,asset(id,seeds[id])]),
) as Record<KnownLocationId,LocationAsset>

export const HOME_LOCATION_ASSET:LocationAsset={
 id:'home',icon:'community',image:'/assets/homes/v3/bubble.jpg',accent:'#b66e4d',
 zh:{name:'角色的家',category:'私人住宅',description:'属于角色自己的生活空间。熟悉的物件和窗外的城市，让在这里发生的对话更私人也更放松。',hours:'私人空间',highlights:['城市窗景','生活收藏','安静客厅']},
 en:{name:'Character home',category:'Private residence',description:'A personal living space where familiar objects and the city outside make conversations quieter and more intimate.',hours:'Private',highlights:['City view','Personal collection','Quiet living room']},
}

const HOME_SCENES=['bubble','book','plant','retro','space','harbor'] as const

export function getHomeLocationAsset(npcId?:string|null,selected?:string|null):LocationAsset{
 const key=npcId||'default'
 let hash=2166136261
 for(let index=0;index<key.length;index++)hash=Math.imul(hash^key.charCodeAt(index),16777619)
 const scene=HOME_SCENES.includes(selected as typeof HOME_SCENES[number])?selected as typeof HOME_SCENES[number]:HOME_SCENES[Math.abs(hash)%HOME_SCENES.length]
 return {...HOME_LOCATION_ASSET,image:`/assets/homes/v3/${scene}.jpg`}
}

export const DISTRICT_NAMES:Record<string,{zh:string;en:string}>={
 'North Gate':{zh:'北门区',en:'North Gate'},'Canal Quarter':{zh:'运河区',en:'Canal Quarter'},Eastside:{zh:'东区',en:'Eastside'},'West End':{zh:'西区',en:'West End'},Central:{zh:'市中心',en:'Central'},'Old Town':{zh:'老城区',en:'Old Town'},Harbor:{zh:'云际区',en:'Cloudline'},Southbank:{zh:'南部城区',en:'South Quarter'},Southwest:{zh:'西南区',en:'Southwest'},'University Quarter':{zh:'大学区',en:'University Quarter'},Greenway:{zh:'绿道区',en:'Greenway'},
}

export function getLocationAsset(id?:string|null,kind?:string,npcId?:string|null,homeBackground?:string|null):LocationAsset{
 if(id?.startsWith('home-')||id==='home')return getHomeLocationAsset(npcId||id,homeBackground)
 if(id&&id in LOCATION_ASSETS)return LOCATION_ASSETS[id as KnownLocationId]
 const fallbackId=KNOWN_LOCATION_IDS.find(candidate=>{
  const scene=seeds[candidate].scene
  return scene===kind||(kind==='health'||kind==='civic')&&scene==='civic-health'||(kind==='park'||kind==='waterfront')&&scene==='nature'||(kind==='shopping'||kind==='cafe'||kind==='restaurant')&&scene==='commerce'||(kind==='education'||kind==='culture')&&scene==='culture'||(kind==='fitness'||kind==='plaza')&&scene==='recreation'
 })
 return fallbackId?LOCATION_ASSETS[fallbackId]:HOME_LOCATION_ASSET
}

export function locationCopy(asset:LocationAsset,language:'zh'|'en'){
 return asset[language]
}
