const express=require('express');
const cors=require('cors');
const app=express();
const PORT=process.env.PORT||10000;
const API='https://api.im4car.by';
const IMG='https://img.im4car.com';
const SITE='https://red-dragon.by';
const SOURCE='https://im4car.by';
const H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36','Accept':'application/json,text/plain,*/*','Accept-Language':'ru-RU,ru;q=0.9,en;q=0.8','Referer':SOURCE+'/','china-car-market-by-Client-Type':'WEB'};
app.use(cors());

const cars=[
['019fce28-a9e3-7d91-ba69-118272f30f05','Audi Q4 e-tron 2023 Model 40 e-tron Trailblazer',24060,2023,33000,'ELECTRIC',14],
['019d7c15-5418-756a-b441-8c70cdabe347','Volkswagen Santana 2019 1.5L Manual Fashion Edition China VI Standard',10290,2020,53300,'GASOLINE',27],
['019fd96a-20f2-74bf-b10e-5dacb92d65fc','Escape 2020 EcoBoost 245 2WD Smart Enjoyment Edition',15270,2020,39800,'GASOLINE',10],
['019d0f76-2c61-71f5-8ad9-557664532c0c','2021 Mercedes-Benz S-Class S 450 L 4MATIC',105520,2021,24000,'HYBRID_HEV',32],
['019f8a00-d2f0-7b64-875f-c76ae79dc57e','Li Auto L9 2025 Ultra Smart Refreshed Edition',54270,2025,41000,'HYBRID_PHEV',19],
['019f35bc-ffe8-7394-8389-4fbeeb58066d','BMW X1 2022 sDrive25Li Leading Edition',21170,2022,48000,'GASOLINE',9],
['019f0401-bd14-7bc6-a21f-df21d2c33949','Mercedes-Benz GLC 2021 GLC 260 L 4MATIC Luxury Model',33000,2020,94900,'GASOLINE',19],
['019fba5d-6c63-7699-bf7e-35d3af2c732c','Geely Galaxy A7 2025 Model EM-i 150km Starship Edition',21020,2025,15000,'HYBRID_PHEV',28],
['019fae57-4023-71c3-89d3-990f83e39021','Mercedes-Benz C-Class 2021 C 200 L Fashion Edition Sport Version',22670,2020,81700,'GASOLINE',19],
['019d9eaa-611a-7451-8003-321a3b6ab462','Wuling Hongguang 2014 1.5L S Standard Edition',7440,2016,118000,'GASOLINE',9],
['019f5485-fe75-7d42-ab20-af72005a144f','2020 Audi A5 Cabriolet 40 TFSI Fashion Edition',31090,2020,27700,'GASOLINE',30],
['019f35e9-f434-7295-a359-8870d0b8b282','Mercedes-Benz C-Class 2021 C 260 L Sport Star Edition',25230,2021,70000,'HYBRID_HEV',9]
].map(([id,title,price,year,mileage,fuel,photos])=>({id,title,name:title,price,priceUsd:price,year,mileage,fuel,fuelType:fuel,photos,image:`${IMG}/640/cars/${id}/preview.webp`,preview:`${IMG}/640/cars/${id}/preview.webp`,photoCount:photos,url:`${SITE}/catalog#ccm=${encodeURIComponent('/cars/'+id)}`,href:`${SITE}/catalog#ccm=${encodeURIComponent('/cars/'+id)}`,status:'ACTIVE'}));

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)),t=a[i];a[i]=a[j];a[j]=t;}return a;};
const clean=v=>v==null?'':String(v).replace(/\s+/g,' ').trim();
const first=(...v)=>v.find(x=>x!==undefined&&x!==null&&x!=='');
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
function extract(data){
  if(Array.isArray(data))return{items:data,total:data.length};
  if(!data||typeof data!=='object')return{items:[],total:0};
  for(const k of ['listings','data','items','results','list','cars'])if(Array.isArray(data[k]))return{items:data[k],total:Number(first(data.pagination?.total,data.meta?.totalCount,data.total,data.count,data[k].length))||data[k].length};
  return{items:[],total:0};
}
function normalize(a){
  const p=a?.priceToSvh||{},id=clean(a?.id),title=clean(first(a?.title,a?.name,a?.modelName))||'Автомобиль',images=Array.isArray(a?.photos)?a.photos:[],image=clean(first(a?.imageExtUrl,a?.imageUrl,a?.image,`${IMG}/640/cars/${id}/preview.webp`));
  return {id,title,name:title,brand:clean(first(a?.brand,a?.brandName,a?.make)),model:clean(first(a?.model,a?.modelName)),year:num(first(a?.year,a?.productionYear)),mileage:num(first(a?.mileage,a?.mileageKm,a?.odometer))||0,fuel:clean(first(a?.fuelType,a?.fuel,a?.fuelTypeName)),fuelType:clean(first(a?.fuelType,a?.fuel,a?.fuelTypeName)),gearbox:clean(first(a?.gearbox,a?.transmission,a?.transmissionType)),transmission:clean(first(a?.gearbox,a?.transmission,a?.transmissionType)),drive:clean(first(a?.driveType,a?.drive,a?.driveTypeName)),driveType:clean(first(a?.driveType,a?.drive,a?.driveTypeName)),bodyType:clean(first(a?.bodyType,a?.body,a?.bodyTypeName)),color:clean(a?.color),price:num(first(p?.usd,a?.priceUsd,a?.price,a?.cost))||0,priceUsd:num(first(p?.usd,a?.priceUsd,a?.price,a?.cost))||0,priceByn:num(first(p?.byn,a?.priceByn)),image,preview:image,images,photos,photoCount:num(first(a?.photoCount,images.length))||0,url:id?`${SITE}/catalog#ccm=${encodeURIComponent('/cars/'+id)}`:'',href:id?`${SITE}/catalog#ccm=${encodeURIComponent('/cars/'+id)}`:'',condition:clean(first(a?.conditionLabel,a?.condition)),status:clean(a?.status)||'ACTIVE'};
}
async function liveCars(limit=12){
  const u=new URL(API+'/v1/cars/listings/');u.searchParams.set('limit',String(limit));u.searchParams.set('page','1');
  const r=await fetch(u,{headers:H,redirect:'follow',cache:'no-store'}),text=await r.text();let data;
  try{data=JSON.parse(text)}catch{throw new Error(`IM4CAR_INVALID_JSON_${r.status}`)}
  if(!r.ok)throw new Error(`IM4CAR_HTTP_${r.status}`);
  const e=extract(data),items=e.items.map(normalize).filter(c=>c.id&&c.title);if(!items.length)throw new Error('IM4CAR_EMPTY');return {cars:shuffle(items).slice(0,limit),total:e.total};
}
function bundledCars(limit=12){return shuffle(cars.slice()).slice(0,Math.min(limit,cars.length));}
async function loadCars(limit=12){try{const live=await liveCars(limit);return{ok:true,method:'im4car-api',source:API+'/v1/cars/listings/',total:live.total,foundUrls:live.cars.length,cars:live.cars,live:true};}catch(e){const fallback=bundledCars(limit);return{ok:true,method:'bundled-fallback',source:'bundled-data',total:568020,foundUrls:fallback.length,cars:fallback,live:false,fallbackError:e.message};}}
app.get('/',async(q,r)=>{const x=await loadCars(12);r.json({ok:true,service:'red-dragon-car-api',endpoint:'/api/home-cars?limit=12',method:x.method,live:x.live});});
app.get('/health',async(q,r)=>{const x=await loadCars(1);r.json({ok:true,method:x.method,count:x.foundUrls,live:x.live,source:x.source});});
app.get('/api/home-cars',async(q,r)=>{const n=Math.min(12,Math.max(1,Number(q.query.limit)||12)),x=await loadCars(n);r.json({ok:true,count:x.cars.length,foundUrls:x.foundUrls,total:x.total,method:x.method,live:x.live,source:x.source,cars:x.cars});});
app.get('/api/cars',async(q,r)=>{const x=await loadCars(12);r.json(x.cars);});
app.get('/api/debug-source',async(q,r)=>{const x=await loadCars(12);r.json({ok:true,status:200,source:x.source,method:x.method,live:x.live,total:x.total,foundUrls:x.foundUrls,fallbackError:x.fallbackError||null,sample:x.cars});});
app.listen(PORT,'0.0.0.0',()=>console.log(`red-dragon-car-api listening on ${PORT}`));
