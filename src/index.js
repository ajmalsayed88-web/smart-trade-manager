
const BINANCE = "https://fapi.binance.com";

function ema(values, period) {
  if (values.length < period) return null;
  let result = values.slice(0, period).reduce((a,b) => a+b,0) / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++)
    result = values[i] * k + result * (1-k);
  return result;
}

function rsi(values) {
  if (values.length < 16) return null;
  let gain = 0, loss = 0;
  for (let i=1; i<=14; i++) {
    const d=values[i]-values[i-1];
    if(d>0) gain+=d; else loss-=d;
  }
  let ag=gain/14, al=loss/14;
  for(let i=15;i<values.length;i++){
    const d=values[i]-values[i-1];
    ag=(ag*13+Math.max(d,0))/14;
    al=(al*13+Math.max(-d,0))/14;
  }
  return al===0 ? 100 : 100-100/(1+ag/al);
}

async function getJSON(url) {
  const response=await fetch(url);
  if(!response.ok) throw new Error("Binance API "+response.status);
  return response.json();
}

function analyse(raw) {
  const candles=raw.slice(0,-1);
  if(candles.length<60) throw new Error("Insufficient candles");

  const close=candles.map(x=>Number(x[4]));
  const high=candles.map(x=>Number(x[2]));
  const low=candles.map(x=>Number(x[3]));
  const volume=candles.map(x=>Number(x[5]));
  const last=close.length-1;
  const price=close[last];

  const e9=ema(close,9);
  const e21=ema(close,21);
  const e50=ema(close,50);
  const momentum=rsi(close);

  const ranges=[];
  for(let i=1;i<close.length;i++){
    ranges.push(Math.max(
      high[i]-low[i],
      Math.abs(high[i]-close[i-1]),
      Math.abs(low[i]-close[i-1])
    ));
  }

  const atr=ranges.slice(-14).reduce((a,b)=>a+b,0)/14;
  const averageVolume=volume.slice(-21,-1).reduce((a,b)=>a+b,0)/20;
  const volumeRatio=averageVolume>0?volume[last]/averageVolume:0;

  const previousHigh=Math.max(...high.slice(-21,-1));
  const previousLow=Math.min(...low.slice(-21,-1));

  return {
    price,atr,momentum,volumeRatio,
    atrPercent:atr/price*100,
    bullish:price>e21&&e9>e21&&e21>e50,
    bearish:price<e21&&e9<e21&&e21<e50,
    breakoutUp:price>previousHigh,
    breakoutDown:price<previousLow
  };
}

async function getAnalysis(symbol, interval) {
  const url=BINANCE+"/fapi/v1/klines?symbol="+symbol+
    "&interval="+interval+"&limit=100";
  return analyse(await getJSON(url));
}

async function analyseCoin(symbol) {
  const [m15,h1,h4]=await Promise.all([
    getAnalysis(symbol,"15m"),
    getAnalysis(symbol,"1h"),
    getAnalysis(symbol,"4h")
  ]);

  const volumeOK=m15.volumeRatio>=1.5;
  const volatilityOK=m15.atrPercent>=0.15&&m15.atrPercent<=2.5;

  const longOK=
    m15.bullish&&h1.bullish&&h4.bullish&&
    m15.momentum>=55&&m15.momentum<=68&&
    m15.breakoutUp&&volumeOK&&volatilityOK;

  const shortOK=
    m15.bearish&&h1.bearish&&h4.bearish&&
    m15.momentum>=32&&m15.momentum<=45&&
    m15.breakoutDown&&volumeOK&&volatilityOK;

  let signal="NO TRADE";
  if(longOK) signal="LONG";
  if(shortOK) signal="SHORT";

  const entry=m15.price;
  const stopDistance=m15.atr*1.5;

  return {
    symbol,
    signal,
    score:signal==="NO TRADE"?0:100,
    entry:signal==="NO TRADE"?null:entry,
    sl:signal==="LONG"?entry-stopDistance:
       signal==="SHORT"?entry+stopDistance:null,
    tp1:signal==="LONG"?entry+m15.atr:
        signal==="SHORT"?entry-m15.atr:null,
    tp2:signal==="LONG"?entry+2*m15.atr:
        signal==="SHORT"?entry-2*m15.atr:null,
    tp3:signal==="LONG"?entry+3*m15.atr:
        signal==="SHORT"?entry-3*m15.atr:null
  };
}

async function scanMarket() {
  const [info,tickers]=await Promise.all([
    getJSON(BINANCE+"/fapi/v1/exchangeInfo"),
    getJSON(BINANCE+"/fapi/v1/ticker/24hr")
  ]);

  const active=new Set(info.symbols
    .filter(s=>s.status==="TRADING"&&
      s.contractType==="PERPETUAL"&&s.quoteAsset==="USDT")
    .map(s=>s.symbol));

  const top=tickers
    .filter(t=>active.has(t.symbol)&&Number(t.quoteVolume)>0)
    .sort((a,b)=>Number(b.quoteVolume)-Number(a.quoteVolume))
    .slice(0,30);

  const results=[];
  for(let i=0;i<top.length;i+=4){
    const batch=await Promise.all(top.slice(i,i+4).map(async t=>{
      try {
        return await analyseCoin(t.symbol);
      } catch(error) {
        return {
          symbol:t.symbol,signal:"NO TRADE",score:0,
          entry:null,sl:null,tp1:null,tp2:null,tp3:null,
          error:error.message
        };
      }
    }));
    results.push(...batch);
  }

  return {time:new Date().toISOString(),results};
}

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart Trade Manager V7</title>
<style>
body{margin:0;padding:16px;background:#0b1220;color:#e8eef8;font-family:Arial}
h2{color:#55dc99}
.panel{background:#141f31;border:1px solid #293b54;border-radius:12px;padding:14px;margin:14px 0}
button{background:#168b58;color:white;border:0;border-radius:8px;padding:13px;font-weight:bold;width:100%}
button:disabled{opacity:.5}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12px}
td,th{padding:11px 7px;border-bottom:1px solid #29364a;text-align:left;white-space:nowrap}
th{color:#a5b6cc}
.green{color:#55e39a;font-weight:bold}
.red{color:#ff7777;font-weight:bold}
.gray{color:#a8b5c8}
.small{font-size:12px;color:#a5b6cc;line-height:1.7}
</style>
</head>
<body>
<h2>SMART TRADE MANAGER V7</h2>
<div class="small">Top 30 USDT perpetual coins | Strict LONG / SHORT</div>
<div class="panel">
<div id="status">Ready</div>
<p><button id="scan">SCAN TOP 30 COINS</button></p>
<div class="small">Automatic orders: DISABLED<br>Signal threshold: 100/100<br>Paper testing only</div>
</div>
<div class="panel">
<b>Market summary</b>
<p class="small" id="summary">No scan completed.</p>
</div>
<div class="panel">
<b>Trading signals</b>
<div class="scroll">
<table>
<thead><tr>
<th>Coin</th><th>Signal</th><th>Score</th>
<th>Entry</th><th>SL</th><th>TP1</th><th>TP2</th><th>TP3</th>
</tr></thead>
<tbody id="rows"><tr><td colspan="8">Press scan to begin.</td></tr></tbody>
</table>
</div>
</div>
<div class="small">
100/100 means every programmed filter passed. It is NOT a 100% win probability. Signals are not guaranteed. No automatic trading. Paper-test first.
</div>
<script>
const button=document.getElementById("scan");
const rows=document.getElementById("rows");
const status=document.getElementById("status");
const summary=document.getElementById("summary");

function fmt(n){
 return n===null||n===undefined?"-":Number(n).toPrecision(7);
}

button.onclick=async()=>{
 button.disabled=true;
 status.textContent="Scanning Binance top 30...";
 rows.innerHTML="";
 try{
  const response=await fetch("/api/scan");
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"Scan failed");

  const results=data.results||[];
  let signals=0;

  rows.innerHTML=results.map(x=>{
   if(x.signal!=="NO TRADE")signals++;
   const cls=x.signal==="LONG"?"green":
     x.signal==="SHORT"?"red":"gray";
   return "<tr><td>"+x.symbol+"</td><td class='"+cls+"'>"+
     x.signal+"</td><td>"+x.score+"/100</td><td>"+
     fmt(x.entry)+"</td><td>"+fmt(x.sl)+"</td><td>"+
     fmt(x.tp1)+"</td><td>"+fmt(x.tp2)+"</td><td>"+
     fmt(x.tp3)+"</td></tr>";
  }).join("");

  summary.textContent="Scanned: "+results.length+
   " | LONG/SHORT signals: "+signals+
   " | NO TRADE: "+(results.length-signals);
  status.textContent="Completed: "+new Date(data.time).toLocaleString();
 }catch(e){
  status.textContent="Error: "+e.message;
  rows.innerHTML="<tr><td colspan='8'>Scan failed. Try again later.</td></tr>";
 }finally{
  button.disabled=false;
 }
};
</script>
</body>
</html>`;

export default {
  async fetch(request) {
    const url=new URL(request.url);

    if(url.pathname==="/api/scan"){
      try {
        const data=await scanMarket();
        return Response.json(data,{
          headers:{"Cache-Control":"no-store"}
        });
      } catch(error) {
        return Response.json({error:error.message},{status:502});
      }
    }

    return new Response(HTML,{
      headers:{"Content-Type":"text/html;charset=UTF-8"}
    });
  }
};
