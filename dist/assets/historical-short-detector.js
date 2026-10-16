import {historicalDetect} from './historical-detector.js';
const period=tf=>tf==='1H'||tf==='4H'?8:tf==='1D'||tf==='3D'?6:4;
const minBars={'1H':70,'4H':70,'1D':45,'3D':30,'1W':20,'1M':10};
const minDays={'1H':4.5,'4H':18,'1D':60,'3D':120,'1W':180,'1M':365};
function atr(bars,n=14){const tr=bars.map((b,i)=>i?Math.max(b.high-b.low,Math.abs(b.high-bars[i-1].close),Math.abs(b.low-bars[i-1].close)):b.high-b.low);let sum=tr.slice(0,Math.min(n,bars.length)).reduce((a,b)=>a+b,0);const seed=sum/Math.min(n,bars.length);return tr.map((v,i)=>{if(i<n)return seed;sum+=v-tr[i-n];return sum/n;});}
function end(b,tf){if(tf==='1M'){const d=new Date(b.time*1000);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000;}return b.time+({'1H':3600,'4H':14400,'1D':86400,'3D':259200,'1W':604800}[tf]);}
function pivotLows(bars,tf,a){const r=period(tf),out=[];for(let i=r;i<bars.length-r;i++){let low=bars[i].low,ok=true;for(let k=1;k<=r;k++)if(bars[i-k].low<low||bars[i+k].low<low){ok=false;break;}if(!ok)continue;let high=low;for(let k=-r;k<=r;k++)high=Math.max(high,bars[i+k].high);const prominence=high-low;if(prominence>=1.8*(a[i]||bars[i].close*.03))out.push({index:i,time:bars[i].time,low,prominence});}return out;}
export function historicalShortDetect(bars,symbol,tf,volume24hUsd=0,change24h=0,exchange='bybit',now=Date.now()/1000){
 const r=period(tf),n=bars?.length||0;if(n<Math.max(minBars[tf]+2,2*(r+1)+2))return null;
 const a=atr(bars);let last=n-1;while(last>=0&&end(bars[last],tf)>now)last--;if(last<2)return null;
 const pivots=pivotLows(bars.slice(0,last+1),tf,a);if(pivots.length<2)return null;
 const floor=Math.min(...bars.map(b=>b.low));let best=null,bestScore=-Infinity;
 for(let current=Math.max(1,n-3);current<=last;current++){
  const previous=current-1,c=bars[current],p=bars[previous],at=a[current]||c.close*.03,tolerance=Math.max(.18*at,c.close*.0035);
  for(let x=0;x<pivots.length;x++){
   const start=pivots[x];if(!(start.low<=floor/.78||pivots.filter(v=>v.low<start.low).length<=2))continue;
   const age=current-start.index;if(age<minBars[tf]||Math.round((c.time-start.time)/86400)<minDays[tf])continue;
   for(let y=x+1;y<pivots.length;y++)for(const logarithmic of [false,true]){
    const anchor=pivots[y],span=anchor.index-start.index;
    if(anchor.index>=previous-6||anchor.low<=start.low||span<r+1)continue;
    const slope=logarithmic?Math.log(anchor.low/start.low)/span:(anchor.low-start.low)/span;if(slope<=0)continue;
    const line=i=>logarithmic?start.low*Math.exp(slope*(i-start.index)):start.low+slope*(i-start.index);
    const value=line(current),prev=line(previous);if(value<=0||prev<=0)continue;
    const breakout=p.close>=prev&&c.close<value-tolerance;
    const previousAtr=a[previous]||p.close*.03;
    const retest=!breakout&&bars[previous-1].close>=line(previous-1)&&p.close<prev-Math.max(.18*previousAtr,p.close*.0035)&&c.high>=value-.15*at&&c.low<=value&&c.close<=value&&c.close<=c.open;
    if(!breakout&&!retest)continue;
    const signalIndex=retest?previous:current;if(n-signalIndex>3)continue;
    const currentLine=line(n-1);if(currentLine<=0)continue;
    const distance=(currentLine-bars[n-1].close)/currentLine,maxDistance=Math.max(.03,.5*(a[last]||0)/currentLine);
    if(distance<-1e-10||distance>maxDistance+1e-10)continue;
    let invalid=bars[n-1].close>currentLine,lastRetest;
    for(let j=signalIndex+1;j<=last;j++){const b=bars[j],v=line(j);if(b.close>v){invalid=true;break;}if(b.high>=v-.15*a[j]&&b.low<=v&&b.close<=b.open)lastRetest=j;}
    if(invalid)continue;
    const before=signalIndex-1;let crossed=false;for(let j=start.index;j<=before;j++)if(bars[j].close<line(j)){crossed=true;break;}if(crossed)continue;
    // Reject a minor breakdown while an older, lower rising support remains intact.
    let hiddenSupport=false;
    for(let j=0;j<pivots.length&&!hiddenSupport;j++){
     const root=pivots[j];if(root.low>=start.low/1.05||root.index>=current-20)continue;
     for(let k=j+1;k<pivots.length;k++){
      const tip=pivots[k],length=tip.index-root.index;if(tip.low<=root.low||tip.index>=previous||length<10)continue;
      const m=(tip.low-root.low)/length;if(root.low+m*(current-root.index)>=c.close)continue;
      let breaches=0;for(let q=root.index;q<=current;q++)if(bars[q].close<root.low+m*(q-root.index))breaches++;
      if(breaches===0){hiddenSupport=true;break;}
     }
    }
    if(hiddenSupport)continue;
    const contacts=[];
    for(let j=start.index;j<=before;j++){
     const v=line(j),b=bars[j],atj=a[j]||b.close*.03;
     if(!(b.low<=v||Math.abs(b.low-v)<=Math.max(.15*atj,v*.003))||b.close<v)continue;
     let rebound=0;for(let k=j+1;k<=Math.min(before,j+8);k++)rebound=Math.max(rebound,(bars[k].high-b.low)/b.low);
     if(rebound>=.025||rebound*b.low>=1.5*atj||j>=before-2)contacts.push({index:j,time:b.time,low:b.low,price:v,rejectionPct:rebound*100});
    }
    const touches=[];let cluster=[];
    const flush=()=>{if(!cluster.length)return;const low=cluster.reduce((a,b)=>a.low<=b.low?a:b);touches.push({index:low.index,time:low.time,dateStr:String(low.time),price:low.price,candleLow:low.low,rejectionPct:low.rejectionPct});cluster=[];};
    for(const touch of contacts){if(cluster.length&&touch.index-cluster[0].index>r)flush();cluster.push(touch);}flush();
    if(touches.length<3||touches.some((v,i)=>i>0&&v.candleLow<=touches[i-1].candleLow))continue;
    let gap=0;for(let j=1;j<touches.length;j++)gap=Math.max(gap,touches[j].index-touches[j-1].index);if(gap>age*.72)continue;
    const mean=bars.slice(Math.max(0,signalIndex-20),signalIndex).reduce((s,b)=>s+b.volume,0)/Math.min(20,signalIndex)||1;
    const volumeRatio=bars[signalIndex].volume/mean,isHighVolume=volumeRatio>=1.5,rise=(value-start.low)/start.low;
    const score=touches.length*20+rise*100+(isHighVolume?15:0)+(retest?25:0);
    const preferred=!best||start.low<best.startPrice||start.low===best.startPrice&&(anchor.low<best.lineFormula(anchor.index)-1e-9||Math.abs(anchor.low-best.lineFormula(anchor.index))<=1e-9&&score>bestScore);
    if(!preferred)continue;
    const isRetest=lastRetest!==undefined,name=isRetest?'YÜKSELEN TREND · SHORT RETEST':isHighVolume?'HACİMLİ YÜKSELEN TREND KIRILIMI · SHORT':'YÜKSELEN TREND KIRILIMI · SHORT';
    bestScore=score;best={side:'SHORT',symbol,exchange,timeframe:tf,signalName:name,signalType:name,trendAgeDays:Math.round((bars[signalIndex].time-start.time)/86400),trendAgeBars:signalIndex-start.index,majorTouchCount:touches.length,breakoutPrice:line(signalIndex),confirmationPrice:bars[signalIndex].close,breakoutConfirmedAt:end(bars[signalIndex],tf),retestTime:isRetest?end(bars[lastRetest],tf):undefined,currentPrice:bars[n-1].close,breakoutTime:bars[signalIndex].time,breakoutTimeStr:String(end(bars[signalIndex],tf)),trendlinePriceAtBreakout:line(signalIndex),startPrice:start.low,startDateStr:String(start.time),touches,klines:bars,lineFormula:line,volume24hUsd,change24h,volumeRatio,isHighVolume,isRetest,uniqueId:`${exchange}_${symbol}_${tf}_SHORT_${touches.map(t=>t.time).join('_')}_${bars[signalIndex].time}`,logScale:logarithmic};
   }
  }
 }
 return best;
}
export function historicalBothDetect(...args){const long=historicalDetect(...args),short=historicalShortDetect(...args);return [long?{...long,side:'LONG'}:null,short].filter(Boolean);}
