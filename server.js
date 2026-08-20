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

app.use(express.json());

const SOURCE='https://im4car.by';

async function fetchSource(path='/catalog',query=''){
  const url=SOURCE+path+(query?`?${query}`:'');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);

  try{
    const r=await fetch(url,{
      signal:controller.signal,
      headers:{
        'User-Agent':'Mozilla/5.0 (compatible; RedDragonCatalog/1.0)',
        'Accept':'text/html,application/xhtml+xml',
        'Accept-Language':'ru-RU,ru;q=0.9,en;q=0.8'
      }
    });

    if(!r.ok)throw new Error(`Source HTTP ${r.status}`);

    return await r.text();
  }finally{
    clearTimeout(timer);
  }
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
      if(typeof value==='string'&&/^[a-zA-Z0-9_]+$/.test(key)){
        query.set(key,value);
      }
    });

    const html=await fetchSource('/catalog',query.toString());

    res.set('Cache-Control','public,max-age=60');
    res.json({
      ok:true,
      source:'im4car.by',
      url:SOURCE+'/catalog',
      html
    });
  }catch(error){
    console.error(error);
    res.status(502).json({
      ok:false,
      error:'Не удалось получить каталог источника',
      message:error.message
    });
  }
});

app.get('/api/catalog-html',async(req,res)=>{
  try{
    const query=new URLSearchParams();

    Object.entries(req.query||{}).forEach(([key,value])=>{
      if(typeof value==='string'&&/^[a-zA-Z0-9_]+$/.test(key)){
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
    console.error(error);
    res.status(502).send(
      '<!doctype html><html lang="ru"><body>Источник временно недоступен</body></html>'
    );
  }
});

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`Red Dragon API listening on ${PORT}`);
});
