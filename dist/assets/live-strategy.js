import {candidateAudit} from './candidate-audit.js';
import {historicalBothDetect} from './historical-short-detector.js';
import {analyzeTrade,benchmarkFeatures} from './trade-analysis.js';
import {attachConfirmations} from './confirmation.js';
import {MODEL_VERSION} from './backtest-core.js';
import {compareEntryPriority} from './stoch-strategy.js';
export {MODEL_VERSION};
export const H=14400;
export function liveCandidates(candles,info,benchmark,now=Date.now()/1000,detect=historicalBothDetect){
 if(info.exchange!=='bybit')throw Error('Only Bybit USDT crypto is supported');
 const boundary=Math.floor(now/H)*H,current=candles.find(c=>c.time===boundary),past=candles.filter(c=>c.time<boundary&&c.time+H<=boundary).slice(-498);
 if(past.length<72){const e=Error('Yetersiz 4H geçmişi / Insufficient 4H history: '+past.length+' / 72');e.code='INSUFFICIENT_HISTORY';throw e;}
 if(!current)throw Error('Güncel 4H açılışı eksik / Current 4H open missing');
 if(past.at(-1).time+H!==boundary)throw Error('Son kapanmış 4H mumu eksik / Latest closed 4H candle missing');
 if(![current.open,...past.flatMap(c=>[c.time,c.open,c.high,c.low,c.close,c.volume])].every(Number.isFinite)||current.open<=0)throw Error('Invalid candle data');
 for(let i=1;i<past.length;i++)if(past[i].time!==past[i-1].time+H)throw Error('Missing 4H candles in entry window');
 const btc=benchmarkFeatures(benchmark,boundary);if(btc.referenceClosedAt!==boundary)throw Error('BTC latest closed 4H candle unavailable');
 const stub={time:boundary,rawTime:boundary*1000,open:current.open,high:current.open,low:current.open,close:current.open,volume:0};
 return detect([...past,stub],info.symbol,'4H',info.volume24hUsd||0,info.change24h||0,'bybit',boundary).map(signal=>{
  return evaluateLiveSignal(past,current,info,btc,signal,boundary);
 });
}
export function evaluateLiveSignal(past,current,info,btc,signal,boundary){
 if(btc.referenceClosedAt!==boundary)throw Error('BTC closed reference mismatch');
 const stub={time:boundary,rawTime:boundary*1000,open:current.open,high:current.open,low:current.open,close:current.open,volume:0};
  const side=signal.side==='SHORT'?'SHORT':'LONG',key='bybit_'+info.symbol+'_4H_'+signal.breakoutTime+(side==='SHORT'?'_SHORT':'');
  const t={key,side,symbol:info.symbol,exchange:'bybit',timeframe:'4H',entryTime:boundary,entryPrice:stub.open,status:'OPEN',exitTime:null,tp:stub.open*(side==='SHORT'?.95:1.05),sl:null};
  Object.assign(t,analyzeTrade(past,[stub],0,signal,t));t.benchmarkFeatures=btc;attachConfirmations(t);
  return {...signal,side,entryPrice:t.entryPrice,tp:t.tp,sl:null,entryTime:boundary,entryFeatures:t.entryFeatures,benchmarkFeatures:btc,audit:candidateAudit(t),exclusionGroups:t.exclusionGroups,baseQualified:t.confirmations.dualPeriodBase===true,qualified:t.confirmations.dualPeriodBoth===true,strategyVersion:MODEL_VERSION,tradeKey:key,uniqueId:MODEL_VERSION+'_'+key,isRetest:false,firstDetectedAt:boundary*1000,deadline:(boundary+7*86400)*1000,currentPrice:current.close,klines:[...past,current]};
}
export function signalRecord(s,now=Date.now()){
 if(s.strategyVersion!==MODEL_VERSION||!s.qualified)return null;
 return {strategyVersion:MODEL_VERSION,key:s.uniqueId,notificationKey:s.uniqueId+'_initial',tradeKey:s.tradeKey,symbol:s.symbol,side:s.side,exchange:'bybit',timeframe:'4H',signalAt:s.entryTime*1000,confirmationAt:s.breakoutConfirmedAt*1000,registeredAt:now,entry:s.entryPrice,tp:s.tp,deadline:s.deadline,status:'OPEN',portfolioPending:true,portfolioAccepted:false,targetAt:null,lastCheckedAt:now,lastPrice:s.currentPrice,coverageGap:false,range20Pct:s.entryFeatures.range20Pct,entryFeatures:s.entryFeatures,benchmarkFeatures:s.benchmarkFeatures,majorTouchCount:s.majorTouchCount,breakoutTime:s.breakoutTime,breakoutPrice:s.breakoutPrice,confirmationPrice:s.confirmationPrice,trendAgeDays:s.trendAgeDays,trendAgeBars:s.trendAgeBars,touches:s.touches,startPrice:s.startPrice,logScale:s.logScale};
}
export function batchCandidates(candidates,now=Date.now()){
 return candidates.slice().sort((a,b)=>a.entryTime-b.entryTime||compareEntryPriority(a,b)).map((s,priorityRank)=>({priorityRank,key:s.uniqueId,qualified:!!s.qualified,entryTime:s.entryTime,range20Pct:s.entryFeatures.range20Pct,symbol:s.symbol,side:s.side,row:signalRecord(s,now)}));
}
export async function scanCurrent({symbols,request,cancel=()=>false,paused=()=>false,progress=()=>{},onSignal=async()=>{},now,detect=historicalBothDetect}){
 const read=async url=>{let last;for(let i=0;i<2;i++){if(cancel())throw Error('Cancelled');while(paused()&&!cancel())await new Promise(r=>setTimeout(r,200));if(cancel())throw Error('Cancelled');try{const r=await request(url);if(!r.ok)throw Error(r.error||'HTTP '+r.status);const d=JSON.parse(r.text);if(Number(d.retCode)!==0)throw Error(d.retMsg||'Bybit error');return d;}catch(e){last=e;}}throw last;};
 const bars=async(symbol,limit)=>{const d=await read('https://api.bybit.com/v5/market/kline?category=linear&symbol='+encodeURIComponent(symbol)+'&interval=240&limit='+limit);if(!Array.isArray(d.result?.list))throw Error('Missing candle list');return {serverTime:Number(d.time),candles:d.result.list.map(r=>({time:Number(r[0])/1000,rawTime:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])})).sort((a,b)=>a.time-b.time)};};
 const btcReply=await bars('BTCUSDT',500),phoneNow=Date.now()/1000,serverNow=Number.isFinite(btcReply.serverTime)&&btcReply.serverTime>1e12?btcReply.serverTime/1000:null,scanNow=Number.isFinite(now)?now:(serverNow??phoneNow),btc=btcReply.candles;const diagnostics={clockSource:Number.isFinite(now)?'explicit':serverNow?'exchange':'phone',clockSkewSeconds:serverNow===null?null:Math.round(phoneNow-serverNow),referenceAt:Math.floor(scanNow/H)*H*1000,checked:0,noPattern:0,rawCandidates:0,longCandidates:0,shortCandidates:0,basePassed:0,baseRejected:0,x10Blocked:0,qualified:0,candidateDetails:[],exclusionHits:Array(10).fill(0)};let next=0,tested=0;const candidates=[],errors=[],insufficient=[],signals=[];
 const worker=async()=>{while(next<symbols.length&&!cancel()){const s=symbols[next++];try{const reply=await bars(s.symbol,500),cs=reply.candles;const observedNow=Number.isFinite(now)?now*1000:reply.serverTime;const found=liveCandidates(cs,s,btc,scanNow,detect);for(const c of found.filter(c=>c.qualified)){await onSignal(c,observedNow);}diagnostics.checked++;if(!found.length)diagnostics.noPattern++;for(const c of found){diagnostics.candidateDetails.push({symbol:c.symbol,side:c.side,audit:c.audit});diagnostics.rawCandidates++;diagnostics[c.side==='SHORT'?'shortCandidates':'longCandidates']++;if(c.baseQualified){diagnostics.basePassed++;if(c.qualified)diagnostics.qualified++;else{diagnostics.x10Blocked++;for(const group of c.exclusionGroups||[])if(group>=1&&group<=10)diagnostics.exclusionHits[group-1]++;}}else diagnostics.baseRejected++;}candidates.push(...found);signals.push(...found.filter(x=>x.qualified));}catch(e){(e.code==='INSUFFICIENT_HISTORY'?insufficient:errors).push(s.symbol+': '+e.message);}tested++;progress({tested,total:symbols.length,signals:signals.length,errors:errors.length,insufficient:insufficient.length,symbol:s.symbol,diagnostics:{...diagnostics,candidateDetails:diagnostics.candidateDetails.slice(),exclusionHits:diagnostics.exclusionHits.slice()}});await new Promise(r=>setTimeout(r,0));}};
 await Promise.all(Array.from({length:6},worker));return {candidates,signals,tested,total:symbols.length,errors,insufficient,diagnostics,cancelled:cancel()};
}
