const express=require('express');
const cors=require('cors');
const app=express();
const PORT=process.env.PORT||10000;
const IMG='https://img.im4car.com';
const SITE='https://im4car.by';
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
].map(([id,title,price,year,mileage,fuel,photos])=>({id,title,name:title,price,priceUsd:price,year,mileage,fuel,fuelType:fuel,photos,image:`${IMG}/640/cars/${id}/preview.webp`,preview:`${IMG}/640/cars/${id}/preview.webp`,photoCount:photos,url:`${SITE}/cars/${id}`,href:`${SITE}/cars/${id}`,status:'ACTIVE'}));

app.get('/',(q,r)=>r.json({ok:true,service:'red-dragon-car-api',endpoint:'/api/home-cars?limit=12',method:'bundled'}));
app.get('/health',(q,r)=>r.json({ok:true,method:'bundled',count:cars.length,source:'bundled-data'}));
app.get('/api/home-cars',(q,r)=>{const n=Math.min(12,Math.max(1,Number(q.query.limit)||12));r.json({ok:true,count:Math.min(n,cars.length),foundUrls:cars.length,total:568020,method:'bundled',source:'bundled-data',cars:cars.slice(0,n)});});
app.get('/api/cars',(q,r)=>r.json(cars));
app.get('/api/debug-source',(q,r)=>r.json({ok:true,status:200,source:'bundled-data',method:'bundled',total:568020,foundUrls:cars.length,sample:cars}));
app.listen(PORT,'0.0.0.0',()=>console.log(`red-dragon-car-api listening on ${PORT}`));
