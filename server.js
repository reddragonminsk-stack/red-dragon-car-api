const express=require('express');
const app=express();
const PORT=process.env.PORT||10000;

const SOURCE='https://im4car.by/catalog';

const HEADERS={
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control':'no-cache',
  'Pragma':'no-cache'
};

async function getSource(){
  const r=await fetch(SOURCE,{
    method:'GET',
    headers:HEADERS,
    redirect:'follow'
  });

  const html=await r.text();

  return {
    response:r,
    html
  };
}

function findAll(html,re){
  return html.match(re)||[];
}

function unique(a){
  return [...new Set(a)];
}

function extractImageUrls(html){
  const patterns=[
    /https:\/\/img\.im4car\.com\/[^"'\\\s<>]+?\/preview\.webp/gi,
    /https:\\\/\\\/img\.im4car\.com\\\/[^"'\\\s<>]+?\\\/preview\.webp/gi
  ];

  const out=[];

  for(const p of patterns){
    for(const x of findAll(html,p)){
      out.push(x.replace(/\\\//g,'/'));
    }
  }

  return unique(out);
}

function extractCarLikeUrls(html){
  const out=[];

  const patterns=[
    /https:\/\/im4car\.by\/(?:catalog\/)?cars\/[^"'\\\s<>]+/gi,
    /href=["']([^"']*\/cars\/[^"']+)["']/gi,
    /href=\\"([^\\"]*\/cars\/[^\\"]+)\\"/gi
  ];

  for(const p of patterns){
    for(const m of findAll(html,p)){
      out.push(Array.isArray(m)?m[1]||m:m);
    }
  }

  return unique(out);
}

function extractNextData(html){
  const out=[];

  const p=/<script[^>]*>([\s\S]*?__next_f\.push[\s\S]*?)<\/script>/gi;

  for(const m of html.matchAll(p)){
    if(m[1])out.push(m[1]);
  }

  return out;
}

function sourceStats(html){
  const images=extractImageUrls(html);
  const cars=extractCarLikeUrls(html);
  const nextData=extractNextData(html);

  return {
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
    title:(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||null,
    description:(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)||[])[1]||null,
    images:images.slice(0,30),
    carUrls:cars.slice(0,30),
    nextSamples:nextData.slice(0,5)
  };
}

app.get('/',async(req,res)=>{
  res.json({
    ok:true,
    service:'red-dragon-car-api',
    time:new Date().toISOString(),
    endpoints:{
      debug:'/api/debug-source',
      source:'/api/source',
      health:'/'
    }
  });
});

app.get('/api/debug-source',async(req,res)=>{
  try{
    const {response,html}=await getSource();
    const stats=sourceStats(html);

    res.json({
      ok:true,
      source:'im4car.by',
      requestedUrl:SOURCE,
      finalUrl:response.url,
      status:response.status,
      contentType:response.headers.get('content-type'),
      ...stats,
      beginning:html.slice(0,5000),
      end:html.slice(-3000)
    });
  }catch(e){
    console.error(e);

    res.status(500).json({
      ok:false,
      source:'im4car.by',
      url:SOURCE,
      error:e.message,
      stack:e.stack
    });
  }
});

app.get('/api/source',async(req,res)=>{
  try{
    const {response,html}=await getSource();

    res.status(response.ok?200:502);
    res.set('Content-Type','application/json; charset=utf-8');

    res.json({
      ok:response.ok,
      status:response.status,
      source:'im4car.by',
      url:SOURCE,
      finalUrl:response.url,
      htmlLength:html.length,
      html
    });
  }catch(e){
    console.error(e);

    res.status(500).json({
      ok:false,
      error:e.message
    });
  }
});

app.get('/api/test-images',async(req,res)=>{
  try{
    const {html}=await getSource();
    const images=extractImageUrls(html);

    res.json({
      ok:true,
      count:images.length,
      images
    });
  }catch(e){
    res.status(500).json({
      ok:false,
      error:e.message
    });
  }
});

app.get('/api/test-next',async(req,res)=>{
  try{
    const {html}=await getSource();
    const blocks=extractNextData(html);

    res.json({
      ok:true,
      count:blocks.length,
      blocks:blocks.slice(0,10)
    });
  }catch(e){
    res.status(500).json({
      ok:false,
      error:e.message
    });
  }
});

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`red-dragon-car-api listening on port ${PORT}`);
});
