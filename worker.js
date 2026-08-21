const ORIGIN='https://red-dragon-car-api.onrender.com';
const HOME_KEY='home:active';
const IMAGE_PREFIX='image:';
const jsonHeaders={'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','cache-control':'public,max-age=60'};
const imageHeaders={'content-type':'image/webp','access-control-allow-origin':'*','cache-control':'public,max-age=86400,immutable'};

async function loadHome(env){const raw=await env.CACHE.get(HOME_KEY);return raw?JSON.parse(raw):null}
async function fetchOrigin(){const r=await fetch(`${ORIGIN}/api/home-cars?limit=12`,{cache:'no-store'});if(!r.ok)throw Error(`ORIGIN_${r.status}`);const d=await r.json();if(!Array.isArray(d.cars)||d.cars.length!==12)throw Error(`CAR_COUNT_${d.cars?.length||0}`);return d}
async function refresh(env){
  const d=await fetchOrigin(),version=new Date().toISOString().replace(/[-:.TZ]/g,'');
  const cars=d.cars.map(c=>({...c,image:`/images/${version}/${encodeURIComponent(c.id)}.webp`,preview:`/images/${version}/${encodeURIComponent(c.id)}.webp`}));
  const imageResults=await Promise.all(cars.map(async c=>{const r=await fetch(`${ORIGIN}/cached-images/${encodeURIComponent(c.id)}.webp`,{cache:'no-store'});if(!r.ok)throw Error(`IMAGE_${c.id}_${r.status}`);const b=await r.arrayBuffer();if(!b.byteLength)throw Error(`IMAGE_EMPTY_${c.id}`);return [c,b]}));
  await Promise.all(imageResults.map(([c,b])=>env.CACHE.put(`${IMAGE_PREFIX}${version}:${c.id}`,b)));
  await env.CACHE.put(`home:${version}`,JSON.stringify({...d,cars,publishedAt:new Date().toISOString(),cacheVersion:version,source:'cloudflare-kv'}));
  await env.CACHE.put(HOME_KEY,JSON.stringify({version}));
  return {...d,cars,publishedAt:new Date().toISOString(),cacheVersion:version,source:'cloudflare-kv'};
}
async function getHome(req,env,ctx){
  const pointer=await env.CACHE.get(HOME_KEY);
  if(!pointer){const d=await refresh(env);return new Response(JSON.stringify(d),{headers:jsonHeaders})}
  const d=await env.CACHE.get(`home:${JSON.parse(pointer).version}`);if(!d)throw Error('HOME_VERSION_MISSING');return new Response(d,{headers:jsonHeaders})
}
async function getImage(req,env,parts){const [,version,id]=parts;if(!version||!id)return new Response('Not found',{status:404});const b=await env.CACHE.get(`${IMAGE_PREFIX}${version}:${decodeURIComponent(id)}`,{type:'arrayBuffer'});if(!b)return new Response('Not found',{status:404});return new Response(b,{headers:imageHeaders})}
export default{async fetch(req,env,ctx){const u=new URL(req.url);try{if(u.pathname==='/home.json'||u.pathname==='/api/home-cars')return getHome(req,env,ctx);if(u.pathname.startsWith('/images/'))return getImage(req,env,u.pathname.split('/').slice(1));return env.ASSETS.fetch(req)}catch(e){return new Response(JSON.stringify({ok:false,error:e.message}),{status:503,headers:jsonHeaders})}},async scheduled(controller,env,ctx){ctx.waitUntil((async()=>{try{const d=await refresh(env);console.log(`[cron] published ${d.cars.length} cars version=${d.cacheVersion}`)}catch(e){console.error('[cron]',e.message)}})())}};
