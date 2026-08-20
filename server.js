const express=require('express'),cors=require('cors'),fs=require('fs'),path=require('path');
const app=express(),PORT=process.env.PORT||10000,IMG='https://img.im4car.com',SITE='https://red-dragon.by',API='https://red-dragon-car-api.onrender.com',SOURCE='https://im4car.by',JINA='https://r.jina.ai/',AO='https://api.allorigins.win/raw?url=',CACHE=path.join(__dirname,'runtime-home.json'),IMAGE_CACHE=path.join(__dirname,process.env.IMAGE_CACHE_DIR||'runtime-images'),REFRESH_MS=Number(process.env.PARSER_REFRESH_MS||3600000);
const H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36','Accept':'text/html,application/xhtml+xml,application/json,text/plain,*/*','Accept-Language':'ru-RU,ru;q=0.9,en;q=0.8','Referer':SOURCE+'/'};
const clean=v=>String(v??'').replace(/\\"/g,'"').replace(/\\n/g,' ').replace(/\\u0026/g,'&').replace(/\s+/g,' ').trim().replace(/^#{1,6}\s*/,''),dec=s=>clean(String(s??'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&#x27;/gi,"'").replace(/&#(\d+);/g,(m,n)=>String.fromCharCode(+n)).replace(/\\\//g,'/').replace(/\\u002F/gi,'/')),strip=s=>dec(String(s??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<svg[\s\S]*?<\/svg>/gi,' ').replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ')),shuffle=a=>{for(let i=a.length-1;i;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}return a};
app.use(cors());
function imageSource(id){return `${IMG}/original/cars/${id}/photos/0.webp`}
function imageCachePath(id){return path.join(IMAGE_CACHE,`${id}.webp`)}
function imageCacheUrl(id){return `${API}/cached-images/${encodeURIComponent(id)}.webp`}
function imageFrom(s,id){return imageCacheUrl(id)}
async function cacheImage(id){
  const sourceUrl=imageSource(id),target=imageCachePath(id),tmp=`${target}.tmp`;
  try{
    const r=await fetch(sourceUrl,{headers:H,redirect:'follow',cache:'no-store'});
    if(!r.ok)throw Error(`IMAGE_HTTP_${r.status}_${id}`);
    const contentType=(r.headers.get('content-type')||'').toLowerCase();
    if(!contentType.startsWith('image/'))throw Error(`IMAGE_INVALID_CONTENT_${id}`);
    const buffer=Buffer.from(await r.arrayBuffer());
    if(!buffer.length)throw Error(`IMAGE_EMPTY_${id}`);
    await fs.promises.writeFile(tmp,buffer);
    await fs.promises.rename(tmp,target);
    return{cached:true,reused:false,id,url:imageCacheUrl(id),sourceUrl,size:buffer.length};
  }catch(e){
    try{await fs.promises.unlink(tmp)}catch{}
    if(fs.existsSync(target))return{cached:true,reused:true,id,url:imageCacheUrl(id),sourceUrl,error:e.message};
    return{cached:false,reused:false,id,url:null,sourceUrl,error:e.message};
  }
}
async function cacheImages(cars){
  await fs.promises.mkdir(IMAGE_CACHE,{recursive:true});
  const results=[];
  for(const car of cars){
    const result=await cacheImage(car.id);
    results.push(result);
    if(result.cached){car.image=result.url;car.preview=result.url}
    else{car.image=null;car.preview=null}
  }
  return results;
}
async function cleanupStaleImages(cars){
  const keep=new Set(cars.map(car=>`${car.id}.webp`));
  let deleted=0;
  let failed=0;
  await fs.promises.mkdir(IMAGE_CACHE,{recursive:true});
  const entries=await fs.promises.readdir(IMAGE_CACHE,{withFileTypes:true});
  for(const entry of entries){
    if(!entry.isFile()||entry.name.endsWith('.tmp')||keep.has(entry.name))continue;
    try{await fs.promises.unlink(path.join(IMAGE_CACHE,entry.name));deleted++}catch{failed++}
  }
  return{kept:keep.size,deleted,failed};
}
function parseChunk(id,s){const raw=String(s||'').replace(/\\\//g,'/').replace(/\\u002F/gi,'/'),text=strip(raw);if(!text||/Проверка безопасности/i.test(text))return null;let title=(text.match(/(?:\d{1,3}\s*фото\s+)(.*?)(?=Примерно,\s*с доставкой)/i)||[])[1];if(!title)title=(raw.match(/(?:title|name)\s*[:=]\s*["']([^"']{3,180})["']/i)||[])[1];title=clean(title||'');const p=(text.match(/\$\s*([\d\s,]{3,})/)||[])[1],price=p?+p.replace(/[\s,]/g,''):0;if(!title||!price)return null;const conditionMatch=text.match(/Состояние\s*·\s*(Без\s+оценки|Отличное|Хорошее|Среднее|Ниже\s+среднего)/i),condition=conditionMatch?conditionMatch[1].replace(/\s+/g,' ').trim():null,metaText=conditionMatch?text.slice(conditionMatch.index+conditionMatch[0].length):text,meta=metaText.match(/(?:\s|^)(20\d{2})·(?:(Новый)|([\d\s]+)\s*км)(?:·(Бензин|Дизель|Электро|Гибрид\s*\((?:PHEV|HEV)\)))?(?:·(\d+)\s+владель(?:ец|ца|цев))?/i)||[],y=meta[1]||(text.match(/(?:^|\s)(20\d{2})(?=\s|·|$)/)||[])[1],m=meta[3]||((text.match(/([\d\s]+)\s*км/i)||[])[1]||'').trim(),fuel=(meta[4]||(text.match(/(Бензин|Дизель|Электро|Гибрид\s*\(PHEV\)|Гибрид\s*\(HEV\))/i)||[])[1]||'').trim(),owners=meta[5]?+meta[5]:null,photos=(text.match(/(\d+)\s*фото/i)||[])[1]||0,url=SITE+'/catalog#ccm='+encodeURIComponent('/cars/'+id),image=imageFrom(raw,id);return{id,title,name:title,year:y?+y:null,mileage:m?+String(m).replace(/\s/g,''):0,fuel,fuelType:fuel,owners,transferCount:owners,condition,conditionLabel:condition,price,priceUsd:price,image,preview:image,photoCount:+photos,url,href:url,status:'ACTIVE',live:true}}
function parseHtml(html){const src=String(html||'').replace(/\\\//g,'/').replace(/\\u002F/gi,'/'),hits=[],r=/\/cars\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;let m;while((m=r.exec(src)))hits.push({id:m[1],pos:m.index});const seen=new Set(),cars=[];for(let i=0;i<hits.length;i++){const h=hits[i];if(seen.has(h.id))continue;seen.add(h.id);const next=hits.slice(i+1).find(x=>x.pos>h.pos),end=Math.min(next?next.pos:src.length,h.pos+14000),c=parseChunk(h.id,src.slice(h.pos,end));if(c)cars.push(c)}if(cars.length<12)for(const h of hits){if(cars.some(c=>c.id===h.id))continue;const c=parseChunk(h.id,src.slice(h.pos,Math.min(src.length,h.pos+12000)));if(c)cars.push(c);if(cars.length>=24)break}const out=[...new Map(cars.map(c=>[c.id,c])).values()];if(out.length<12)throw Error('IM4CAR_HOME_CARDS_'+out.length);return shuffle(out).slice(0,12)}
async function get(url,headers=H){const r=await fetch(url,{headers,redirect:'follow',cache:'no-store'}),text=await r.text();if(!r.ok)throw Error('HTTP_'+r.status);return{text,url:r.url,status:r.status}}
async function direct(){const x=await get(SOURCE+'/');if(!x.text||x.text.length<5000||/Проверка безопасности/i.test(x.text))throw Error('IM4CAR_HOME_BLOCKED_'+x.status);return{...x,via:'direct'}}
async function allorigins(){const x=await get(AO+encodeURIComponent(SOURCE+'/'));if(!x.text||x.text.length<5000||/Проверка безопасности/i.test(x.text))throw Error('ALLORIGINS_HOME_BLOCKED_'+x.status);return{...x,via:'allorigins'}}
async function jina(){const x=await get(JINA+SOURCE+'/');if(!x.text||x.text.length<5000)throw Error('JINA_HOME_SHORT_'+x.text.length);return{...x,via:'jina'}}
async function load(){let last='';for(const fn of [direct,allorigins,jina])try{const x=await fn(),cars=parseHtml(x.text);return{cars,source:SOURCE+'/',via:x.via,live:true,htmlLength:x.text.length,updatedAt:new Date().toISOString()}}catch(e){last=e.message}throw Error(last||'LIVE_HOME_FAILED')}
let cache=null,refreshing=false,lastError=null;
function readCache(){try{if(fs.existsSync(CACHE)){const x=JSON.parse(fs.readFileSync(CACHE,'utf8'));if(x&&x.live===true&&Array.isArray(x.cars)&&x.cars.length===12&&x.cars.every(c=>typeof c.image==='string'&&c.image.includes('/cached-images/'))){cache=x;return true}}}catch(e){lastError=e.message}return false}
function writeCache(x){const tmp=CACHE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(x));fs.renameSync(tmp,CACHE)}
async function refresh(){if(refreshing)return cache;refreshing=true;try{const x=await load();const imageResults=await cacheImages(x.cars),cachedCount=imageResults.filter(i=>i.cached).length,failed=imageResults.filter(i=>!i.cached);if(!cachedCount)throw Error('ALL_HOME_IMAGES_CACHE_FAILED');const cleanup=await cleanupStaleImages(x.cars);cache={...x,imageCache:{total:imageResults.length,cached:cachedCount,failed:failed.length,cleanup,updatedAt:new Date().toISOString()}};writeCache(cache);lastError=failed.length?`IMAGE_CACHE_FAILED_${failed.length}`:null;return cache}catch(e){lastError=e.message;throw e}finally{refreshing=false}}
async function route(r,fn){try{r.json(await fn())}catch(e){r.status(502).json({ok:false,live:false,error:e.message})}}
app.use('/cached-images',express.static(IMAGE_CACHE,{fallthrough:false,maxAge:'7d',immutable:true}));
app.get('/api/debug-source',(q,r)=>route(r,async()=>{if(!cache)await refresh();return{ok:true,status:200,source:cache.source,method:'home-cache',live:true,cached:true,updatedAt:cache.updatedAt,refreshing,foundUrls:cache.cars.length,imageCache:cache.imageCache||null,lastError}}));
app.get('/api/home-cars',(q,r)=>route(r,async()=>{if(!cache)await refresh();const n=Math.min(12,Math.max(1,+q.query.limit||12));r.set('Cache-Control','public,max-age=300,stale-while-revalidate=3600');return{ok:true,count:n,foundUrls:cache.cars.length,method:'home-cache',live:true,cached:true,updatedAt:cache.updatedAt,source:cache.source,imageCache:cache.imageCache||null,cars:cache.cars.slice(0,n)}}));
app.get('/api/cars',(q,r)=>route(r,async()=>{if(!cache)await refresh();return cache.cars}));
app.get('/api/refresh',(q,r)=>route(r,async()=>{const x=await refresh();return{ok:true,live:true,cached:true,updatedAt:x.updatedAt,count:x.cars.length,imageCache:x.imageCache,cars:x.cars}}));
app.get('/health',(q,r)=>r.json({ok:true,live:!!cache,cached:!!cache,count:cache?.cars?.length||0,updatedAt:cache?.updatedAt||null,imageCache:cache?.imageCache||null,refreshing,lastError}));
app.get('/',(q,r)=>r.json({ok:true,service:'red-dragon-car-api',live:!!cache,cached:!!cache,count:cache?.cars?.length||0,updatedAt:cache?.updatedAt||null,imageCache:cache?.imageCache||null}));
app.listen(PORT,'0.0.0.0',async()=>{console.log('red-dragon-car-api listening on '+PORT);readCache();if(!cache)try{await refresh()}catch(e){console.error('initial refresh failed:',e.message)}setInterval(()=>{refresh().catch(e=>console.error('scheduled refresh:',e.message))},REFRESH_MS)});