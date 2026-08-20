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
    await page.waitForTimeout(3500);

    for(let i=0;i<5;i++){
      const count=await page.locator('a[href]').count();
      if(count>80)break;
      await page.mouse.wheel(0,1400);
      await page.waitForTimeout(1000);
    }

    const data=await page.evaluate(()=>{
      const abs=v=>{
        if(!v)return null;
        try{return new URL(v,location.href).href}catch{return null}
      };
      const clean=v=>v==null?null:String(v).replace(/\s+/g,' ').trim()||null;
      const bad=/\/(?:login|search|brand|news|about|contact)(?:\/|$)/i;
      const items=[];
      const seen=new Set();

      for(const a of document.querySelectorAll('a[href]')){
        const href=abs(a.getAttribute('href'));
        if(!href||seen.has(href)||!href.includes('im4car.by'))continue;
        if(bad.test(href)||/\/catalog\/?$/i.test(href))continue;
        if(!/(\/cars?\/|\/catalog\/)/i.test(href))continue;

        const img=a.querySelector('img');
        const image=abs(
          img?.getAttribute('src')||
          img?.getAttribute('data-src')||
          img?.getAttribute('data-original')||
          img?.getAttribute('data-lazy-src')||''
        );
        const text=clean(a.innerText||a.textContent);
        const parent=a.closest('article,li,[data-testid],div');
        const parentText=clean(parent?.innerText||'');
        const title=clean(
          a.getAttribute('aria-label')||
          a.getAttribute('title')||
          text?.split('\n')[0]||
          parentText?.split('\n')[0]
        );

        if(!image&&!text&&!title)continue;

        seen.add(href);
        items.push({
          url:href,
          title:title||'Автомобиль',
          image:image||null,
          text:clean([text,parentText].filter(Boolean).join(' '))||null
        });

        if(items.length>=20)break;
      }

      return{
        url:location.href,
        htmlLength:document.documentElement.outerHTML.length,
        title:document.title,
        items
      };
    });

    const cars=data.items.slice(0,12).map((c,i)=>({
      id:String(i+1),
      title:c.title,
      price:null,
      image:c.image,
      url:c.url,
      year:null,
      mileage:null,
      fuel:null,
      drive:null,
      brand:null,
      model:null,
      photos:null,
      sourceText:c.text
    }));

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
