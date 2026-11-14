
const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];

const cors = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*"
};

function ema(values, period) {
  const k = 2 / (period + 1);
  let result = values[0];
  for (const v of values.slice(1)) result = v * k + result * (1 - k);
  return result;
}

function rsi(values) {
  let gains = 0, losses = 0;
  for (let i = values.length - 14; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
}

async function candles(symbol, interval) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=60`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Market data unavailable");
  return res.json();
}

async function analyze(symbol) {
  const [a, b, c] = await Promise.all([
    candles(symbol, "15m"),
    candles(symbol, "1h"),
    candles(symbol, "4h")
  ]);

  const close = x => x.map(k => Number(k[4]));
  const volume = a.map(k => Number(k[5]));
  const p = close(a);
  const h = close(b);
  const d = close(c);

  const trend = x => ema(x.slice(-30), 9) > ema(x.slice(-30), 21) ? 1 : -1;

  const t15 = trend(p);
  const t1 = trend(h);
  const t4 = trend(d);
  const momentum = rsi(p);

  const avgVol = volume.slice(-21, -1).reduce((x,y) => x+y,0) / 20;
  const strongVol = volume[volume.length-1] > avgVol * 1.3;

  let score = 0;
  if (t15 === t1 && t1 === t4) score += 35;
  if ((t15 === 1 && momentum >= 55 && momentum <= 70) ||
      (t15 === -1 && momentum >= 30 && momentum <= 45)) score += 25;
  if (strongVol) score += 15;

  const recent = p.slice(-20);
  const high = Math.max(...recent.slice(0,-1));
  const low = Math.min(...recent.slice(0,-1));
  if ((t15 === 1 && p[p.length-1] > high) ||
      (t15 === -1 && p[p.length-1] < low)) score += 25;

  const direction = t15 === 1 ? "LONG" : "SHORT";
  const valid = score >= 95 && t15 === t1 && t1 === t4 &&
    strongVol && momentum < 75 && momentum > 25;

  return {
    symbol,
    direction: valid ? direction : "NO TRADE",
    score,
    price: p[p.length-1],
    rsi: Number(momentum.toFixed(2)),
    volumeConfirmed: strongVol,
    timeframeConfirmed: t15 === t1 && t1 === t4
  };
}

const page = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>V7 Smart Trade Manager</title>
<style>
body{background:#101827;color:white;font-family:Arial;margin:0;padding:18px}
h2{color:#49d7a2} .card{background:#1c293b;padding:16px;margin:12px 0;border-radius:12px}
button{background:#12a879;color:white;padding:14px;border:0;border-radius:9px;width:100%;font-size:17px}
.small{color:#aab8ca;font-size:13px}.green{color:#49d7a2}.red{color:#ff7373}
</style>
</head>
<body>
<h2>V7 Smart Trade Manager</h2>
<p class="small">STRICT MODE · SIGNALS ONLY · NO AUTO ORDERS</p>
<div class="card">
<h3>Account protection</h3>
<p>Maximum planned risk: 1%</p>
<p>Mode: Paper trading only</p>
<p>Minimum signal score: 95/100</p>
</div>
<button onclick="scan()">SCAN MARKET</button>
<div id="status" class="card">Ready to scan.</div>
<div id="results"></div>
<p class="small">A score is not a win probability. No signal is guaranteed. Verify all trades independently.</p>
<script>
async function scan(){
 const s=document.getElementById('status');
 const r=document.getElementById('results');
 s.textContent='Scanning market...';
 r.innerHTML='';
 try{
  const response=await fetch('/api/scan');
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||'Scan failed');
  s.textContent='Scan complete · '+new Date().toLocaleTimeString();
  data.forEach(x=>{
   r.innerHTML+=\`<div class="card">
   <h3>\${x.symbol}</h3>
   <h2 class="\${x.direction==='NO TRADE'?'red':'green'}">\${x.direction}</h2>
   <p>Score: \${x.score}/100</p>
   <p>Price: \${x.price}</p>
   <p>RSI: \${x.rsi}</p>
   <p>Volume confirmation: \${x.volumeConfirmed?'Yes':'No'}</p>
   <p>Timeframe confirmation: \${x.timeframeConfirmed?'Yes':'No'}</p>
   </div>\`;
  });
 }catch(e){s.textContent='Error: '+e.message;}
}
</script>
</body>
</html>`;

export default {
 async fetch(request) {
  const url = new URL(request.url);

  if (url.pathname === "/api/scan") {
   try {
    const results = await Promise.all(
      symbols.map(async symbol => {
       try { return await analyze(symbol); }
       catch(e) { return {symbol,direction:"NO TRADE",score:0,error:e.message}; }
      })
    );
    return new Response(JSON.stringify(results),{headers:cors});
   } catch(e) {
    return new Response(JSON.stringify({error:e.message}),{status:500,headers:cors});
   }
  }

  return new Response(page,{
   headers:{"Content-Type":"text/html;charset=UTF-8"}
  });
 }
};

