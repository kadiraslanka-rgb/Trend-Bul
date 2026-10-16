import {matchingExclusions,EXCLUSION_TEXT} from './x10-exclusions.js';
// Fast Stochastic %K(14), unsmoothed, from closed candles only.
export function stochasticK(candles){
 if(candles.length<14)return null;
 const rows=candles.slice(-14);
 const val=(c,k,i)=>Array.isArray(c)?c[i]:c[k];
 for(let i=0;i<rows.length;i++){
  const c=rows[i],high=val(c,'high',2),low=val(c,'low',3),close=val(c,'close',4),time=val(c,'time',0);
  if(![high,low,close,time].every(Number.isFinite)||high<low||close<low||close>high)return null;
  if(i&&time!==val(rows[i-1],'time',0)+14400)return null;
 }
 const high=Math.max(...rows.map(c=>val(c,'high',2))),low=Math.min(...rows.map(c=>val(c,'low',3))),close=val(rows.at(-1),'close',4);
 return high===low?50:100*(close-low)/(high-low);
}
export const BRANCHES={"LONG":[["atr<=5","btc200>=0","btc7d>=3","cmf>=0","mfi>=50","roc24h>=8","stoch<=98","stochSlow<=95"],["btcSlope>=0.5","roc24h>=15"]],"SHORT":[["age<=75","bbPos>=1","range>=20","roc7d>=5","stoch<=98"],["bbPos>=1","range>=20","roc7d>=5","rsi<=75","stoch<=98"],["bbWidth>=20","rsi<=70"],["btc7d>=5","closePos>=0.85"],["age<=30","rsi>=70"],["roc24h>=10","stoch<=90"],["bbWidth>=20","wick<=0.2"]]};
export const BASE_RULE_TEXT="Common: original directional trend break; directional SMA50 distance>0 and slope5>0; touches>=4; range20>=10; volumeRatio20>=1.5. Directional normalization: signed features multiply by -1 for SHORT, RSI/Stoch/MFI=100-raw, BB position=1-raw, SHORT wick=lower wick, SHORT closePos=1-raw. Any branch for the trade side suffices: {\"LONG\":[[\"atr<=5\",\"btc200>=0\",\"btc7d>=3\",\"cmf>=0\",\"mfi>=50\",\"roc24h>=8\",\"stoch<=98\",\"stochSlow<=95\"],[\"btcSlope>=0.5\",\"roc24h>=15\"]],\"SHORT\":[[\"age<=75\",\"bbPos>=1\",\"range>=20\",\"roc7d>=5\",\"stoch<=98\"],[\"bbPos>=1\",\"range>=20\",\"roc7d>=5\",\"rsi<=75\",\"stoch<=98\"],[\"bbWidth>=20\",\"rsi<=70\"],[\"btc7d>=5\",\"closePos>=0.85\"],[\"age<=30\",\"rsi>=70\"],[\"roc24h>=10\",\"stoch<=90\"],[\"bbWidth>=20\",\"wick<=0.2\"]]}. Same-time priority: range20Pct ascending, then symbol, then side. TP5, noSL, max168h. Selected using both 2025 and 2026 historical outcomes; not independent validation.";
export const RULE_TEXT=BASE_RULE_TEXT+' '+EXCLUSION_TEXT;
export function normalizedFeatures(t){
 const f=t.entryFeatures||{},b=t.benchmarkFeatures||{},short=t.side==='SHORT',s=short?-1:1,n=Number.isFinite;
 const rows=t.context?.before||[],last=rows.at(-1),val=(c,i,k)=>Array.isArray(c)?c[i]:c[k];
 if(rows.length<20||!n(f.referenceClosedAt)||f.referenceClosedAt>t.entryTime||!last||val(last,0,'time')+14400>t.entryTime)return null;
 const window=rows.slice(-20);for(let i=0;i<window.length;i++){
  const r=window[i],time=val(r,0,'time'),h=val(r,2,'high'),l=val(r,3,'low'),c=val(r,4,'close'),v=val(r,5,'volume');
  if(![time,h,l,c,v].every(n)||h<l||c<l||c>h||v<0||(i&&time!==val(window[i-1],0,'time')+14400))return null;
 }
 const k=stochasticK(rows),ks=[0,1,2].map(j=>stochasticK(j?rows.slice(0,-j):rows));if(!ks.every(n))return null;
 const norm=x=>n(x)?short?100-x:x:null,signed=x=>n(x)?s*x:null;
 const typ=window.map(r=>(val(r,2,'high')+val(r,3,'low')+val(r,4,'close'))/3),vol=window.map(r=>val(r,5,'volume'));let pos=0,neg=0;
 for(let j=6;j<20;j++){if(typ[j]>typ[j-1])pos+=typ[j]*vol[j];else if(typ[j]<typ[j-1])neg+=typ[j]*vol[j];}
 const mfi=pos+neg?100*pos/(pos+neg):50,total=vol.reduce((a,x)=>a+x,0),cmf=total?window.reduce((a,r,i)=>{const h=val(r,2,'high'),l=val(r,3,'low'),c=val(r,4,'close');return a+(h>l?(2*c-h-l)/(h-l):0)*vol[i];},0)/total:0;
 const slow=ks.reduce((a,x)=>a+x,0)/3;
 f.stochastic14K=k;f.directionalStochastic14K=norm(k);f.stochasticSlowK=slow;f.moneyFlowIndex14=mfi;f.chaikinMoneyFlow20=cmf;t.entryFeatures=f;
 const btcKnown=n(b.referenceClosedAt)&&b.referenceClosedAt<=t.entryTime;
 return {atr:f.atrPct,btc200:btcKnown?signed(b.closeDistanceSma200Pct):null,btc7d:btcKnown?signed(b.return7dPct):null,btcSlope:btcKnown?signed(b.sma50Slope5Pct):null,cmf:s*cmf,mfi:norm(mfi),roc24h:signed(f.return24hPct),roc7d:signed(f.return7dPct),stoch:norm(k),stochSlow:norm(slow),age:f.trendAgeDays,bbPos:n(f.bollingerPosition)?short?1-f.bollingerPosition:f.bollingerPosition:null,range:f.range20Pct,rsi:norm(f.rsi14),bbWidth:f.bollingerWidthPct,closePos:n(f.closePosition)?short?1-f.closePosition:f.closePosition:null,wick:short?f.lowerWickFraction:f.upperWickFraction};
}
export function attachStochConfirmation(t){
 const f=t.entryFeatures||{},short=t.side==='SHORT',s=short?-1:1,x=normalizedFeatures(t);
 const values=[f.closeDistanceSma50Pct,f.sma50Slope5Pct,f.range20Pct,f.touchCount,f.volumeRatio20];
 if(!x||!values.every(Number.isFinite)){t.confirmations.dualPeriodBoth=null;return t;}
 const base=s*f.closeDistanceSma50Pct>0&&s*f.sma50Slope5Pct>0&&f.range20Pct>=10&&f.touchCount>=4&&f.volumeRatio20>=1.5;
 const match=condition=>{const [,key,op,threshold]=condition.match(/^([a-zA-Z0-9]+)(>=|<=)(-?[0-9.]+)$/),v=x[key];return Number.isFinite(v)&&(op==='>='?v>=Number(threshold):v<=Number(threshold));};
 t.confirmations.dualPeriodBase=base&&BRANCHES[short?'SHORT':'LONG'].some(branch=>branch.every(match));t.exclusionGroups=matchingExclusions(t);t.confirmations.dualPeriodBoth=t.confirmations.dualPeriodBase&&t.exclusionGroups.length===0;return t;
}
export function compareEntryPriority(a,b){
 const range=t=>Number.isFinite(t.entryFeatures?.range20Pct)?t.entryFeatures.range20Pct:Infinity,x=range(a),y=range(b);
 return (x===y?0:x<y?-1:1)||a.symbol.localeCompare(b.symbol)||(a.side||'LONG').localeCompare(b.side||'LONG');
}
