const express=require('express');
const cors=require('cors');
const app=express();
const PORT=process.env.PORT||10000;
const IMG='https://img.im4car.com';
const SITE='https://red-dragon.by';
const SOURCE='https://im4car.by';
const H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36','Accept':'text/html,application/xhtml+xml,application/json,text/plain,*/*','Accept-Language':'ru-RU,ru;q=0.9,en;q=0.8','Referer':SOURCE+'/'};
app.use(cors());
const clean=v=>v==null?'':String(v).replace(/\s+/g,' ').trim();
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)),t=a[i];a[i]=a[j];a[j]=t}return a};
const escRe=s=>String(s||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const decode=s=>String(s||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&#x27;/gi,"'").replace(/&#(\d+);/g,(m,n)=>String.fromCharCode(+n));
const strip=s=>decode(String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function imageFrom(html,id){
  const m=html.match(/(?:src|data-src|srcset)=\"([^\"]*img\.im4car\.com[^\"]+)\"/i)||html.match(/(?:src|data-src|srcset)='([^']*img\.im4car\.com[^']+)'/i);
  if(m){let u=m[1].split(',')[0].trim().split(/\s+/)[0];if(u.startsWith('//'))u='https:'+u;if(/^https?:\/\//i.test(u))return u}
  return id?`${IMG}/640/cars/${id}/preview.webp`:'';
}
function parseCard(a){
  const hm=a.match(/href=["']\/cars\/([0-9a-f-]{36})["'][^>]*>[\s\S]*?<\/a>/i);if(!hm)return null;
  const id=hm[1],html=hm[0],text=strip(html);
  if(!text||/проверка безопасности/i.test(text))return null;
  const pm=text.match(/\$\s*([\d\s,]+)/),price=pm?Number(pm[1].replace(/\s/g,'').replace(/,/g,'')):0;
  const km=text.match(/([\d\s]+)\s*км/i),year=text.match(/(?:^|\s)(20\d{2})(?:\s|·|$)/),fuel=(text.match(/(Бензин|Дизель|Электро|Гибрид\s*\(PHEV\)|Гибрид\s*\(HEV\))/i)||[])[1]||'';
  const photos=(text.match(/(\d+)\s*фото/i)||[])[1];
  const cleaned=text.replace(/(?:Первая линия\s*)?\d+\s*фото\s*/i,'').replace(/Примерно,\s*с доставкой.*?(?=Состояние)/i,'').replace(/Состояние\s*·\s*(?:Без оценки|Отличное|Хорошее|Ниже среднего)/i,'').replace(/\$\s*[\d\s,]+/,'').replace(/[\d\s]+(?:белорусских рублей|BYN)/i,'').replace(/20\d{2}·?[\d\s]*км?/i,'').replace(/·\s*(?:Бензин|Дизель|Электро|Гибрид\s*\([^)]*\))/i,'').trim();
  const title=cleaned.replace(/\s+/g,' ').trim();
  if(!title||title.length<3||!price)return null;
  const url=`${SITE}/catalog#ccm=${encodeURIComponent('/cars/'+id)}`;
  return{id,title,name:title,year:year?+year[1]:null,mileage:km?+km[1].replace(/\s/g,''):0,fuel,fuelType:fuel,price,priceUsd:price,image:imageFrom(html,id),preview:imageFrom(html,id),photoCount:photos?+photos:0,url,href:url,status:'ACTIVE',live:true};
}
async function fetchHome(){
  const r=await fetch(SOURCE+'/',{headers:H,redirect:'follow',cache:'no-store'}),html=await r.text();
  if(!r.ok)throw Error(`IM4CAR_HOME_HTTP_${r.status}`);
  if(/Проверка безопасности/i.test(html)||html.length<5000)throw Error(`IM4CAR_HOME_BLOCKED_${r.status}`);
  return{html,status:r.status,url:r.url};
}
function parseHome(html){
  const section=html.match(/(?:Авто из каталога|Случайная подборка из общей выдачи)[\s\S]*?(?=<h[1-3][^>]*>|Популярные марки|$)/i)?.[0]||html;
  const anchors=[];const re=/<a\b[^>]*href=["']\/cars\/[0-9a-f-]{36}["'][^>]*>[\s\S]*?<\/a>/gi;let m;while((m=re.exec(section)))anchors.push(m[0]);
  const map=new Map();for(const a of anchors){const c=parseCard(a);if(c&&c.id&&!map.has(c.id))map.set(c.id,c)}
  const cars=[...map.values()];if(cars.length<12)throw Error(`IM4CAR_HOME_CARDS_${cars.length}`);return shuffle(cars).slice(0,12);
}
async function loadCars(){const x=await fetchHome(),cars=parseHome(x.html);return{ok:true,method:'im4car-home-html',source:x.url,total:cars.length,foundUrls:cars.length,cars,live:true,htmlLength:x.html.length};}
app.get('/',async(q,r)=>{try{const x=await loadCars();r.json({ok:true,service:'red-dragon-car-api',endpoint:'/api/home-cars?limit=12',method:x.method,live:true,count:x.cars.length})}catch(e){r.status(502).json({ok:false,live:false,error:e.message})}});
app.get('/health',async(q,r)=>{try{const x=await loadCars();r.json({ok:true,method:x.method,count:x.cars.length,live:true,source:x.source,htmlLength:x.htmlLength})}catch(e){r.status(503).json({ok:false,live:false,error:e.message})}});
app.get('/api/home-cars',async(q,r)=>{try{const n=Math.min(12,Math.max(1,Number(q.query.limit)||12)),x=await loadCars();r.json({ok:true,count:Math.min(n,x.cars.length),foundUrls:x.cars.length,total:x.cars.length,method:x.method,live:true,source:x.source,htmlLength:x.htmlLength,cars:x.cars.slice(0,n)})}catch(e){console.error('[home-cars]',e);r.status(502).json({ok:false,live:false,error:e.message})}});
app.get('/api/cars',async(q,r)=>{try{const x=await loadCars();r.json(x.cars)}catch(e){r.status(502).json({ok:false,live:false,error:e.message})}});
app.get('/api/debug-source',async(q,r)=>{try{const x=await loadCars();r.json({ok:true,status:200,source:x.source,method:x.method,live:true,htmlLength:x.htmlLength,foundUrls:x.cars.length,sample:x.cars})}catch(e){r.status(502).json({ok:false,live:false,error:e.message})}});
app.listen(PORT,'0.0.0.0',()=>console.log(`red-dragon-car-api listening on ${PORT}`));