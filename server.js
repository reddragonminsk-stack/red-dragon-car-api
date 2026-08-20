const express=require('express');
const cors=require('cors');
const {chromium}=require('playwright');

const app=express();
const PORT=process.env.PORT||10000;
const SOURCE='https://im4car.by';
const CATALOG=SOURCE+'/catalog';

app.use(cors());

let browserPromise=null;
let cache={time:0,data:null};
const CACHE_MS=120000;

function clean(v){
  if(v==null)return null;
  return String(v).replace(/\s+/g,' ').trim()||null;
}

function parseCardText(text){
  text=clean(text)||'';
  const price=(text.match(/(?:\$|USD)\s*([\d\s,.]+)/i)||[])[1]||null;
  const year=(text.match(/\b20\d{2}\b/)||[])[0]||null;
  const mileage=(text.match(/([\d\s,.]+)\s*(?:км|km)\b/i)||[])[1]||null;
  let fuel=null;
  if(/гибрид\s*\(PHEV\)/i.test(text))fuel='Гибрид (PHEV)';
  else if(/гибрид\s*\(HEV\)/i.test(text))fuel='Гибрид (HEV)';
  else if(/электро/i.test(text))fuel='Электро';
  else if(/дизель/i.test(text))fuel='Дизель';
  else if(/бензин/i.test(text))fuel='Бензин';
  return{
    price:price?price.replace(/\s/g,'').replace(/,/g,''):null,
    year,
    mileage:mileage?mileage.replace(/\s/g,''):null,
    fuel
  };
}

async function getBrowser(){
  if(!browserPromise){
    browserPromise=chromium.launch({
      headless:true,
      args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
    }).catch(err=>{
      browserPromise=null;
      throw err;
    });
  }
  return browserPromise;
}

async function scrapeCatalog(){
  if(cache.data&&Date.now()-cache.time<CACHE_MS)return cache.data;

  const browser=await getBrowser();
  const context=await browser.newContext({
    userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    locale:'ru-RU',
    viewport:{width:1440,height:1000},
    colorScheme:'light'
  });
  const page=await context.newPage();
  page.setDefaultTimeout(20000);

  try{
    await page.goto(CATALOG,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(4500);

    for(let i=0;i<5;i++){
      const imgs=await page.locator('img').count();
      const links=await page.locator('a[href]').count();
      if(imgs>=12&&links>40)break;
      await page.mouse.wheel(0,1400);
      await page.waitForTimeout(1000);
    }

    const data=await page.evaluate(()=>{
      const abs=v=>{
        if(!v)return null;
        try{return new URL(v,location.href).href}catch{return null}
      };
      const clean=v=>v==null?null:String(v).replace(/\s+/g,' ').trim()||null;
      const excluded=/\/(?:login|search|brand|news|about|contact|catalog|brands?)(?:\/|$)/i;
      const items=[];
      const seen=new Set();

      for(const a of document.querySelectorAll('a[href]')){
        const href=abs(a.getAttribute('href'));
        if(!href||seen.has(href)||!href.includes('im4car.by'))continue;

        const img=a.querySelector('img');
        const image=abs(
          img?.currentSrc||
          img?.getAttribute('src')||
          img?.getAttribute('data-src')||
          img?.getAttribute('data-original')||
          img?.getAttribute('data-lazy-src')||''
        );
        const text=clean(a.innerText||a.textContent);
        const box=a.closest('article,li,[data-testid]')||a;
        const boxText=clean(box.innerText||text);
        const combined=clean([text,boxText].filter(Boolean).join(' '))||'';

        const hasPrice=/\$\s*[\d\s,.]+|[\d\s,.]+\s*USD/i.test(combined);
        const hasYear=/\b20\d{2}\b/.test(combined);
        const hasMileage=/[\d\s,.]+\s*(?:км|km)\b/i.test(combined);
        const hasCarSignal=hasPrice&&(hasYear||hasMileage)||(image&&combined.length>40);

        if(!hasCarSignal)continue;
        if(excluded.test(href)&&!image)continue;

        let title=clean(
          box.querySelector('h1,h2,h3,h4,h5,[class*="title"],[class*="name"]')?.textContent||
          text||
          combined
        );

        title=title
          .replace(/^\d+\s*фото\s*/i,'')
          .replace(/^Первая линия\s*/i,'')
          .replace(/\s+/g,' ')
          .trim();

        if(!title||title.length<3)title='Автомобиль';

        seen.add(href);
        items.push({url:href,title,image:image||null,text:combined});

        if(items.length>=20)break;
      }

      return{
        url:location.href,
        htmlLength:document.documentElement.outerHTML.length,
        title:document.title,
        items
      };
    });

    const cars=data.items.slice(0,12).map((c,i)=>{
      const meta=parseCardText(c.text);
      return{
        id:String(i+1),
        title:c.title,
        price:meta.price,
        image:c.image,
        url:c.url,
        year:meta.year,
        mileage:meta.mileage,
        fuel:meta.fuel,
        drive:null,
        brand:null,
        model:null,
        photos:null
      };
    });

    const result={
      source:data.url,
      htmlLength:data.htmlLength,
      title:data.title,
      foundUrls:data.items.length,
      cars
    };

    cache={time:Date.now(),data:result};
    return result;
  }finally{
    await context.close();
  }
}

app.get('/',(req,res)=>res.json({ok:true,service:'red-dragon-car-api',endpoint:'/api/home-cars?limit=12'}));

app.get('/health',async(req,res)=>{
  try{
    await getBrowser();
    res.json({ok:true,service:'red-dragon-car-api',browser:true});
  }catch(e){
    res.status(503).json({ok:false,browser:false,error:e.message});
  }
});

app.get('/api/home-cars',async(req,res)=>{
  try{
    const limit=Math.max(1,Math.min(12,Number(req.query.limit)||12));
    const data=await scrapeCatalog();
    const cars=data.cars.slice(0,limit);
    res.json({ok:true,count:cars.length,foundUrls:data.foundUrls,htmlLength:data.htmlLength,cars});
  }catch(e){
    console.error('[home-cars]',e);
    res.status(502).json({ok:false,error:e.message});
  }
});

app.get('/api/cars',async(req,res)=>{
  try{
    const data=await scrapeCatalog();
    res.json(data.cars);
  }catch(e){
    console.error('[cars]',e);
    res.status(502).json({ok:false,error:e.message});
  }
});

app.get('/api/debug-source',async(req,res)=>{
  try{
    const data=await scrapeCatalog();
    res.json({ok:true,status:200,source:data.source,htmlLength:data.htmlLength,foundUrls:data.foundUrls,title:data.title,sample:data.cars.slice(0,12)});
  }catch(e){
    console.error('[debug-source]',e);
    res.status(502).json({ok:false,error:e.message});
  }
});

process.on('SIGTERM',async()=>{
  try{
    if(browserPromise){
      const browser=await browserPromise;
      await browser.close();
    }
  }finally{
    process.exit(0);
  }
});

app.listen(PORT,'0.0.0.0',()=>console.log('red-dragon-car-api listening on '+PORT));
