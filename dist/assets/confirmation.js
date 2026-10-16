import {attachStochConfirmation} from './stoch-strategy.js';
export const CONFIRMATION_MODES=['baseline','coinTrend','high10','btc4h','macd','ma50Macd','ma50RangeTouches','ma50RangeTouchesVolume','btcTrendCoin200','momentumWick','momentumWickBoth','dualPeriodBoth'];
export function attachConfirmations(trade){
 const f=trade.entryFeatures||{},b=trade.benchmarkFeatures||{},past=trade.context?.before||[];
 const previousHigh=past.length>=11?Math.max(...past.slice(-11,-1).map(c=>c[2])):null,last=past.at(-1);
 const number=v=>typeof v==='number'&&Number.isFinite(v);
 trade.entryMode='baseline';
 trade.confirmations={coinTrend:typeof f.closeAboveSma50==='boolean'&&number(f.sma50Slope5Pct)?f.closeAboveSma50&&f.sma50Slope5Pct>0:null,high10:previousHigh!==null&&last?last[4]>previousHigh:null,btc4h:number(b.return4hPct)?b.return4hPct>0:null};
 trade.confirmations.macd=number(f.macdLine)&&number(f.macdSignal)?f.macdLine>f.macdSignal:null;trade.confirmations.ma50Macd=trade.confirmations.coinTrend===null||trade.confirmations.macd===null?null:trade.confirmations.coinTrend&&trade.confirmations.macd;
 trade.confirmations.ma50RangeTouches=trade.confirmations.coinTrend===null||!number(f.range20Pct)||!number(f.touchCount)?null:trade.confirmations.coinTrend&&f.range20Pct>=10&&f.touchCount>=4;
 trade.confirmations.ma50RangeTouchesVolume=trade.confirmations.ma50RangeTouches===null||!number(f.volumeRatio20)?null:trade.confirmations.ma50RangeTouches&&f.volumeRatio20>=1.5;
 trade.confirmations.btcTrendCoin200=trade.confirmations.ma50RangeTouchesVolume===null||typeof b.closeAboveSma50!=='boolean'||!number(b.sma50Slope5Pct)||typeof f.closeAboveSma200!=='boolean'||!number(b.referenceClosedAt)||!number(f.referenceClosedAt)?null:trade.confirmations.ma50RangeTouchesVolume===true&&b.closeAboveSma50===true&&b.sma50Slope5Pct>0&&f.closeAboveSma200===true&&b.referenceClosedAt<=trade.entryTime&&f.referenceClosedAt<=trade.entryTime;
 trade.confirmations.momentumWick=trade.confirmations.btcTrendCoin200===null||!number(f.return24hPct)||!number(f.upperWickFraction)?null:trade.confirmations.btcTrendCoin200===true&&f.return24hPct>=10&&f.upperWickFraction>=0&&f.upperWickFraction<=.25;
 const shortValues=[f.closeDistanceSma50Pct,f.sma50Slope5Pct,f.closeDistanceSma200Pct,f.range20Pct,f.touchCount,f.volumeRatio20,f.return24hPct,f.lowerWickFraction,b.closeDistanceSma50Pct,b.sma50Slope5Pct,f.referenceClosedAt,b.referenceClosedAt];
 trade.confirmations.momentumWickShort=shortValues.every(number)?f.closeDistanceSma50Pct<0&&f.sma50Slope5Pct<0&&f.closeDistanceSma200Pct<0&&f.range20Pct>=10&&f.touchCount>=4&&f.volumeRatio20>=1.5&&f.return24hPct<=-10&&f.lowerWickFraction>=0&&f.lowerWickFraction<=.25&&b.closeDistanceSma50Pct<0&&b.sma50Slope5Pct<0&&f.referenceClosedAt<=trade.entryTime&&b.referenceClosedAt<=trade.entryTime:null;
 trade.confirmations.momentumWickBoth=trade.side==='SHORT'?trade.confirmations.momentumWickShort:trade.confirmations.momentumWick;
 trade.confirmationFeatures={previous10High:previousHigh};return attachStochConfirmation(trade);
}
export function selectConfirmed(trades,mode='baseline'){if(!CONFIRMATION_MODES.includes(mode))throw Error('Unknown confirmation mode');return mode==='baseline'?trades:trades.filter(t=>t.confirmations?.[mode]===true);}
