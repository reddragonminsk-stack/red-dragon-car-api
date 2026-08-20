const express=require('express');
const cors=require('cors');

const app=express();
const PORT=process.env.PORT||10000;

const ALLOWED_ORIGINS=[
  'https://red-dragon.by',
  'https://www.red-dragon.by'
];

app.use(cors({
  origin:(origin,callback)=>{
    if(!origin||ALLOWED_ORIGINS.includes(origin))return callback(null,true);
    callback(new Error('CORS blocked'));
  },
  methods:['GET','OPTIONS'],
  allowedHeaders:['Content-Type']
}));

const SOURCE='https://im4car.by';

async function fetchSource(path='/catalog'){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);

  try{
    const r=await fetch(SOURCE+path,{
      signal:controller.signal,
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
        'Accept':'text/html,application/xhtml+xml',
        'Accept-Language':'ru-RU,ru;q=0.9,en;q=0.8',
        'Cache-Control':'no-cache'
      }
    });

    if(!r.ok)throw new Error(`Source HTTP ${r.status}`);
    return await r.text();
  }finally{
    clearTimeout(timer);
  }
}

function clean(s){
  return String(s||'')
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#x27;/g,"'")
    .replace(/&#39;/g,"'")
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/\s+/g,' ')
    .trim();
}

function decodeHtml(s){
  for(let i=0;i<2;i++){
    const x=clean(s);
    if(x===s)return x;
    s=x;
  }
  return clean(s);
}

function extractCars(html){
  const cars=[];
  const seen=new Set();

  /*
   * IM4CAR отдаёт ссылки на изображения автомобилей
   * непосредственно в HTML/RSC-разметке.
   *
   * Берём preview.webp и ищем ближайшие данные вокруг него.
   */
  const imgRe=/https:\/\/img\.im4car\.com\/(?:400|640|750|828|1080|1200|1920)\/cars\/[a-z0-9-]+\/preview\.webp/gi;

  let match;

  while((match=imgRe.exec(html))!==null){
    const image=match[0];

    if(seen.has(image))continue;
    seen.add(image);

    const start=Math.max(0,match.index-5000);
    const end=Math.min(html.length,match.index+8000);
    const chunk=html.slice(start,end);

    let title='';
    let url='';
    let price='';
    let year='';
    let mileage='';
    let fuel='';
    let gearbox='';
    let drive='';
    let photos='';

    const titlePatterns=[
      /(?:title|name|modelName|carName)["=:]+["']([^"']{3,180})["']/i,
      /alt=["']([^"']{3,180})["']/i
    ];

    for(const re of titlePatterns){
      const m=chunk.match(re);
      if(m){
        title=decodeHtml(m[1]);
        if(title&&!/IM4CAR/i.test(title))break;
      }
    }

    const hrefPatterns=[
      /href=["'](\/(?:car|cars|catalog)\/[^"']+)["']/i,
      /href=["'](https:\/\/im4car\.by\/(?:car|cars|catalog)\/[^"']+)["']/i
    ];

    for(const re of hrefPatterns){
      const m=chunk.match(re);
      if(m){
        url=m[1].startsWith('http')?m[1]:SOURCE+m[1];
        break;
      }
    }

    const pricePatterns=[
      /(?:price|priceUsd|price_usd|priceUSD)["=:]+["']?([\d\s,.]+)\s*(?:\$|USD)?/i,
      /([\d\s,.]+)\s*\$/i
    ];

    for(const re of pricePatterns){
      const m=chunk.match(re);
      if(m){
        price=clean(m[1]).replace(/\s/g,'');
        break;
      }
    }

    const yearMatch=chunk.match(/(?:year|releaseYear|productionYear)["=:]+["']?(20\d{2})/i);
    if(yearMatch)year=yearMatch[1];

    const mileageMatch=chunk.match(/(?:mileage|mileageKm|mileage_km)["=:]+["']?([\d\s,.]+)/i);
    if(mileageMatch)mileage=clean(mileageMatch[1]);

    const fuelMatch=chunk.match(/(?:fuel|fuelType|fuel_type)["=:]+["']([^"']{2,40})["']/i);
    if(fuelMatch)fuel=decodeHtml(fuelMatch[1]);

    const gearboxMatch=chunk.match(/(?:gearbox|transmission)["=:]+["']([^"']{2,40})["']/i);
    if(gearboxMatch)gearbox=decodeHtml(gearboxMatch[1]);

    const driveMatch=chunk.match(/(?:drive|driveType|drivetrain)["=:]+["']([^"']{2,40})["']/i);
    if(driveMatch)drive=decodeHtml(driveMatch[1]);

    const photoMatch=chunk.match(/(?:imageCount|photosCount|photoCount)["=:]+["']?(\d+)/i);
    if(photoMatch)photos=photoMatch[1];

    /*
     * Даже если часть полей не удалось найти,
     * карточку всё равно сохраняем — изображение уже
     * является надёжным признаком карточки автомобиля.
     */
    cars.push({
      title:title||'Автомобиль из каталога',
      price:price||null,
      year:year||null,
      mileage:mileage||null,
      fuel:fuel||null,
      gearbox:gearbox||null,
      drive:drive||null,
      photos:photos||null,
      image,
      url:url||SOURCE+'/catalog'
    });

    if(cars.length>=30)break;
  }

  /*
   * Убираем дубликаты по изображениям.
   */
  return cars.filter((car,i,a)=>a.findIndex(x=>x.image===car.image)===i);
}

app.get('/health',(req,res)=>{
  res.json({
    ok:true,
    service:'red-dragon-car-api',
    time:new Date().toISOString()
  });
});

app.get('/api/cars',async(req,res)=>{
  try{
    const html=await fetchSource('/catalog');
    const cars=extractCars(html);

    res.set({
      'Cache-Control':'public,max-age=120',
      'Content-Type':'application/json; charset=utf-8'
    });

    res.json({
      ok:true,
      source:'im4car.by',
      count:cars.length,
      updatedAt:new Date().toISOString(),
      cars
    });
  }catch(error){
    console.error('[api/cars]',error);

    res.status(502).json({
      ok:false,
      source:'im4car.by',
      error:'Не удалось получить автомобили',
      message:error.message
    });
  }
});

app.get('/api/catalog',async(req,res)=>{
  try{
    const html=await fetchSource('/catalog');

    res.set({
      'Cache-Control':'public,max-age=60',
      'Content-Type':'application/json; charset=utf-8'
    });

    res.json({
      ok:true,
      source:'im4car.by',
      url:SOURCE+'/catalog',
      html
    });
  }catch(error){
    console.error('[api/catalog]',error);

    res.status(502).json({
      ok:false,
      error:'Не удалось получить каталог источника',
      message:error.message
    });
  }
});

app.get('/api/catalog-html',async(req,res)=>{
  try{
    const html=await fetchSource('/catalog');

    res.set({
      'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'public,max-age=60'
    });

    res.send(html);
  }catch(error){
    console.error('[api/catalog-html]',error);

    res.status(502).send(
      '<!doctype html><html lang="ru"><body>Источник временно недоступен</body></html>'
    );
  }
});

app.get('/',(req,res)=>{
  res.json({
    ok:true,
    service:'red-dragon-car-api',
    endpoints:[
      '/health',
      '/api/cars',
      '/api/catalog',
      '/api/catalog-html'
    ]
  });
});

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`Red Dragon API listening on ${PORT}`);
});
