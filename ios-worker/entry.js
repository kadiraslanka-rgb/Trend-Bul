// iOS background worker entry: same steps as dist/assets/live-worker.js,
// wrapped in a function so it can run inside JavaScriptCore (no WebView).
import {cryptoInstrumentMap} from '../dist/assets/crypto-universe.js';
import {scanCurrent,batchCandidates,signalRecord} from '../dist/assets/live-strategy.js';
import {checkForwardRows} from '../dist/assets/forward-monitor.js';
globalThis.TRADINGLY_RUN=async function(){
 const native=globalThis.LiveNative,pending=new Map();let sequence=0;
 globalThis.liveReply=(id,r)=>{const p=pending.get(id);if(p){pending.delete(id);clearTimeout(p.timer);p.resolve(r);}};
 const request=url=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Native request timeout'));},65000);pending.set(id,{resolve,timer});native.request(url,id);});
 let result={tested:0,total:0,signals:0,errors:[],insufficient:[]};
 try{
  result.errors.push(...await checkForwardRows(JSON.parse(native.history()),request,row=>native.mark(row)));
  const instruments=await cryptoInstrumentMap(request,'bybit');const symbols=[...instruments.keys()].map(symbol=>({symbol,exchange:'bybit',volume24hUsd:0,change24h:0}));
  result.total=symbols.length;native.progress(JSON.stringify({tested:0,total:symbols.length,symbol:'BTCUSDT'}));const scan=await scanCurrent({symbols,request,onSignal:async(s,at)=>{const row=signalRecord(s,at);if(row)native.observe(JSON.stringify(row));},progress:p=>native.progress(JSON.stringify(p))});result={tested:scan.tested,total:scan.total,signals:scan.signals.length,errors:[...result.errors,...scan.errors],insufficient:scan.insufficient,diagnostics:scan.diagnostics};
  const committed=JSON.parse(native.batch(JSON.stringify({candidates:batchCandidates(scan.candidates)})));if(committed.error)throw Error(committed.error);result.errors.push(...await checkForwardRows(JSON.parse(native.history()),request,row=>native.mark(row)));result.accepted=committed.accepted?.length||0;result.recorded=committed.recorded?.length||0;result.notified=committed.notified||0;result.pendingNotifications=committed.pendingNotifications||0;result.processedBefore=Math.max(0,scan.signals.length-result.recorded);result.skippedBusy=committed.skippedBusy||0;
 }catch(e){result.errors.push(String(e.message||e));}finally{native.done(JSON.stringify(result));}
};
