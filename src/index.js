
const BINANCE = "https://fapi.binance.com";

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart Trade Manager V7</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0b1220;color:#e8eef8;font-family:Arial,sans-serif;padding:16px}
h2{color:#58d68d}
.panel{background:#141f31;border:1px solid #26364e;border-radius:12px;padding:14px;margin:14px 0}
button{background:#168b58;color:white;border:0;border-radius:8px;padding:12px 18px;font-weight:bold}
button:disabled{opacity:.5}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:10px 6px;border-bottom:1px solid #29364a;text-align:left;white-space:nowrap}
th{color:#9aabc3}
.green{color:#55e39a;font-weight:bold}
.red{color:#ff7777;font-weight:bold}
.gray{color:#a8b5c8}
.scroll{overflow-x:auto}
.small{font-size:12px;color:#9aabc3;line-height:1.6}
</style>
</head>
<body>
<h2>SMART TRADE MANAGER V7</h2>
<div class="small">Strict LONG / SHORT signals | 100/100 only</div>
<div class="panel">
<div id="status">Ready to scan</div>
<p><button id="scan">SCAN TOP 30 COINS</button></p>
<div class="small">Automatic orders: DISABLED<br>Paper testing only</div>
</div>
<div class="panel">
<b>Market summary</b>
<div id="summary" class="small">No scan yet.</div>
</div>
<div class="panel">
<b>Signals</b>
<div class="scroll">
<table>
<thead><tr><th>Coin</th><th>Signal</th><th>Score</th><th>Entry</th><th>SL</th><th>TP1</th><th>TP2</th><th>TP3</th></tr></thead>
<tbody id="rows"><tr><td colspan="8">Press scan.</td></tr></tbody>
</table>
</div>
</div>
<div class="small">100/100 means all programmed filters passed, not a 100% win probability. Signals are not guarantees. Test on paper before any live trading.</div>
<script>
const scanButton=document.getElementById("scan");
const rows=document.getElementById("rows");
const status=document.getElementById("status");
const summary=document.getElementById("summary");

function fmt(n){return Number.isFinite(n)?Number(n).toPrecision(7):"-"}

async function getJSON(url){
 const r=await fetch(url);
 if(!r.ok)throw new Error("API error "+r.status);
 return r.json();
}

function ema(v,p){
 if(v.length<p)return null;
 let e=v.slice(0,p).reduce((a,b)=>a+b,0)/p;
 const k=2/(p+1);
 for(let i=p;i<v.length;i++)e=v[i]*k+e*(1-k);
 return e;
}

function rsi(v){
 let g=0,l=0;
 for(let i=1;i<=14;i++){
  const d=v[i]-v[i-1];
  if(d>0)g+=d;else l-=d;
 }
 let ag=g/14,al=l/14;
 for(let i=15;i<v.length;i++){
  const d=v[i]-v[i-1];
  ag=(ag*13+Math.max(d,0))/14;
  al=(al*13+Math.max(-d,0))/14;
 }
 return al===0?100:100-100/(1+ag/al);
}

function analyse(k){
 const c=k.map(x=>+x[4]);
 const h=k.map(x=>+x[2]);
 const l=k.map(x=>+x[3]);
 const v=k.map(x=>+x[5]);
 const i=c.length-1,price=c[i];
 const e9=ema(c,9),e21=ema(c,21),e50=ema(c,50);
 const momentum=rsi(c);
 let tr=[];
 for(let j=1;j<c.length;j++)
  tr.push(Math.max(h[j]-l[j],Math.abs(h[j]-c[j-1]),Math.abs(l[j]-c[j-1])));
 const atr=tr.slice(-14).reduce((a,b)=>a+b,0)/14;
 const avgVol=v.slice(-21,-1).reduce((a,b)=>a+b,0)/20;
 const volRatio=avgVol?v[i]/avgVol:0;
 const high=Math.max(...h.slice(-21,-1));
 const low=Math.min(...l.slice(-21,-1));
 return {
  price,atr,momentum,volRatio,
  atrPct:atr/price*100,
  bull:price>e21&&e9>e21&&e21>e50,
  bear:price<e21&&e9<e21&&e21<e50,
  up:price>high,down:price<low
 };
}

async function candles(s,t){
 const k=await getJSON("/__never__");
 return k;
}

async function analyseCoin(symbol){
 const base="https://fapi.binance.com/fapi/v1/klines?symbol="+symbol+"&limit=100&interval=";
 const [a,b,c]=await Promise.all([
  getJSON(base+"15m"),getJSON(base+"1h"),getJSON(base+"4h")
 ]);
 const m=analyse(a.slice(0,-1));
 const h=analyse(b.slice(0,-1));
 const q=analyse(c.slice(0,-1));
 const vol=m.volRatio>=1.5;
 const atrOK=m.atrPct>=0.15&&m.atrPct<=2.5;
 let signal="NO TRADE";
 if(m.bull&&h.bull&&q.bull&&m.momentum>=55&&m.momentum<=68&&m.up&&vol&&atrOK)signal="LONG";
 if(m.bear&&h.bear&&q.bear&&m.momentum>=32&&m.momentum<=45&&m.down&&vol&&atrOK)signal="SHORT";
 const d=m.atr*1.5;
 return {
  symbol,signal,score:signal==="NO TRADE"?0:100,
  entry:signal==="NO TRADE"?null:m.price,
  sl:signal==="LONG"?m.price-d:signal==="SHORT"?m.price+d:null,
  tp1:signal==="LONG"?m.price+m.atr:signal==="SHORT"?m.price-m.atr:null,
  tp2:signal==="LONG"?m.price+2*m.atr:signal==="SHORT"?m.price-2*m.atr:null,
  tp3:signal==="LONG"?m.price+3*m.atr:signal==="SHORT"?m.price-3*m.atr:null
 };
}

async function scan(){
 const [info,tickers]=await Promise.all([
  getJSON("https://fapi.binance.com/fapi/v1/exchangeInfo"),
  getJSON("https://fapi.binance.com/fapi/v1/ticker/24hr")
 ]);
 const active=new Set(info.symbols.filter(s=>
  s.status==="TRADING"&&s.contractType==="PERPETUAL"&&s.quoteAsset==="USDT"
 ).map(s=>s.symbol));
 const top=tickers.filter(t=>active.has(t.symbol))
  .sort((a,b)=>+b.quoteVolume-(+a.quoteVolume)).slice(0,30);
 const results=[];
 for(let i=0;i<top.length;i+=3){
  const batch=await Promise.all(top.slice(i,i+3).map(async t=>{
   try{return await analyseCoin(t.symbol)}
   catch(e){return {symbol:t.symbol,signal:"NO TRADE",score:0}}
  }));
  results.push(...batch);
 }
 return results;
}

scanButton.onclick=async()=>{
 scanButton.disabled=true;
 status.textContent="Scanning top 30 coins...";
 try{
  const results=await scan();
  rows.innerHTML=results.map(x=>{
   const cls=x.signal==="LONG"?"green":x.signal==="SHORT"?"red":"gray";
   return "<tr><td>"+x.symbol+"</td><td class='"+cls+"'>"+x.signal+"</td><td>"+x.score+"/100</td><td>"+fmt(x.entry)+"</td><td>"+fmt(x.sl)+"</td><td>"+fmt(x.tp1)+"</td><td>"+fmt(x.tp2)+"</td><td>"+fmt(x.tp3)+"</td></tr>";
  }).join("");
  const n=results.filter(x=>x.signal!=="NO TRADE").length;
  summary.textContent="Scanned "+results.length+" coins. Strict signals: "+n+". No trade: "+(results.length-n);
  status.textContent="Scan complete: "+new Date().toLocaleString();
 }catch(e){status.textContent="Error: "+e.message}
 scanButton.disabled=false;
};
</script>
</body>
</html>`;

export default {
 async fetch(request){
  const url=new URL(request.url);
  if(url.pathname==="/api/scan")return Response.json({error:"Use dashboard scan"});
  return new Response(HTML,{headers:{"Content-Type":"text/html;charset=UTF-8"}});
 }
};
