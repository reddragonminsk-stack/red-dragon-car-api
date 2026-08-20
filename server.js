const express=require('express');
const cors=require('cors');

const app=express();
const PORT=process.env.PORT||10000;
const SOURCE='https://im4car.by';
const CATALOG=SOURCE+'/catalog';

const HEADERS={
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer':SOURCE+'/'
};

app.use(cors());

function clean(v){
  if(v==null)return null;
  return String(v)
    .replace(/\\u002F/g,'/')
    .replace(/\\\//g,'/')
    .replace(/\\u003c/gi,'<')
    .replace(/\\u003e/gi,'>')
    .replace(/\\u0026/gi,'&')
    .replace(/\\"/g,'"')
    .replace(/\\n/g,' ')
    .replace(/\s+/g,' ')
    .trim()||null;
}

function abs(v){
  if(!v)return null;
  try{return new URL(String(v),SOURCE).href}catch{return null}
}

async function fetchPage(url,timeout=20000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{headers:HEADERS,redirect:'follow',signal:controller.signal});
    return{ok:r.ok,status:r.status,url:r.url,text:await r.text()};
  }finally{
    clearTimeout(timer);
  }
}

function extractUrls(html){
  const out=[];
  const seen=new Set();

  for(const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)){
    const u=abs(m[1]);
    if(!u||seen.has(u)||!/im4car\.by/i.test(u))continue;
    if(!/(\/cars?\/|\/catalog\/)/i.test(u))continue;
    if(/\/catalog\/?$/i.test(u))continue;
    if(/\/login|\/search|\/brand|\/news|\/about|\/contact|\/catalog\/(?:brand|news)/i.test(u))continue;
    seen.add(u);
    out.push(u);
  }

  return out;
}

function extractImages(html){
  const out=[];
  const seen=new Set();

  const add=v=>{
    const u=abs(clean(v));
    if(!u||seen.has(u))return;
    if(!/^https?:\/\//i.test(u))return;
    if(!/\.(?:webp|jpg|jpeg|png)(?:[?#].*)?$/i.test(u))return;
    seen.add(u);
    out.push(u);
  };

  for(const m of html.matchAll(/(?:src|data-src|data-original|data-lazy-src|content)\s*=\s*["']([^"']+)["']/gi)){
    add(m[1]);
  }

  for(const m of html.matchAll(/https?:[^"'<>\s]+\.(?:webp|jpg|jpeg|png)(?:\?[^"'<>\s]*)?/gi)){
    add(m[0]);
  }

  return out;
}

function getMeta(html,name){
  const e=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const r1=new RegExp(`<meta[^>]+(?:name|property)=["']${e}["'][^>]+content=["']([^"']+)["']`,'i');
  const r2=new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${e}["']`,'i');
  return clean((html.match(r1)||[])[1]||(html.match(r2)||[])[1]);
}

function parsePage(html,url,fallbackImage){
  const text=textFromHtml(html);
  const title=getMeta(html,'og:title')||clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1])||'Автомобиль';
  const image=getMeta(html,'og:image')||fallbackImage||extractImages(html)[0]||null;
  const price=clean(
    (text.match(/(?:\$|USD)\s*([\d\s,.]+)/i)||[])[1]||
    (text.match(/([\d\s,.]+)\s*(?:\$|USD)/i)||[])[1]
  );
  const year=(text.match(/\b20\d{2}\b/)||[])[0]||null;
  const mileage=clean((text.match(/([\d\s,.]+)\s*(?:км|km)\b/i)||[])[1]);

  return{
    title,
    price:price?price.replace(/\s/g,'').replace(/,/g,''):null,
    image:image?abs(image):null,
    url,
    year,
    mileage:mileage?mileage.replace(/\s/g,''):null,
    fuel:null,
    drive:null,
    brand:null,
    model:null,
    photos:null
  };
}

function textFromHtml(html){
  return clean(
    html
      .replace(/<script[\s\S]*?<\/script>/gi,' ')
      .replace(/<style[\s\S]*?<\/style>/gi,' ')
      .replace(/<[^>]+>/g,' ')
  )||'';
}

async function getCars(limit=12){
  const catalog=await fetchPage(CATALOG);
  if(!catalog.ok)throw new Error('SOURCE_HTTP_'+catalog.status);

  const urls=extractUrls(catalog.text).slice(0,24);
  const catalogImages=extractImages(catalog.text);
  const cars=[];

  for(let i=0;i<urls.length&&cars.length<limit;i++){
    const url=urls[i];
    try{
      const page=await fetchPage(url);
      if(!page.ok)continue;
      cars.push(parsePage(page.text,url,catalogImages[cars.length]||null));
    }catch{}
  }

  if(cars.length<limit){
    for(let i=0;i<catalogImages.length&&cars.length<limit;i++){
      const image=catalogImages[i];
      if(cars.some(c=>c.image===image))continue;
      cars.push(parsePage(catalog.text,urls[cars.length]||CATALOG,image));
    }
  }

  return{source:catalog.url,foundUrls:urls.length,cars:cars.slice(0,limit)};
}

app.get('/',(req,res)=>res.json({ok:true,service:'red-dragon-car-api',endpoint:'/api/home-cars?limit=12'}));
app.get('/health',(req,res)=>res.json({ok:true,service:'red-dragon-car-api'}));

app.get('/api/home-cars',async(req,res)=>{
  try{
    const limit=Math.max(1,Math.min(12,Number(req.query.limit)||12));
    const data=await getCars(limit);
    res.json({ok:true,count:data.cars.length,foundUrls:data.foundUrls,cars:data.cars});
  }catch(e){
    console.error(e);
    res.status(502).json({ok:false,error:e.message});
  }
});

app.get('/api/cars',async(req,res)=>{
  try{
    const data=await getCars(12);
    res.json(data.cars);
  }catch(e){
    res.status(502).json({ok:false,error:e.message});
  }
});

app.get('/api/debug-source',async(req,res)=>{
  try{
    const catalog=await fetchPage(CATALOG);
    const urls=extractUrls(catalog.text);
    const images=extractImages(catalog.text);
    res.json({ok:catalog.ok,status:catalog.status,source:catalog.url,htmlLength:catalog.text.length,foundUrls:urls.length,images:images.length,sampleUrls:urls.slice(0,12),sampleImages:images.slice(0,12)});
  }catch(e){
    res.status(502).json({ok:false,error:e.message});
  }
});

app.listen(PORT,'0.0.0.0',()=>console.log('red-dragon-car-api listening on '+PORT));
