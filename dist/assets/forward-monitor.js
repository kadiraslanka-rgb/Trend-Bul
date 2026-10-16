import {isTrackedStrategy} from './strategy-identity.js';
import {forwardCheck,MODEL_VERSION} from './forward-core.js';
export async function checkForwardRows(rows,request,mark){
 rows=rows.filter(r=>isTrackedStrategy(r.strategyVersion)&&r.status==='OPEN');let next=0;const errors=[];
 const read=async url=>{const r=await request(url);if(!r.ok)throw Error(r.error||'HTTP '+r.status);const d=JSON.parse(r.text);if(Number(d.retCode)!==0||!Array.isArray(d.result?.list))throw Error(d.retMsg||'Invalid candles');return d.result.list.map(r=>({time:Number(r[0])/1000,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])})).sort((a,b)=>a.time-b.time);};
 const scan=async()=>{while(next<rows.length){const row=rows[next++];try{const now=Date.now(),q=encodeURIComponent(row.symbol),deadline=row.deadline,end=Math.min(now,deadline),base='https://api.bybit.com/v5/market/kline?category=linear&symbol='+q;
 const four=await read(base+'&interval=240&limit=1000&start='+row.signalAt+'&end='+(end-1));if(!four.length||four.some(c=>![c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)))throw Error('Invalid or missing 4H candles');
 const from=Math.ceil(row.registeredAt/60000)*60000,partialEnd=(Math.floor(row.registeredAt/14400000)+1)*14400000,minEnd=Math.min(partialEnd,end);let minutes=[];
 if(minEnd>from)minutes.push(...await read(base+'&interval=1&limit=1000&start='+from+'&end='+(minEnd-1)));
 const current=Math.floor(now/14400000)*14400000;if(current>=partialEnd&&current<end)minutes.push(...await read(base+'&interval=1&limit=1000&start='+current+'&end='+(end-1)));
 const update=forwardCheck(row,four,now,minutes);if(update)await mark(JSON.stringify(update));if(update?.error)errors.push(row.symbol+': '+update.error);
 }catch(e){errors.push(row.symbol+': '+e.message);}}};await Promise.all(Array.from({length:3},scan));return errors;
}
