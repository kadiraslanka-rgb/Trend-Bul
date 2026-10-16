import {normalizedFeatures,BRANCHES} from './stoch-strategy.js';
const names={ma:['Yönsel MA50 uzaklığı (%)','Directional MA50 distance (%)'],slope:['Yönsel MA50 eğimi (%)','Directional MA50 slope (%)'],range:['20 mum fiyat aralığı (%)','20-candle range (%)'],touches:['Temas sayısı','Touches'],vol:['Hacim katı','Volume ratio'],atr:['ATR (%)','ATR (%)'],btc200:['Yönsel BTC MA200 uzaklığı (%)','Directional BTC MA200 distance (%)'],btc7d:['Yönsel BTC 7 gün getirisi (%)','Directional BTC 7-day return (%)'],btcSlope:['Yönsel BTC MA50 eğimi (%)','Directional BTC MA50 slope (%)'],cmf:['Yönsel CMF','Directional CMF'],mfi:['Yönsel MFI','Directional MFI'],roc24h:['Yönsel 24 saat getirisi (%)','Directional 24-hour return (%)'],roc7d:['Yönsel 7 gün getirisi (%)','Directional 7-day return (%)'],stoch:['Yönsel Stoch K','Directional Stoch K'],stochSlow:['Yönsel yavaş Stoch K','Directional slow Stoch K'],age:['Trend yaşı (gün)','Trend age (days)'],bbPos:['Yönsel Bollinger konumu','Directional Bollinger position'],rsi:['Yönsel RSI','Directional RSI'],bbWidth:['Bollinger genişliği (%)','Bollinger width (%)'],closePos:['Yönsel mum kapanış konumu','Directional candle close position'],wick:['Yönsel fitil oranı','Directional wick fraction']};
function check(key,value,op,threshold){return {key,value:Number.isFinite(value)?value:null,op,threshold,passed:Number.isFinite(value)&&(op==='>'?value>threshold:op==='>='?value>=threshold:value<=threshold)};}
export function candidateAudit(t){
 const f=t.entryFeatures||{},sign=t.side==='SHORT'?-1:1,x=normalizedFeatures(t),signed=v=>Number.isFinite(v)?sign*v:null;
 const common=[check('ma',signed(f.closeDistanceSma50Pct),'>',0),check('slope',signed(f.sma50Slope5Pct),'>',0),check('range',f.range20Pct,'>=',10),check('touches',f.touchCount,'>=',4),check('vol',f.volumeRatio20,'>=',1.5)];
 const branches=BRANCHES[t.side==='SHORT'?'SHORT':'LONG'].map(branch=>branch.map(condition=>{const [,key,op,n]=condition.match(/^([a-zA-Z0-9]+)(>=|<=)(-?[0-9.]+)$/);return check(key,x?.[key],op,Number(n));}));
 return {dataValid:!!x,common,branches,exclusionGroups:t.exclusionGroups||[],stage:t.confirmations.dualPeriodBase===true?(t.confirmations.dualPeriodBoth===true?'qualified':'x10'):'base'};
}
export function auditText(a,en=false){
 if(!a)return en?'Details were not saved; run a new scan.':'Ayrıntı kaydedilmemiş; yeni tarama yap.';
 const n=v=>v===null?(en?'missing':'eksik'):Number(v.toFixed(4)).toLocaleString(en?'en-US':'tr-TR',{maximumFractionDigits:4});
 const text=c=>(names[c.key]?.[en?1:0]||c.key)+': '+n(c.value)+' ('+(en?'required ':'gerekli ')+c.op+' '+n(c.threshold)+')';
 const out=[];
 if(!a.dataValid)out.push(en?'Closed-candle indicator data is missing or invalid.':'Kapanmış mum gösterge verisi eksik veya geçersiz.');
 const failed=a.common.filter(c=>!c.passed);if(failed.length)out.push((en?'Common conditions failed: ':'Geçmeyen ortak şartlar: ')+failed.map(text).join(' · '));
 if(!a.branches.some(b=>b.every(c=>c.passed))){out.push(en?'At least one momentum branch must pass in full. Failed checks by branch:':'Momentum kollarından en az birinin tüm şartları geçmeli. Kollardaki başarısız şartlar:');a.branches.forEach((b,i)=>out.push((en?'Branch ':'Kol ')+(i+1)+': '+b.filter(c=>!c.passed).map(text).join(' · ')));}
 if(a.stage==='x10')out.push((en?'Excluded by X10 group(s): ':'Eleyen X10 grupları: ')+a.exclusionGroups.join(', '));
 if(a.stage==='qualified')out.push(en?'All entry conditions passed.':'Tüm giriş şartları sağlandı.');
 return out.join('\n');
}
