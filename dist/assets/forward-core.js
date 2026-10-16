import {isTrackedStrategy} from './strategy-identity.js';
import {MODEL_VERSION,signalRecord} from './live-strategy.js';
export {MODEL_VERSION};
export function forwardSignal(s,now=Date.now()){return signalRecord(s,now);}
export function forwardCheck(row,bars,now=Date.now(),minuteBars=[]){
 if(!isTrackedStrategy(row.strategyVersion)||row.status!=='OPEN')return null;
 const short=row.side==='SHORT',sign=short?-1:1,H=14400,reg=row.registeredAt/1000,deadline=row.deadline/1000;
 const start=Math.ceil(reg/60)*60,cs=bars.filter(c=>c.time+H<=now/1000&&c.time>=row.signalAt/1000&&c.time<deadline).sort((a,b)=>a.time-b.time),mins=minuteBars.filter(c=>c.time>=start&&c.time+60<=now/1000&&c.time<deadline).sort((a,b)=>a.time-b.time);
 const hit=c=>short?c.low<=row.tp:c.high>=row.tp,opening=c=>short?c.open<=row.tp:c.open>=row.tp;
 const hits=[];
 for(const c of cs)if(c.time>=reg&&hit(c))hits.push({at:opening(c)?c.time:c.time+H,price:opening(c)?c.open:row.tp,free:opening(c)?c.time:c.time+H,kind:'4h'});
 for(const c of mins)if(hit(c)){const gap=opening(c)&&c.time%H===0;hits.push({at:gap?c.time:c.time+60,price:gap?c.open:row.tp,free:gap?c.time:Math.floor(c.time/H)*H+H,kind:'minute'});break;}
 hits.sort((a,b)=>a.at-b.at);const last=bars.at(-1),update={key:row.key,lastCheckedAt:now,lastPrice:last?.close??row.lastPrice,coverageGap:!!row.coverageGap};
 // Missing evidence never becomes a loss or a fabricated TP.
 const firstClosed=Math.ceil(reg/H)*H,needed=Math.max(firstClosed,row.signalAt/1000);let prior=needed-H,complete=true;
 for(const c of cs.filter(c=>c.time>=needed)){if(c.time!==prior+H){update.coverageGap=true;complete=false;}prior=c.time;}
 const partialEnd=(Math.floor(reg/H)+1)*H;if(reg%H!==0&&Math.min(Math.floor(now/60000)*60,partialEnd)>start){const first=mins.filter(c=>c.time<partialEnd);if(!first.length||first[0].time>start||first.at(-1).time+60<Math.min(Math.floor(now/60000)*60,partialEnd)){update.coverageGap=true;complete=false;}for(let i=1;i<first.length;i++)if(first[i].time!==first[i-1].time+60){update.coverageGap=true;complete=false;}}
 if(hits.length){const h=hits[0];return {...update,status:'TP',targetAt:h.at*1000,targetKind:h.kind,exitPrice:h.price,exitAt:h.at*1000,freeAt:h.free*1000,returnPct:sign*(h.price/row.entry-1)*100};}
 if(now/1000>=deadline){const final=cs.find(c=>c.time+H===deadline);if(final&&complete&&prior+H>=deadline)return {...update,status:'TIMEOUT',exitAt:row.deadline,freeAt:row.deadline,exitPrice:final.close,returnPct:sign*(final.close/row.entry-1)*100};return {...update,status:'OPEN',coverageGap:true,error:'Deadline candles missing; exit cannot be verified'};}
 return {...update,status:'OPEN'};
}
