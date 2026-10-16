import {compareEntryPriority} from './stoch-strategy.js';
import {analyzeTrade} from './trade-analysis.js';
export const FRAMES=['4H'];
export {MODEL_VERSION} from './strategy-identity.js';
export const LOOKBACK=tf=>tf==='1D'?1000:['1H','4H','3D'].includes(tf)?499:200;
export function candleEnd(c,tf){if(tf==='1M'){let d=new Date(c.time*1000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000;}return c.time+({'1H':3600,'4H':14400,'1D':86400,'3D':259200,'1W':604800}[tf]);}
export const MAX_HOLD_SECONDS=7*24*3600;
export function evaluateTrade(candles,index,entry,side='LONG'){
 const direction=side==='SHORT'?-1:1,tp=entry*(1+direction*.05),deadline=candles[index].time+MAX_HOLD_SECONDS;
 const result=(status,price,time,atOpen)=>({status,exitPrice:price,exitTime:time,exitAtOpen:atOpen,returnPct:direction*(price/entry-1)*100,deadline});
 for(let j=index;j<candles.length;j++){
  const c=candles[j];
  if(j>index&&c.time!==candles[j-1].time+14400)throw Error('Missing 4H candles during trade');
  if(c.time>=deadline)return result('TIMEOUT',c.open,deadline,true);
  if(side==='SHORT'){if(c.open<=tp)return result('TP',c.open,c.time,true);if(c.low<=tp)return result('TP',tp,c.time,false);}
  else{if(c.open>=tp)return result('TP',c.open,c.time,true);if(c.high>=tp)return result('TP',tp,c.time,false);}
  if(c.time+14400===deadline)return result('TIMEOUT',c.close,deadline,true);
 }
 return {status:'OPEN',exitPrice:null,exitTime:null,returnPct:null,deadline};
}
export function summarize(trades){let result={signals:trades.length,TP:0,SL:0,TIMEOUT:0,OPEN:0,AMBIGUOUS:0};for(const t of trades)result[t.status]++;result.closed=result.TP+result.SL+result.TIMEOUT;result.winRate=result.signals?result.TP/result.signals*100:null;return result;}
export async function backtestCandles(candles,info,tf,start,end,detect,{cancel=()=>false,progress=()=>{},yieldFn=()=>new Promise(r=>setTimeout(r,0))}={}){
 const trades=[],seen=new Set(),limit=LOOKBACK(tf);let tested=0,lastYield=performance.now();
 for(let i=1;i<candles.length;i++){
  if(cancel())break;
  const current=candles[i];if(current.time<start||current.time>=end)continue;
  const past=candles.slice(Math.max(0,i-limit+1),i),stub={time:current.time,rawTime:current.time*1000,open:current.open,high:current.open,low:current.open,close:current.open,volume:0};
  const detected=detect([...past,stub],info.symbol,tf,0,0,info.exchange,current.time);tested++;
  for(const signal of Array.isArray(detected)?detected:[detected]){
   if(!signal||signal.breakoutConfirmedAt<start)continue;
   const side=signal.side==='SHORT'?'SHORT':'LONG',key=info.exchange+'_'+info.symbol+'_'+tf+'_'+signal.breakoutTime+(side==='SHORT'?'_SHORT':'');
   if(seen.has(key))continue;seen.add(key);const entry=current.open;
   const trade={key,side,symbol:info.symbol,exchange:info.exchange,timeframe:tf,entryTime:current.time,signalTime:signal.breakoutConfirmedAt,entryPrice:entry,tp:entry*(side==='SHORT'?.95:1.05),sl:null,signalName:signal.signalName,retest:signal.isRetest,markPrice:candles.at(-1).close,markTime:candleEnd(candles.at(-1),tf),...evaluateTrade(candles,i,entry,side)};
   Object.assign(trade,analyzeTrade(past,candles,i,signal,trade));trades.push(trade);
  }
  if(performance.now()-lastYield>=40){progress(tested);await yieldFn();lastYield=performance.now();}
 }
 return {trades,tested};
}
export function simulatePortfolio(trades,{initialBalance=500,positionPct=100,feePct=0}={}){
 if(!Number.isFinite(initialBalance)||initialBalance<=0||!Number.isFinite(positionPct)||positionPct<=0||positionPct>100||!Number.isFinite(feePct)||feePct<0||feePct>5)throw Error('Invalid portfolio settings');
 const sorted=trades.filter(t=>t.timeframe==='4H').slice().sort((a,b)=>a.entryTime-b.entryTime||compareEntryPriority(a,b)),ledger=[];let balance=initialBalance,nextEntry=-Infinity,skipped=0,peak=initialBalance,maxDrawdown=0,totalFees=0,assumedStops=0,openTrade=null;
 const feeRate=feePct/100;
 for(const t of sorted){
  if(t.entryTime<nextEntry){skipped++;continue;}
  if(balance<=0){skipped++;continue;}
  if(!Number.isFinite(t.entryPrice)||t.entryPrice<=0)throw Error('Invalid entry price');
  const direction=t.side==='SHORT'?-1:1,before=balance,riskUsd=null,positionUsd=Math.min(before*positionPct/100,before/(1+feeRate)),entryFee=positionUsd*feeRate;
  if(t.status==='OPEN'){
   const mark=Number.isFinite(t.markPrice)&&t.markPrice>=0?t.markPrice:null;
   const unrealized=mark===null?null:positionUsd*direction*(mark/t.entryPrice-1);
   const after=unrealized===null?null:before-entryFee+unrealized;
   totalFees+=entryFee;openTrade={...t,positionUsd,riskUsd,entryFee,unrealized,markKnown:mark!==null};
   ledger.push({...t,riskUsd,positionUsd,fees:entryFee,pnl:unrealized===null?null:unrealized-entryFee,balanceBefore:before,balanceAfter:after});nextEntry=Infinity;continue;
  }
  if(!['TP','TIMEOUT'].includes(t.status))throw Error('Unexpected outcome in 7-day model');let exit=t.exitPrice;
  if(!Number.isFinite(exit)||exit<=0)throw Error('Invalid exit price');
  if(t.status==='AMBIGUOUS')assumedStops++;
  const exitNotional=positionUsd*exit/t.entryPrice,fees=entryFee+exitNotional*feeRate,pnl=positionUsd*direction*(exit/t.entryPrice-1)-fees;
  balance=before+pnl;totalFees+=fees;peak=Math.max(peak,balance);maxDrawdown=Math.max(maxDrawdown,peak>0?(peak-balance)/peak*100:0);
  ledger.push({...t,status:t.status==='AMBIGUOUS'?'SL_ASSUMED':t.status,exitPrice:exit,riskUsd,positionUsd,fees,pnl,balanceBefore:before,balanceAfter:balance});
  nextEntry=t.exitTime+(t.exitAtOpen?0:14400);
 }
 const endingEquity=openTrade?(ledger.at(-1).balanceAfter):balance;
 return {initialBalance,positionPct,riskPct:null,feePct,rr:null,tpPct:5,slPct:null,maxHoldDays:7,closedBalance:balance,endingEquity,netPnl:endingEquity===null?null:endingEquity-initialBalance,returnPct:endingEquity===null?null:(endingEquity/initialBalance-1)*100,maxDrawdown,totalFees,assumedStops,skipped,openTrade,ledger,taken:ledger.length,longTaken:ledger.filter(t=>t.side!=='SHORT').length,shortTaken:ledger.filter(t=>t.side==='SHORT').length,TIMEOUT:ledger.filter(t=>t.status==='TIMEOUT').length,TP:ledger.filter(t=>t.status==='TP').length,SL:ledger.filter(t=>t.status==='SL'||t.status==='SL_ASSUMED').length};
}
