// Input contains closed candles only. The forming candle must be excluded.
export function ma50Confirmation(closed){
 if(!closed||closed.length<55)return null;
 const values=closed.map(c=>c.close);
 if(values.some(v=>!Number.isFinite(v)||v<=0))return null;
 const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
 const current=mean(values.slice(-50)),previous=mean(values.slice(-55,-5));
 const recent=closed.slice(-20),range20Pct=(Math.max(...recent.map(c=>c.high))/Math.min(...recent.map(c=>c.low))-1)*100;
 const previousVolumes=closed.slice(-21,-1).map(c=>c.volume),averageVolume=mean(previousVolumes);
 const volumeRatio20=previousVolumes.length===20&&Number.isFinite(averageVolume)&&averageVolume>0&&Number.isFinite(closed.at(-1).volume)?closed.at(-1).volume/averageVolume:null;
 return {volumeRatio20,range20Pct,pass:values.at(-1)>current&&current>previous,ma50:current,previousMa50:previous,closedAt:closed.at(-1).time};
}
