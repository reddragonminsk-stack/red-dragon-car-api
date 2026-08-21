const ORIGIN='https://red-dragon-car-api.onrender.com';
const CACHE_TTL=600;
const IMAGE_TTL=86400;
const jsonHeaders={'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','cache-control':`public,max-age=${CACHE_TTL}`};
const publicBase=req=>new URL(req.url).origin;
async function getHome(req){
  const dataUrl=`${ORIGIN}/api/home-cars?limit=12`;
  const r=await fetch(dataUrl,{cf:{cacheEverything:true,cacheTtl:CACHE_TTL}});
  if(!r.ok) return new Response(JSON.stringify({ok:false,error:`ORIGIN_${r.status}`}),{status:502,headers:jsonHeaders});
  const d=await r.json(),base=publicBase(req);
  d.cars=(d.cars||[]).map(c=>{const u=`${base}/images/${encodeURIComponent(c.id)}.webp`;return {...c,image:u,preview:u}});
  return new Response(JSON.stringify(d),{headers:jsonHeaders});
}
async function getImage(req,name){
  const r=await fetch(`${ORIGIN}/cached-images/${encodeURIComponent(name)}`,{cf:{cacheEverything:true,cacheTtl:IMAGE_TTL}});
  return new Response(r.body,{status:r.status,headers:{'content-type':r.headers.get('content-type')||'image/webp','cache-control':`public,max-age=${IMAGE_TTL},immutable`,'access-control-allow-origin':'*'}});
}
export default{
  async fetch(req,env){
    const u=new URL(req.url);
    if(u.pathname==='/home.json'||u.pathname==='/api/home-cars')return getHome(req);
    if(u.pathname.startsWith('/images/'))return getImage(req,u.pathname.slice(8));
    return env.ASSETS.fetch(req);
  },
  async scheduled(controller,env,ctx){
    try{
      const req=new Request(`https://${env?.WORKER_DOMAIN||'red-dragon-car-api.red-dragon-minsk.workers.dev'}/home.json`);
      const r=await getHome(req); if(!r.ok)return;
      const d=await r.clone().json();
      await Promise.all((d.cars||[]).map(c=>fetch(`${req.url.replace('/home.json','')}/images/${encodeURIComponent(c.id)}.webp`,{cf:{cacheEverything:true,cacheTtl:IMAGE_TTL}})));
      console.log(`[cron] warmed ${d.cars?.length||0} cars`);
    }catch(e){console.error('[cron]',e.message)}
  }
};
