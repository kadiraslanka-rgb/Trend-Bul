// Research candidates are kept separate from the selected strategy and portfolio.
export function makeResearchExport(trades){
 return {
  version:1,
  scope:'All original trend-detector candidates before additional MA, BTC, momentum, wick and volume confirmation filters; not every market candle.',
  activeRule:'dualPeriodBoth',
  candidateCount:trades.length,
  longCandidates:trades.filter(t=>t.side!=='SHORT').length,
  shortCandidates:trades.filter(t=>t.side==='SHORT').length,
  acceptedCount:trades.filter(t=>t.confirmations?.dualPeriodBoth===true).length,
  contextRule:'Last 20 pre-entry bars and first 43 post-entry bars; precomputed indicators use full closed history. Future outcome/context must not be used as entry filters.',
  trades:trades.map(({context,...trade})=>({...trade,
   acceptedByActiveRule:trade.confirmations?.dualPeriodBoth===true,exclusionGroups:trade.exclusionGroups||[],acceptedBeforeX10:trade.confirmations?.dualPeriodBase===true,
   context:context?{columns:context.columns,before:(context.before||[]).slice(-20),after:(context.after||[]).slice(0,43)}:null
  }))
 };
}
