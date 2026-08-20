const express=require('express');
const cors=require('cors');
const app=express();
const PORT=process.env.PORT||10000;
const API='https://api.im4car.by';
const IMG='https://img.im4car.com';
const SITE='https://im4car.by';
const H={
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
  'Accept':'application/json,text/plain,*/*',
  'Accept-Language':'ru-RU,ru;q=0.9,en;q=0.8',
  'Referer':SITE+'/',
  'china-car-market-by-Client-Type':'WEB'
};
app.use(cors());

const clean=v=>v==null?'':String(v).replace(/\s+/g,' ').trim();
const first=(...v)=>v.find(x=>x!==undefined&&x!==null&&x!=='');
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};

function extract(data){
  if(Array.isArray(data))return{items:data,total:data.length};
  if(!data||typeof data!=='object')return{items:[],total:0};
  for(const k of ['listings','data','items','results','list','cars']){
    if(Array.isArray(data[k])){
      const total=first(data.pagination?.total,data.meta?.totalCount,data.total,data.count,data[k].length);
      return{items:data[k],total:Number(total)||data[k].length,rootKeys:Object.keys(data)};
    }
  }
  return{items:[],total:0,rootKeys:Object.keys(data)};
}

function imageFor(id,size=640){return id?`${IMG}/${size}/cars/${encodeURIComponent(id)}/preview.webp`:'';}
function normalize(a){
  const p=a?.priceToSvh||{};
  const id=clean(a?.id);
  const title=clean(first(a?.title,a?.name,a?.modelName))||'Автомобиль';
  const images=Array.isArray(a?.photos)?a.photos:[];
  const image=clean(first(a?.imageExtUrl,a?.imageUrl,a?.image,imageFor(id)));
  return{
    id,
    title,
    name:title,
    brand:clean(first(a?.brand,a?.brandName,a?.make)),
    model:clean(first(a?.model,a?.modelName)),
    year:num(first(a?.year,a?.productionYear)),
    mileage:num(first(a?.mileage,a?.mileageKm,a?.odometer))||0,
    fuel:clean(first(a?.fuelType,a?.fuel,a?.fuelTypeName)),
    fuelType:clean(first(a?.fuelType,a?.fuel,a?.fuelTypeName)),
    gearbox:clean(first(a?.gearbox,a?.transmission,a?.transmissionType)),
    transmission:clean(first(a?.gearbox,a?.transmission,a?.transmissionType)),
    drive:clean(first(a?.driveType,a?.drive,a?.driveTypeName)),
    driveType:clean(first(a?.driveType,a?.drive,a?.driveTypeName)),
    bodyType:clean(first(a?.bodyType,a?.body,a?.bodyTypeName)),
    color:clean(a?.color),
    price:num(first(p?.usd,a?.priceUsd,a?.price,a?.cost))||0,
    priceUsd:num(first(p?.usd,a?.priceUsd,a?.price,a?.cost))||0,
    priceByn:num(first(p?.byn,a?.priceByn)),
    image,
    preview:image,
    images,
    photos:images,
    photoCount:num(first(a?.photoCount,images.length))||0,
    url:id?`${SITE}/cars/${encodeURIComponent(id)}`:'',
    href:id?`${SITE}/cars/${encodeURIComponent(id)}`:'',
    condition:clean(first(a?.conditionLabel,a?.condition)),
    status:clean(a?.status)||'ACTIVE'
  };
}

async function apiPage(page=1,limit=12){
  const url=new URL(API+'/v1/cars/listings/');
  url.searchParams.set('limit',String(limit));
  url.searchParams.set('page',String(page));
  const r=await fetch(url,{headers:H,redirect:'follow',cache:'no-store'});
  const text=await r.text();
  let data;
  try{data=JSON.parse(text);}catch{throw new Error(`IM4CAR_INVALID_JSON_${r.status}:${text.slice(0,300)}`)}
  if(!r.ok)throw new Error(`IM4CAR_HTTP_${r.status}`);
  const e=extract(data);
  return{status:r.status,url:r.url,items:e.items.map(normalize),total:e.total,rootKeys:e.rootKeys||Object.keys(data||{}),raw:data};
}

async function loadCars(limit=12){
  const e=await apiPage(1,Math.min(12,Math.max(1,Number(limit)||12)));
  const cars=e.items.filter(c=>c.id&&c.title).slice(0,limit);
  return{ok:true,status:e.status,source:e.url,total:e.total,foundUrls:cars.length,method:'im4car-api',cars,rootKeys:e.rootKeys};
}

app.get('/',(q,r)=>r.json({ok:true,service:'red-dragon-car-api',endpoint:'/api/home-cars?limit=12',source:API+'/v1/cars/listings/'}));

app.get('/health',async(q,r)=>{
  try{
    const x=await loadCars(1);
    r.json({ok:true,method:x.method,count:x.foundUrls,source:x.source});
  }catch(e){r.status(503).json({ok:false,error:e.message});}
});

app.get('/api/home-cars',async(q,r)=>{
  try{
    const limit=Math.min(12,Math.max(1,Number(q.query.limit)||12));
    const x=await loadCars(limit);
    r.json({ok:true,count:x.cars.length,foundUrls:x.foundUrls,total:x.total,method:x.method,source:x.source,cars:x.cars});
  }catch(e){console.error('[home-cars]',e);r.status(502).json({ok:false,error:e.message});}
});

app.get('/api/cars',async(q,r)=>{
  try{const x=await loadCars(12);r.json(x.cars);}catch(e){r.status(502).json({ok:false,error:e.message});}
});

app.get('/api/debug-source',async(q,r)=>{
  try{
    const x=await loadCars(12);
    r.json({ok:true,status:x.status,source:x.source,method:x.method,total:x.total,foundUrls:x.foundUrls,rootKeys:x.rootKeys,sample:x.cars});
  }catch(e){r.status(502).json({ok:false,error:e.message});}
});

app.listen(PORT,'0.0.0.0',()=>console.log(`red-dragon-car-api listening on ${PORT}`));
