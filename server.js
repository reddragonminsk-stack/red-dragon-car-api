const express=require('express');
const cors=require('cors');
const cheerio=require('cheerio');

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

app.use(express.json());

const SOURCE='https://im4car.by';
const SOURCE_CATALOG=SOURCE+'/catalog';

function cleanText(v){
  return String(v||'')
    .replace(/\u00a0/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function absUrl(v){
  if(!v)return '';
  try{return new URL(v,SOURCE).href}catch{return ''}
}

function numberValue(v){
  if(v==null)return null;
  const n=String(v).replace(/[^\d.,-]/g,'').replace(/\s/g,'').replace(',', '.');
  const x=Number(n);
  return Number.isFinite(x)?x:null;
}

function intValue(v){
  const n=String(v||'').replace(/[^\d]/g,'');
  return n?Number(n):null;
}

function ownersWord(n){
  if(n===1)return 'владелец';
  if(n>=2&&n<=4)return 'владельца';
  return 'владельцев';
}

async function fetchSource(path='/catalog',query=''){
  const url=SOURCE+path+(query?`?${query}`:'');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);

  try{
    const r=await fetch(url,{
      signal:controller.signal,
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

function parseMeta(text){
  const s=cleanText(text);
  const result={
    year:null,
    new:false,
    mileage:null,
    fuel:null,
    owners:null
  };

  const ym=s.match(/\b(19\d{2}|20\d{2})\b/);
  if(ym)result.year=Number(ym[1]);

  if(/\bНовый\b/i.test(s)){
    result.new=true;
  }else{
    const mm=s.match(/([\d\s.,]+)\s*км\b/i);
    if(mm)result.mileage=intValue(mm[1]);
  }

  const fuels=[
    'Гибрид (PHEV)',
    'Гибрид (HEV)',
    'Гибрид',
    'Электро',
    'Бензин',
    'Дизель',
    'Газ'
  ];

  for(const fuel of fuels){
    if(s.includes(fuel)){
      result.fuel=fuel;
      break;
    }
  }

  const om=s.match(/(\d+)\s+владельц/i);
  if(om)result.owners=Number(om[1]);

  return result;
}

function extractPrice(text){
  const s=cleanText(text);
  const m=s.match(/\$\s*([\d\s]+(?:[.,]\d+)?)/);
  return m?intValue(m[1]):null;
}

function extractByn(text){
  const s=cleanText(text);

  let m=s.match(/([\d\s]+)\s*белорусских\s+рубл/i);
  if(m)return intValue(m[1]);

  m=s.match(/([\d\s]+)\s*BYN\b/i);
  if(m)return intValue(m[1]);

  return null;
}

function extractCondition(text){
  const s=cleanText(text);
  const m=s.match(/Состояние\s*·\s*([^0-9]+?)(?=\s+\d{4}\b|\s+\d{3,6}\s*км|\s+Новый\b|\s+Электро\b|\s+Бензин\b|\s+Дизель\b|\s+Гибрид\b|$)/i);
  return m?cleanText(m[1]):'Без оценки';
}

function extractPhotos(text){
  const s=cleanText(text);

  let m=s.match(/(?:^|\s)(\d{1,3})\s*фото\b/i);
  if(m)return Number(m[1]);

  m=s.match(/Первая линия\s+(\d{1,3})\s*фото/i);
  if(m)return Number(m[1]);

  return null;
}

function isLikelyCarCardText(text){
  const s=cleanText(text);

  return (
    /Примерно,\s*с\s*доставкой/i.test(s) &&
    /\$\s*[\d\s]+/i.test(s) &&
    /Состояние\s*·/i.test(s) &&
    /\b(?:Бензин|Дизель|Электро|Гибрид)\b/i.test(s) &&
    /\b(?:19|20)\d{2}\b/.test(s)
  );
}

function findCardRoot($,img){
  let node=img;

  for(let i=0;i<9&&node.length;i++){
    const text=cleanText(node.text());

    if(isLikelyCarCardText(text)){
      return node;
    }

    node=node.parent();
  }

  return null;
}

function extractTitle($,card,img){
  const imageAlt=cleanText($(img).attr('alt'));

  if(imageAlt&&imageAlt.length>10)return imageAlt;

  const text=cleanText(card.text());

  const marker=text.search(/Примерно,\s*с\s*доставкой/i);

  if(marker>0){
    let before=text.slice(0,marker);

    before=before
      .replace(/Первая линия/g,'')
      .replace(/\b\d{1,3}\s*фото\b/gi,'')
      .replace(/^\s*[\d\s]+\s*/,'')
      .trim();

    if(before.length>8)return before;
  }

  return 'Автомобиль';
}

function extractImage($,img){
  const attrs=[
    'src',
    'data-src',
    'data-lazy-src',
    'data-original',
    'data-image'
  ];

  for(const a of attrs){
    const v=$(img).attr(a);
    if(v&&/im4car\.com/i.test(v))return absUrl(v);
  }

  const srcset=$(img).attr('srcset')||$(img).attr('data-srcset')||'';
  if(srcset){
    const parts=srcset.split(',').map(x=>x.trim().split(/\s+/)[0]).filter(Boolean);
    const preferred=parts[parts.length-1];
    if(preferred&&/im4car\.com/i.test(preferred))return absUrl(preferred);
  }

  return '';
}

function extractHref($,card){
  const a=card.find('a[href]').first();
  if(!a.length)return'';

  const href=a.attr('href')||'';
  if(!href)return'';

  if(href.startsWith('#'))return'';

  return absUrl(href);
}

function parseCars(html){
  const $=cheerio.load(html,{
    decodeEntities:true
  });

  const cars=[];
  const seen=new Set();

  $('img').each((_,img)=>{
    const image=extractImage($,img);
    if(!image)return;
    if(!/\/cars\//i.test(image))return;
    if(seen.has(image))return;

    const card=findCardRoot($,$(img));
    if(!card)return;

    const text=cleanText(card.text());
    if(!isLikelyCarCardText(text))return;

    const title=extractTitle($,card,img);

    if(
      !title||
      title==='Автомобиль'||
      title.length<5
    )return;

    const priceUsd=extractPrice(text);
    const priceByn=extractByn(text);
    const condition=extractCondition(text);
    const photos=extractPhotos(text);
    const meta=parseMeta(text);
    const url=extractHref($,card);
    const firstLine=/Первая линия/i.test(text);

    if(!priceUsd)return;

    seen.add(image);

    cars.push({
      id:`${image}|${title}`,
      title,
      image,
      photos,
      firstLine,
      priceUsd,
      priceByn,
      condition,
      year:meta.year,
      new:meta.new,
      mileage:meta.mileage,
      fuel:meta.fuel,
      owners:meta.owners,
      ownersText:meta.owners!=null?`${meta.owners} ${ownersWord(meta.owners)}`:'',
      url
    });
  });

  return cars;
}

function shuffle(arr){
  const a=arr.slice();

  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }

  return a;
}

function normalizeCars(cars){
  return cars.filter(c=>
    c&&
    c.title&&
    c.image&&
    c.priceUsd!=null
  ).map(c=>({
    id:c.id,
    title:cleanText(c.title),
    image:c.image,
    photos:c.photos,
    firstLine:!!c.firstLine,
    priceUsd:c.priceUsd,
    priceByn:c.priceByn,
    condition:c.condition||'Без оценки',
    year:c.year,
    new:!!c.new,
    mileage:c.mileage,
    fuel:c.fuel,
    owners:c.owners,
    ownersText:c.ownersText||'',
    url:c.url
  }));
}

app.get('/health',(req,res)=>{
  res.json({
    ok:true,
    service:'red-dragon-car-api',
    time:new Date().toISOString()
  });
});

app.get('/api/catalog',async(req,res)=>{
  try{
    const query=new URLSearchParams();

    Object.entries(req.query||{}).forEach(([key,value])=>{
      if(
        typeof value==='string' &&
        /^[a-zA-Z0-9_]+$/.test(key)
      ){
        query.set(key,value);
      }
    });

    const html=await fetchSource('/catalog',query.toString());

    res.set('Cache-Control','public,max-age=60');

    res.json({
      ok:true,
      source:'im4car.by',
      url:SOURCE_CATALOG,
      html
    });
  }catch(error){
    console.error('[catalog]',error);

    res.status(502).json({
      ok:false,
      error:'Не удалось получить каталог источника',
      message:error.message
    });
  }
});

app.get('/api/cars',async(req,res)=>{
  try{
    const query=new URLSearchParams();

    Object.entries(req.query||{}).forEach(([key,value])=>{
      if(
        typeof value==='string' &&
        /^[a-zA-Z0-9_]+$/.test(key)
      ){
        query.set(key,value);
      }
    });

    const html=await fetchSource('/catalog',query.toString());

    let cars=normalizeCars(parseCars(html));

    const limit=Math.min(
      Math.max(Number(req.query.limit)||6,1),
      30
    );

    if(req.query.random==='1'||req.query.random==='true'){
      cars=shuffle(cars);
    }

    cars=cars.slice(0,limit);

    res.set('Cache-Control','public,max-age=30');

    res.json({
      ok:true,
      source:'im4car.by',
      count:cars.length,
      totalParsed:normalizeCars(parseCars(html)).length,
      cars
    });
  }catch(error){
    console.error('[cars]',error);

    res.status(502).json({
      ok:false,
      error:'Не удалось распарсить автомобили',
      message:error.message,
      cars:[]
    });
  }
});

app.get('/api/debug-cars',async(req,res)=>{
  try{
    const html=await fetchSource('/catalog');
    const cars=normalizeCars(parseCars(html));

    res.json({
      ok:true,
      source:'im4car.by',
      parsed:cars.length,
      sample:cars.slice(0,5)
    });
  }catch(error){
    console.error('[debug-cars]',error);

    res.status(502).json({
      ok:false,
      message:error.message
    });
  }
});

app.get('/api/catalog-html',async(req,res)=>{
  try{
    const query=new URLSearchParams();

    Object.entries(req.query||{}).forEach(([key,value])=>{
      if(
        typeof value==='string' &&
        /^[a-zA-Z0-9_]+$/.test(key)
      ){
        query.set(key,value);
      }
    });

    const html=await fetchSource('/catalog',query.toString());

    res.set({
      'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'public,max-age=60'
    });

    res.send(html);
  }catch(error){
    console.error('[catalog-html]',error);

    res.status(502).send(
      '<!doctype html><html lang="ru"><body>Источник временно недоступен</body></html>'
    );
  }
});

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`Red Dragon API listening on ${PORT}`);
});
