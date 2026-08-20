const express=require('express');
const cors=require('cors');

const app=express();
const PORT=process.env.PORT||10000;

const SOURCE='https://im4car.by';
const CATALOG_URL=`${SOURCE}/catalog`;

const HEADERS={
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control':'no-cache',
  'Pragma':'no-cache'
};

const ALLOWED_ORIGINS=[
  'https://red-dragon.by',
  'https://www.red-dragon.by'
];

app.use(cors({
  origin:(origin,callback)=>{
    if(!origin||ALLOWED_ORIGINS.includes(origin))return callback(null,true);
    callback(null,true);
  },
  methods:['GET','OPTIONS'],
  allowedHeaders:['Content-Type']
}));

app.use(express.json());

function unique(arr){
  return [...new Set(arr.filter(Boolean))];
}

function cleanText(value){
  if(value==null)return null;

  return String(value)
    .replace(/\\u003c/g,'<')
    .replace(/\\u003e/g,'>')
    .replace(/\\u0026/g,'&')
    .replace(/\\u0027/g,"'")
    .replace(/\\"/g,'"')
    .replace(/\\n/g,' ')
    .replace(/\s+/g,' ')
    .trim()||null;
}

function absoluteUrl(url,base=SOURCE){
  if(!url)return null;

  try{
    return new URL(url,base).href;
  }catch{
    return null;
  }
}

function normalizeCarUrl(url){
  if(!url)return null;

  const u=absoluteUrl(url);
  if(!u)return null;

  try{
    const x=new URL(u);

    x.hash='';
    x.search='';

    if(!x.pathname.includes('/cars/'))return null;

    return x.href.replace(/\/$/,'');
  }catch{
    return null;
  }
}

function findAll(html,re){
  return [...html.matchAll(re)];
}

async function fetchText(url,timeout=25000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);

  try{
    const response=await fetch(url,{
      method:'GET',
      headers:{
        ...HEADERS,
        'Referer':SOURCE+'/'
      },
      redirect:'follow',
      signal:controller.signal
    });

    const text=await response.text();

    return{
      response,
      text
    };
  }finally{
    clearTimeout(timer);
  }
}

async function getSource(){
  return fetchText(CATALOG_URL);
}

function extractCarUrls(html){
  const urls=new Set();

  const patterns=[
    /href=["']([^"'#?]*\/cars\/[^"'#?]+)["']/gi,
    /href=\\["']([^"'#?]*\/cars\/[^"'#?]+)["']/gi,
    /https?:\/\/im4car\.by\/[^"'\\\s<>]*\/cars\/[^"'\\\s<>]+/gi,
    /\/catalog\/cars\/[^"'\\\s<>]+/gi,
    /\/cars\/[^"'\\\s<>]+/gi
  ];

  for(const re of patterns){
    for(const m of html.matchAll(re)){
      const raw=m[1]||m[0];
      const url=normalizeCarUrl(raw);

      if(url)urls.add(url);
    }
  }

  return [...urls];
}

function extractImageUrls(html){
  const out=[];

  const patterns=[
    /https?:\/\/img\.im4car\.com\/[^"'\\\s<>]+/gi,
    /https:\\\/\\\/img\.im4car\.com\\\/[^"'\\\s<>]+/gi,
    /https?:\/\/[^"'\\\s<>]+\/(?:preview|large|small)\.(?:webp|jpg|jpeg|png)/gi,
    /https:\\\/\\\/[^"'\\\s<>]+\/(?:preview|large|small)\.(?:webp|jpg|jpeg|png)/gi
  ];

  for(const re of patterns){
    for(const m of html.matchAll(re)){
      let u=m[0]
        .replace(/\\\//g,'/')
        .replace(/\\u002F/gi,'/');

      u=u.replace(/[\\'"]+$/,'');

      if(u.startsWith('http'))out.push(u);
    }
  }

  return unique(out);
}

function extractMeta(html,name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

  const patterns=[
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
      'i'
    )
  ];

  for(const re of patterns){
    const m=html.match(re);
    if(m&&m[1])return cleanText(m[1]);
  }

  return null;
}

function extractTitle(html){
  const m=html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(m&&m[1]);
}

function extractJsonLd(html){
  const out=[];

  for(const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )){
    const raw=m[1].trim();

    if(!raw)continue;

    try{
      const parsed=JSON.parse(raw);

      if(Array.isArray(parsed))out.push(...parsed);
      else out.push(parsed);
    }catch{
      try{
        const cleaned=raw
          .replace(/^\s*<!--/,'')
          .replace(/-->\s*$/,'');

        const parsed=JSON.parse(cleaned);

        if(Array.isArray(parsed))out.push(...parsed);
        else out.push(parsed);
      }catch{}
    }
  }

  return out;
}

function flattenObjects(value,out=[]){
  if(value==null)return out;

  if(Array.isArray(value)){
    for(const item of value)flattenObjects(item,out);
    return out;
  }

  if(typeof value==='object'){
    out.push(value);

    for(const v of Object.values(value)){
      if(v&&typeof v==='object')flattenObjects(v,out);
    }
  }

  return out;
}

function findNestedValue(objects,keys){
  const wanted=new Set(keys.map(x=>x.toLowerCase()));

  for(const obj of objects){
    for(const [key,value] of Object.entries(obj||{})){
      if(wanted.has(String(key).toLowerCase())){
        if(value!=null&&String(value).trim()!==''){
          return value;
        }
      }
    }
  }

  return null;
}

function findValueDeep(objects,patterns){
  for(const obj of objects){
    for(const [key,value] of Object.entries(obj||{})){
      const k=String(key).toLowerCase();

      if(patterns.some(re=>re.test(k))){
        if(value!=null&&String(value).trim()!==''){
          return value;
        }
      }
    }
  }

  return null;
}

function normalizeImage(value){
  if(!value)return null;

  if(typeof value==='string'){
    return absoluteUrl(value);
  }

  if(Array.isArray(value)){
    for(const item of value){
      const result=normalizeImage(item);
      if(result)return result;
    }

    return null;
  }

  if(typeof value==='object'){
    return absoluteUrl(
      value.url||
      value.contentUrl||
      value.src||
      value.image
    );
  }

  return null;
}

function extractNumbersFromText(text){
  const result={
    year:null,
    mileage:null,
    power:null
  };

  if(!text)return result;

  const t=text.replace(/\s+/g,' ');

  const year=t.match(/\b(20\d{2}|19\d{2})\b/);
  if(year)result.year=year[1];

  const mileage=t.match(/([\d\s.,]+)\s*(?:км|km)\b/i);
  if(mileage){
    result.mileage=mileage[1]
      .replace(/\s/g,'')
      .replace(/,/g,'');
  }

  const power=t.match(/(\d+(?:[.,]\d+)?)\s*(?:л\.?\s*с\.?|лс|hp|л\/с)\b/i);
  if(power)result.power=power[1];

  return result;
}

function extractCarData(url,html){
  const jsonLd=extractJsonLd(html);
  const objects=flattenObjects(jsonLd);

  const firstProduct=
    objects.find(x=>{
      const type=x&&x['@type'];
      if(Array.isArray(type))return type.some(v=>/vehicle|product|car/i.test(String(v)));
      return /vehicle|product|car/i.test(String(type||''));
    })||{};

  const imageCandidates=[];

  const jsonImage=findNestedValue(objects,['image','photo','photos']);
  const metaImage=
    extractMeta(html,'og:image')||
    extractMeta(html,'twitter:image');

  if(jsonImage)imageCandidates.push(jsonImage);
  if(metaImage)imageCandidates.push(metaImage);

  imageCandidates.push(...extractImageUrls(html));

  const images=unique(
    imageCandidates
      .flatMap(value=>{
        if(Array.isArray(value))return value;
        return [value];
      })
      .map(normalizeImage)
  );

  const title=
    cleanText(firstProduct.name)||
    extractMeta(html,'og:title')||
    extractTitle(html);

  const brandValue=
    typeof firstProduct.brand==='object'
      ?firstProduct.brand.name
      :firstProduct.brand;

  const model=
    cleanText(
      firstProduct.model||
      findNestedValue(objects,['model','modelName'])
    );

  const brand=
    cleanText(
      brandValue||
      findNestedValue(objects,['brand','brandName'])
    );

  let price=null;

  if(firstProduct.offers){
    const offers=Array.isArray(firstProduct.offers)
      ?firstProduct.offers
      :[firstProduct.offers];

    for(const offer of offers){
      if(offer&&offer.price!=null){
        price=offer.price;
        break;
      }

      if(offer&&offer.lowPrice!=null){
        price=offer.lowPrice;
        break;
      }
    }
  }

  if(price==null){
    price=
      findNestedValue(objects,['price','priceValue','lowPrice'])||
      extractMeta(html,'product:price:amount');
  }

  const rawText=cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi,' ')
      .replace(/<style[\s\S]*?<\/style>/gi,' ')
      .replace(/<[^>]+>/g,' ')
  )||'';

  const nums=extractNumbersFromText(rawText);

  const year=
    findValueDeep(objects,[/year$/i,/modelyear/i,/productionyear/i])||
    nums.year||
    null;

  const mileage=
    findValueDeep(objects,[/mileage/i,/mileagevalue/i,/odometer/i,/kilometer/i])||
    nums.mileage||
    null;

  const engine=
    cleanText(
      findValueDeep(objects,[/engine$/i,/enginevolume/i,/displacement/i])||
      findNestedValue(objects,['fuelType'])
    );

  const power=
    cleanText(
      findValueDeep(objects,[/horsepower/i,/power/i,/enginepower/i])||
      nums.power
    );

  const transmission=
    cleanText(
      findValueDeep(objects,[/transmission/i,/gearbox/i])
    );

  const drive=
    cleanText(
      findValueDeep(objects,[/drivetype/i,/driveType/i,/traction/i,/drive/i])
    );

  const body=
    cleanText(
      findValueDeep(objects,[/bodytype/i,/bodyStyle/i])
    );

  const fuel=
    cleanText(
      findValueDeep(objects,[/fueltype/i,/fuel/i])
    );

  const currency=
    cleanText(
      findValueDeep(objects,[/pricecurrency/i,'currency'])
    );

  return{
    id:url.split('/').filter(Boolean).pop()||url,
    brand,
    model,
    title,
    price:price!=null?cleanText(price):null,
    currency,
    year:cleanText(year),
    mileage:cleanText(mileage),
    engine,
    power,
    transmission,
    drive,
    body,
    fuel,
    image:images[0]||null,
    images:images.slice(0,10),
    url
  };
}

async function parseCar(url){
  try{
    const {response,html}=await fetchText(url,25000);

    if(!response.ok){
      return{
        ok:false,
        url,
        error:`HTTP ${response.status}`
      };
    }

    const car=extractCarData(url,html);

    return{
      ok:true,
      car
    };
  }catch(error){
    return{
      ok:false,
      url,
      error:error.name==='AbortError'
        ?'Request timeout'
        :error.message
    };
  }
}

async function parseHomeCars(limit){
  const catalog=await getSource();

  if(!catalog.response.ok){
    throw new Error(`Catalog HTTP ${catalog.response.status}`);
  }

  const urls=extractCarUrls(catalog.text).slice(0,limit);

  const results=await Promise.all(
    urls.map(url=>parseCar(url))
  );

  const cars=results
    .filter(x=>x.ok&&x.car)
    .map(x=>x.car);

  return{
    catalogStatus:catalog.response.status,
    foundUrls:urls.length,
    cars
  };
}

function sourceStats(html){
  const images=extractImageUrls(html);
  const cars=extractCarUrls(html);
  const nextData=[...html.matchAll(/<script[^>]*>([\s\S]*?__next_f\.push[\s\S]*?)<\/script>/gi)];

  return{
    htmlLength:html.length,
    scripts:(html.match(/<script\b/gi)||[]).length,
    articles:(html.match(/<article\b/gi)||[]).length,
    sections:(html.match(/<section\b/gi)||[]).length,
    links:(html.match(/<a\b/gi)||[]).length,
    divs:(html.match(/<div\b/gi)||[]).length,
    previewImages:images.length,
    carLikeUrls:cars.length,
    nextDataBlocks:nextData.length,
    hasNextFlight:html.includes('__next_f.push'),
    hasNextData:html.includes('__next_data__'),
    hasImgIm4car:html.includes('img.im4car.com'),
    hasPreviewWebp:html.includes('/preview.webp'),
    hasCatalog:html.includes('/catalog'),
    hasReact:html.includes('__next'),
    title:extractTitle(html),
    description:extractMeta(html,'description'),
    images:images.slice(0,30),
    carUrls:cars.slice(0,30),
    nextSamples:nextData.slice(0,5).map(x=>x[1])
  };
}

app.get('/',(req,res)=>{
  res.json({
    ok:true,
    service:'red-dragon-car-api',
    time:new Date().toISOString(),
    endpoints:{
      debug:'/api/debug-source',
      source:'/api/source',
      homeCars:'/api/home-cars?limit=6',
      images:'/api/test-images',
      next:'/api/test-next',
      health:'/'
    }
  });
});

app.get('/api/home-cars',async(req,res)=>{
  try{
    let limit=parseInt(req.query.limit,10);

    if(!Number.isFinite(limit))limit=6;

    limit=Math.max(1,Math.min(limit,20));

    const started=Date.now();
    const result=await parseHomeCars(limit);

    res.set({
      'Cache-Control':'public,max-age=120',
      'Content-Type':'application/json; charset=utf-8'
    });

    res.json({
      ok:true,
      source:'im4car.by',
      requested:limit,
      foundUrls:result.foundUrls,
      count:result.cars.length,
      timeMs:Date.now()-started,
      cars:result.cars
    });
  }catch(error){
    console.error(error);

    res.status(502).json({
      ok:false,
      source:'im4car.by',
      error:'Не удалось получить карточки автомобилей',
      message:error.message
    });
  }
});

app.get('/api/debug-source',async(req,res)=>{
  try{
    const {response, text}=await getSource();
    const stats=sourceStats(text);

    res.json({
      ok:true,
      source:'im4car.by',
      requestedUrl:CATALOG_URL,
      finalUrl:response.url,
      status:response.status,
      contentType:response.headers.get('content-type'),
      ...stats,
      beginning:text.slice(0,5000),
      end:text.slice(-3000)
    });
  }catch(error){
    console.error(error);

    res.status(500).json({
      ok:false,
      source:'im4car.by',
      url:CATALOG_URL,
      error:error.message,
      stack:error.stack
    });
  }
});

app.get('/api/source',async(req,res)=>{
  try{
    const {response,text}=await getSource();

    res.status(response.ok?200:502);

    res.set('Content-Type','application/json; charset=utf-8');

    res.json({
      ok:response.ok,
      status:response.status,
      source:'im4car.by',
      url:CATALOG_URL,
      finalUrl:response.url,
      htmlLength:text.length,
      html:text
    });
  }catch(error){
    console.error(error);

    res.status(500).json({
      ok:false,
      error:error.message
    });
  }
});

app.get('/api/test-images',async(req,res)=>{
  try{
    const {text}=await getSource();
    const images=extractImageUrls(text);

    res.json({
      ok:true,
      count:images.length,
      images
    });
  }catch(error){
    res.status(500).json({
      ok:false,
      error:error.message
    });
  }
});

app.get('/api/test-next',async(req,res)=>{
  try{
    const {text}=await getSource();

    const blocks=[...text.matchAll(
      /<script[^>]*>([\s\S]*?__next_f\.push[\s\S]*?)<\/script>/gi
    )].map(x=>x[1]);

    res.json({
      ok:true,
      count:blocks.length,
      blocks:blocks.slice(0,10)
    });
  }catch(error){
    res.status(500).json({
      ok:false,
      error:error.message
    });
  }
});

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`red-dragon-car-api listening on port ${PORT}`);
});
