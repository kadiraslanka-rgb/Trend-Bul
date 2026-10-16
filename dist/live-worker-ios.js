(() => {
  // dist/assets/crypto-universe.js
  var NON_CRYPTO = /stock|etf|forex|commodity|equity|index|indices|tradfi|metal|oil/i;
  function isCryptoInstrument(i, exchange) {
    if (exchange !== "bybit") return false;
    if (!i || typeof (i.symbol || i.instId) !== "string") return false;
    const classes = [i.symbolType, i.underlyingType, i.assetType, i.assetClass, i.instrumentType, ...i.underlyingSubType || []].filter((v) => typeof v === "string");
    if (classes.some((v) => NON_CRYPTO.test(v))) return false;
    if (i.marketRegion || i.underlyingTicker) return false;
    if (exchange === "bybit") return i.status === "Trading" && i.contractType === "LinearPerpetual" && i.quoteCoin === "USDT" && i.settleCoin === "USDT" && ["", "innovation"].includes(i.symbolType || "");
    if (exchange === "binance") return i.status === "TRADING" && i.contractType === "PERPETUAL" && i.quoteAsset === "USDT" && i.marginAsset === "USDT" && i.underlyingType === "COIN";
    if (exchange === "okx") return i.state === "live" && i.instType === "SWAP" && i.settleCcy === "USDT";
    return false;
  }
  async function payload(request, url, exchange) {
    const r = await request(url, { timeout: 15e3, exchange });
    if (!r.ok || !r.text) throw Error("Kripto \xFCr\xFCn bilgisi al\u0131namad\u0131 / crypto instrument metadata unavailable");
    let d;
    try {
      d = JSON.parse(r.text);
    } catch {
      throw Error("Ge\xE7ersiz \xFCr\xFCn bilgisi / invalid instrument metadata");
    }
    if (exchange === "bybit" && String(d.retCode) !== "0" || exchange === "okx" && String(d.code) !== "0") throw Error(d.retMsg || d.msg || "Instrument metadata error");
    return d;
  }
  async function cryptoInstrumentMap(request, exchange) {
    if (exchange !== "bybit") throw Error("Only Bybit USDT crypto is supported");
    const result = /* @__PURE__ */ new Map();
    if (exchange === "bybit") {
      let cursor = "", seen = /* @__PURE__ */ new Set();
      do {
        const u = "https://api.bybit.com/v5/market/instruments-info?category=linear&status=Trading&limit=1000" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
        const d = await payload(request, u, exchange);
        if (!Array.isArray(d.result?.list)) throw Error("Missing instrument list");
        for (const i of d.result.list) if (isCryptoInstrument(i, exchange)) result.set(i.symbol, i);
        cursor = d.result.nextPageCursor || "";
        if (cursor && seen.has(cursor)) throw Error("Repeated instrument cursor");
        seen.add(cursor);
      } while (cursor);
    } else if (exchange === "binance") {
      const d = await payload(request, "https://fapi.binance.com/fapi/v1/exchangeInfo", exchange);
      if (!Array.isArray(d.symbols)) throw Error("Missing instrument list");
      for (const i of d.symbols) if (isCryptoInstrument(i, exchange)) result.set(i.symbol, i);
    } else if (exchange === "okx") {
      const d = await payload(request, "https://www.okx.com/api/v5/public/instruments?instType=SWAP", exchange);
      if (!Array.isArray(d.data)) throw Error("Missing instrument list");
      for (const i of d.data) if (isCryptoInstrument(i, exchange)) result.set(i.instId, i);
    } else throw Error("Unknown exchange");
    if (!result.size) throw Error("Kripto \xFCr\xFCn listesi bo\u015F / empty crypto universe");
    return result;
  }

  // dist/assets/x10-exclusions.js
  var EXCLUSION_GROUPS = Object.freeze([{ "side": "SHORT", "conditions": [["rsi", ">=", 70], ["closepos", "<=", 0.1]] }, { "side": "LONG", "conditions": [["atr", ">=", 4], ["bbpos", "<=", 1]] }, { "side": "LONG", "conditions": [["btc50", "<=", 5], ["btc7", ">=", 10]] }, { "side": "SHORT", "conditions": [["range", ">=", 35], ["mfi", "<=", 85], ["wick", "<=", 0.1]] }, { "side": "LONG", "conditions": [["vol", "<=", 4.5], ["btc7", "<=", 5], ["entryTrend", ">=", 2.5]] }, { "side": "LONG", "conditions": [["atr", "<=", 2.5], ["vol", "<=", 3], ["btc200", "<=", 7.5]] }, { "side": "SHORT", "conditions": [["atr", "<=", 4], ["vol", "<=", 2], ["slope", ">=", 2]] }, { "side": "SHORT", "conditions": [["atr", "<=", 4], ["rsi", ">=", 75], ["cmf", "<=", 0]] }, { "side": "SHORT", "conditions": [["range", ">=", 25], ["stoch", ">=", 95], ["bbwidth", "<=", 20]] }, { "side": "SHORT", "conditions": [["vol", ">=", 3], ["slope", ">=", 1], ["entryTrend", "<=", 1.5]] }]);
  var EXCLUSION_TEXT = "Experimental X10 exclusions after the original entry rule. A group matches only for its side and when ALL its conditions hold; ANY matched group excludes. Uses closed pre-entry indicators only. Normalized conditions: " + JSON.stringify(EXCLUSION_GROUPS) + ". Selected on all257 historical signals:215TP retained,35of42TIMEOUT excluded,7remain. Not independent validation; zero future TP loss is not established.";
  function exclusionFeatures(t) {
    const f = t.entryFeatures || {}, b = t.benchmarkFeatures || {}, sh = t.side === "SHORT", sign = sh ? -1 : 1;
    const num = Number.isFinite, n = (x) => num(x) ? sh ? 100 - x : x : null, sg = (x) => num(x) ? sign * x : null;
    const known = num(f.referenceClosedAt) && num(t.entryTime) && f.referenceClosedAt <= t.entryTime;
    if (!known) return null;
    const btcKnown = num(b.referenceClosedAt) && b.referenceClosedAt <= t.entryTime;
    return { atr: f.atrPct, range: f.range20Pct, vol: f.volumeRatio20, rsi: n(f.rsi14), stoch: n(f.stochastic14K), mfi: n(f.moneyFlowIndex14), cmf: sg(f.chaikinMoneyFlow20), ma50dist: sg(f.closeDistanceSma50Pct), slope: sg(f.sma50Slope5Pct), wick: sh ? f.lowerWickFraction : f.upperWickFraction, closepos: num(f.closePosition) ? sh ? 1 - f.closePosition : f.closePosition : null, bbpos: num(f.bollingerPosition) ? sh ? 1 - f.bollingerPosition : f.bollingerPosition : null, bbwidth: f.bollingerWidthPct, btc200: btcKnown ? sg(b.closeDistanceSma200Pct) : null, btc50: btcKnown ? sg(b.closeDistanceSma50Pct) : null, btcSlope: btcKnown ? sg(b.sma50Slope5Pct) : null, btc7: btcKnown ? sg(b.return7dPct) : null, entryTrend: sg(f.entryDistanceTrendPct) };
  }
  function matchingExclusions(t) {
    const x = exclusionFeatures(t);
    if (!x) return [];
    return EXCLUSION_GROUPS.flatMap((g, i) => g.side === t.side && g.conditions.every(([k, op, v]) => Number.isFinite(x[k]) && (op === "<=" ? x[k] <= v : x[k] >= v)) ? [i + 1] : []);
  }

  // dist/assets/stoch-strategy.js
  function stochasticK(candles) {
    if (candles.length < 14) return null;
    const rows = candles.slice(-14);
    const val = (c, k, i) => Array.isArray(c) ? c[i] : c[k];
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i], high2 = val(c, "high", 2), low2 = val(c, "low", 3), close2 = val(c, "close", 4), time = val(c, "time", 0);
      if (![high2, low2, close2, time].every(Number.isFinite) || high2 < low2 || close2 < low2 || close2 > high2) return null;
      if (i && time !== val(rows[i - 1], "time", 0) + 14400) return null;
    }
    const high = Math.max(...rows.map((c) => val(c, "high", 2))), low = Math.min(...rows.map((c) => val(c, "low", 3))), close = val(rows.at(-1), "close", 4);
    return high === low ? 50 : 100 * (close - low) / (high - low);
  }
  var BRANCHES = { "LONG": [["atr<=5", "btc200>=0", "btc7d>=3", "cmf>=0", "mfi>=50", "roc24h>=8", "stoch<=98", "stochSlow<=95"], ["btcSlope>=0.5", "roc24h>=15"]], "SHORT": [["age<=75", "bbPos>=1", "range>=20", "roc7d>=5", "stoch<=98"], ["bbPos>=1", "range>=20", "roc7d>=5", "rsi<=75", "stoch<=98"], ["bbWidth>=20", "rsi<=70"], ["btc7d>=5", "closePos>=0.85"], ["age<=30", "rsi>=70"], ["roc24h>=10", "stoch<=90"], ["bbWidth>=20", "wick<=0.2"]] };
  var BASE_RULE_TEXT = 'Common: original directional trend break; directional SMA50 distance>0 and slope5>0; touches>=4; range20>=10; volumeRatio20>=1.5. Directional normalization: signed features multiply by -1 for SHORT, RSI/Stoch/MFI=100-raw, BB position=1-raw, SHORT wick=lower wick, SHORT closePos=1-raw. Any branch for the trade side suffices: {"LONG":[["atr<=5","btc200>=0","btc7d>=3","cmf>=0","mfi>=50","roc24h>=8","stoch<=98","stochSlow<=95"],["btcSlope>=0.5","roc24h>=15"]],"SHORT":[["age<=75","bbPos>=1","range>=20","roc7d>=5","stoch<=98"],["bbPos>=1","range>=20","roc7d>=5","rsi<=75","stoch<=98"],["bbWidth>=20","rsi<=70"],["btc7d>=5","closePos>=0.85"],["age<=30","rsi>=70"],["roc24h>=10","stoch<=90"],["bbWidth>=20","wick<=0.2"]]}. Same-time priority: range20Pct ascending, then symbol, then side. TP5, noSL, max168h. Selected using both 2025 and 2026 historical outcomes; not independent validation.';
  var RULE_TEXT = BASE_RULE_TEXT + " " + EXCLUSION_TEXT;
  function normalizedFeatures(t) {
    const f = t.entryFeatures || {}, b = t.benchmarkFeatures || {}, short = t.side === "SHORT", s = short ? -1 : 1, n = Number.isFinite;
    const rows = t.context?.before || [], last = rows.at(-1), val = (c, i, k2) => Array.isArray(c) ? c[i] : c[k2];
    if (rows.length < 20 || !n(f.referenceClosedAt) || f.referenceClosedAt > t.entryTime || !last || val(last, 0, "time") + 14400 > t.entryTime) return null;
    const window = rows.slice(-20);
    for (let i = 0; i < window.length; i++) {
      const r = window[i], time = val(r, 0, "time"), h = val(r, 2, "high"), l = val(r, 3, "low"), c = val(r, 4, "close"), v = val(r, 5, "volume");
      if (![time, h, l, c, v].every(n) || h < l || c < l || c > h || v < 0 || i && time !== val(window[i - 1], 0, "time") + 14400) return null;
    }
    const k = stochasticK(rows), ks = [0, 1, 2].map((j) => stochasticK(j ? rows.slice(0, -j) : rows));
    if (!ks.every(n)) return null;
    const norm = (x) => n(x) ? short ? 100 - x : x : null, signed = (x) => n(x) ? s * x : null;
    const typ = window.map((r) => (val(r, 2, "high") + val(r, 3, "low") + val(r, 4, "close")) / 3), vol = window.map((r) => val(r, 5, "volume"));
    let pos = 0, neg = 0;
    for (let j = 6; j < 20; j++) {
      if (typ[j] > typ[j - 1]) pos += typ[j] * vol[j];
      else if (typ[j] < typ[j - 1]) neg += typ[j] * vol[j];
    }
    const mfi = pos + neg ? 100 * pos / (pos + neg) : 50, total = vol.reduce((a, x) => a + x, 0), cmf = total ? window.reduce((a, r, i) => {
      const h = val(r, 2, "high"), l = val(r, 3, "low"), c = val(r, 4, "close");
      return a + (h > l ? (2 * c - h - l) / (h - l) : 0) * vol[i];
    }, 0) / total : 0;
    const slow = ks.reduce((a, x) => a + x, 0) / 3;
    f.stochastic14K = k;
    f.directionalStochastic14K = norm(k);
    f.stochasticSlowK = slow;
    f.moneyFlowIndex14 = mfi;
    f.chaikinMoneyFlow20 = cmf;
    t.entryFeatures = f;
    const btcKnown = n(b.referenceClosedAt) && b.referenceClosedAt <= t.entryTime;
    return { atr: f.atrPct, btc200: btcKnown ? signed(b.closeDistanceSma200Pct) : null, btc7d: btcKnown ? signed(b.return7dPct) : null, btcSlope: btcKnown ? signed(b.sma50Slope5Pct) : null, cmf: s * cmf, mfi: norm(mfi), roc24h: signed(f.return24hPct), roc7d: signed(f.return7dPct), stoch: norm(k), stochSlow: norm(slow), age: f.trendAgeDays, bbPos: n(f.bollingerPosition) ? short ? 1 - f.bollingerPosition : f.bollingerPosition : null, range: f.range20Pct, rsi: norm(f.rsi14), bbWidth: f.bollingerWidthPct, closePos: n(f.closePosition) ? short ? 1 - f.closePosition : f.closePosition : null, wick: short ? f.lowerWickFraction : f.upperWickFraction };
  }
  function attachStochConfirmation(t) {
    const f = t.entryFeatures || {}, short = t.side === "SHORT", s = short ? -1 : 1, x = normalizedFeatures(t);
    const values = [f.closeDistanceSma50Pct, f.sma50Slope5Pct, f.range20Pct, f.touchCount, f.volumeRatio20];
    if (!x || !values.every(Number.isFinite)) {
      t.confirmations.dualPeriodBoth = null;
      return t;
    }
    const base = s * f.closeDistanceSma50Pct > 0 && s * f.sma50Slope5Pct > 0 && f.range20Pct >= 10 && f.touchCount >= 4 && f.volumeRatio20 >= 1.5;
    const match = (condition) => {
      const [, key, op, threshold] = condition.match(/^([a-zA-Z0-9]+)(>=|<=)(-?[0-9.]+)$/), v = x[key];
      return Number.isFinite(v) && (op === ">=" ? v >= Number(threshold) : v <= Number(threshold));
    };
    t.confirmations.dualPeriodBase = base && BRANCHES[short ? "SHORT" : "LONG"].some((branch) => branch.every(match));
    t.exclusionGroups = matchingExclusions(t);
    t.confirmations.dualPeriodBoth = t.confirmations.dualPeriodBase && t.exclusionGroups.length === 0;
    return t;
  }
  function compareEntryPriority(a, b) {
    const range = (t) => Number.isFinite(t.entryFeatures?.range20Pct) ? t.entryFeatures.range20Pct : Infinity, x = range(a), y = range(b);
    return (x === y ? 0 : x < y ? -1 : 1) || a.symbol.localeCompare(b.symbol) || (a.side || "LONG").localeCompare(b.side || "LONG");
  }

  // dist/assets/candidate-audit.js
  function check(key, value, op, threshold) {
    return { key, value: Number.isFinite(value) ? value : null, op, threshold, passed: Number.isFinite(value) && (op === ">" ? value > threshold : op === ">=" ? value >= threshold : value <= threshold) };
  }
  function candidateAudit(t) {
    const f = t.entryFeatures || {}, sign = t.side === "SHORT" ? -1 : 1, x = normalizedFeatures(t), signed = (v) => Number.isFinite(v) ? sign * v : null;
    const common = [check("ma", signed(f.closeDistanceSma50Pct), ">", 0), check("slope", signed(f.sma50Slope5Pct), ">", 0), check("range", f.range20Pct, ">=", 10), check("touches", f.touchCount, ">=", 4), check("vol", f.volumeRatio20, ">=", 1.5)];
    const branches = BRANCHES[t.side === "SHORT" ? "SHORT" : "LONG"].map((branch) => branch.map((condition) => {
      const [, key, op, n] = condition.match(/^([a-zA-Z0-9]+)(>=|<=)(-?[0-9.]+)$/);
      return check(key, x?.[key], op, Number(n));
    }));
    return { dataValid: !!x, common, branches, exclusionGroups: t.exclusionGroups || [], stage: t.confirmations.dualPeriodBase === true ? t.confirmations.dualPeriodBoth === true ? "qualified" : "x10" : "base" };
  }

  // dist/assets/historical-detector.js
  var Fe = (e) => e === `1H` || e === `4H` ? 8 : e === `1D` || e === `3D` ? 6 : 4;
  var Ie = { "1H": 70, "4H": 70, "1D": 45, "3D": 30, "1W": 20, "1M": 10 };
  var Le = (e) => Math.max(Ie[e] + 2, 2 * (Fe(e) + 1) + 2);
  var qt = (e) => String(e);
  var Kt = (e) => String(e);
  function Jt(e, t = 14) {
    let n = e.length, r = Array(n).fill(0);
    if (n < 2) return r;
    let i = Array(n).fill(0);
    i[0] = e[0].high - e[0].low;
    for (let t2 = 1; t2 < n; t2++) {
      let n2 = e[t2].high - e[t2].low, r2 = Math.abs(e[t2].high - e[t2 - 1].close), a2 = Math.abs(e[t2].low - e[t2 - 1].close);
      i[t2] = Math.max(n2, r2, a2);
    }
    let a = 0, o = Math.min(t, n);
    for (let e2 = 0; e2 < o; e2++) a += i[e2];
    let s = a / o;
    for (let e2 = 0; e2 < o; e2++) r[e2] = s;
    for (let e2 = t; e2 < n; e2++) a += i[e2] - i[e2 - t], r[e2] = a / t;
    return r;
  }
  var Yt = { "1H": 4.5, "4H": 18, "1D": 60, "3D": 120, "1W": 180, "1M": 365 };
  var F = { "1H": 70, "4H": 70, "1D": 45, "3D": 30, "1W": 20, "1M": 10 };
  function Xt(e, t, n) {
    let r = Fe(t), i = [], a = e.length;
    for (let t2 = r; t2 < a - r; t2++) {
      let a2 = e[t2].high, o = true;
      for (let n2 = 1; n2 <= Math.min(r, t2); n2++) if (e[t2 - n2].high > a2) {
        o = false;
        break;
      }
      if (!o) continue;
      for (let n2 = 1; n2 <= r; n2++) if (e[t2 + n2].high > a2) {
        o = false;
        break;
      }
      if (!o) continue;
      let s = a2;
      for (let n2 = -Math.min(r, t2); n2 <= r; n2++) e[t2 + n2].low < s && (s = e[t2 + n2].low);
      let c = a2 - s;
      c >= 1.8 * (n[t2] || e[t2].close * 0.03) && i.push({ index: t2, time: e[t2].time, high: a2, low: e[t2].low, close: e[t2].close, prominence: c });
    }
    return i;
  }
  function historicalDetect(e, t, n, r = 0, i = 0, a = `bybit`, now = Date.now() / 1e3) {
    if (!e || e.length < Le(n)) return null;
    let o = e.length, s = Jt(e, 14), c = Yt[n], l = F[n], u = now, d = { "1H": 3600, "4H": 14400, "1D": 86400, "3D": 259200, "1W": 604800 }, f = (e2) => {
      if (n !== `1M`) return e2.time + d[n];
      let t2 = new Date(e2.time * 1e3);
      return Date.UTC(t2.getUTCFullYear(), t2.getUTCMonth() + 1, 1) / 1e3;
    }, p = o - 1;
    for (; p >= 0 && f(e[p]) > u; ) p--;
    if (p < 2) return null;
    let m = Math.max(1, o - 3), h = Array.from({ length: Math.max(0, p - m + 1) }, (e2, t2) => ({ prevIdx: m + t2 - 1, currIdx: m + t2 })), g = Xt(e.slice(0, p + 1), n, s);
    if (g.length < 2) return null;
    let _ = 0;
    for (let t2 = 0; t2 < o; t2++) e[t2].high > _ && (_ = e[t2].high);
    let v = 0;
    for (let t2 = Math.max(0, o - 22); t2 < o - 2; t2++) v += e[t2].volume;
    let y = v / 20 || 1, b = null, ee = -1 / 0;
    for (let u2 of h) {
      if (u2.prevIdx < 0 || u2.currIdx >= o) continue;
      let d2 = e[u2.prevIdx], m2 = e[u2.currIdx], h2 = s[u2.currIdx] || m2.close * 0.03, v2 = Math.max(0.18 * h2, m2.close * 35e-4);
      for (let x = 0; x < g.length; x++) {
        let S = g[x];
        if (!(S.high >= 0.78 * _ || g.filter((e2) => e2.high > S.high).length <= 2)) continue;
        let te = u2.currIdx - S.index;
        if (!(te < l) && !(Math.round((m2.time - S.time) / 86400) < c)) for (let c2 = x + 1, XO = g.length - x - 1, XN = 2 * g.length - x - 1; c2 < XN; c2++) {
          let LG = c2 >= g.length, l2 = g[LG ? c2 - XO : c2];
          if (l2.index >= u2.prevIdx - 6 || l2.high >= S.high) continue;
          let _2 = l2.index - S.index;
          if (_2 < Fe(n) + 1) continue;
          let x2 = LG ? (Math.log(l2.high) - Math.log(S.high)) / _2 : (l2.high - S.high) / _2;
          if (x2 >= 0) continue;
          let C = LG ? (e2) => S.high * Math.exp(x2 * (e2 - S.index)) : (e2) => S.high + x2 * (e2 - S.index), w = C(u2.currIdx), T = C(u2.prevIdx);
          if (w <= 0 || T <= 0) continue;
          let E = (S.high - w) / S.high;
          let ne = d2.close <= T, D = m2.close > w + v2, re = ne && D, ie = u2.prevIdx, ae = C(ie), oe = s[ie] || d2.close * 0.03, O = !re && e[ie - 1].close <= C(ie - 1) && d2.close > ae + Math.max(0.18 * oe, d2.close * 35e-4) && m2.low <= w + 0.15 * h2 && m2.high >= w && m2.close >= w && m2.close >= m2.open;
          if (!re && !O) continue;
          let se = O ? ie : u2.currIdx;
          if (o - se > 3) continue;
          let ce = C(o - 1);
          if (ce <= 0) continue;
          let le = e[o - 1].close, ue = le / ce - 1;
          let uc = Math.max(0.03, 0.5 * (s[p] || 0) / ce);
          if (ue < -1e-10 || ue > uc + 1e-10) continue;
          let de = le < C(o - 1), fe;
          for (let t2 = se + 1; t2 <= p; t2++) {
            let n2 = e[t2], r2 = C(t2);
            if (n2.close < r2) {
              de = true;
              break;
            }
            n2.low <= r2 + 0.15 * s[t2] && n2.high >= r2 && n2.close >= n2.open && (fe = t2);
          }
          if (de) continue;
          let pe = fe !== void 0, me = se - 1, k = false;
          for (let t2 = S.index; t2 <= me; t2++) if (e[t2].close > C(t2)) {
            k = true;
            break;
          }
          if (k) continue;
          let he = false;
          for (let t2 = 0; t2 < g.length; t2++) {
            let n2 = g[t2];
            if (!(n2.high <= S.high * 1.05) && !(n2.index >= u2.currIdx - 20)) {
              for (let r2 = t2 + 1; r2 < g.length; r2++) {
                let t3 = g[r2];
                if (t3.high >= n2.high || t3.index >= u2.prevIdx) continue;
                let i2 = t3.index - n2.index;
                if (i2 < 10) continue;
                let a2 = (t3.high - n2.high) / i2;
                if (n2.high + a2 * (u2.currIdx - n2.index) > m2.close) {
                  let t4 = 0;
                  for (let r3 = n2.index; r3 <= u2.currIdx; r3++) {
                    let i3 = n2.high + a2 * (r3 - n2.index);
                    e[r3].close > i3 && t4++;
                  }
                  if (t4 === 0) {
                    he = true;
                    break;
                  }
                }
              }
              if (he) break;
            }
          }
          if (he) continue;
          let ge = [];
          for (let t2 = S.index; t2 <= me; t2++) {
            let n2 = C(t2), r2 = e[t2], i2 = s[t2] || r2.close * 0.03, a2 = Math.abs(r2.high - n2), o2 = r2.high >= n2 || a2 <= Math.max(0.15 * i2, n2 * 3e-3), c3 = r2.close <= n2;
            if (o2 && c3) {
              let a3 = 0, o3 = Math.min(me, t2 + 8);
              for (let n3 = t2 + 1; n3 <= o3; n3++) {
                let t3 = (r2.high - e[n3].low) / r2.high;
                t3 > a3 && (a3 = t3);
              }
              let s2 = t2 >= me - 2;
              (a3 >= 0.025 || a3 * r2.high >= 1.5 * i2 || s2) && ge.push({ index: t2, time: r2.time, high: r2.high, price: n2, rejectionPct: a3 * 100 });
            }
          }
          let _e = [], ve = [];
          for (let e2 of ge) if (ve.length === 0) ve.push(e2);
          else if (ve[ve.length - 1], e2.index - ve[0].index <= Fe(n)) ve.push(e2);
          else {
            let t2 = ve.reduce((e3, t3) => e3.high >= t3.high ? e3 : t3);
            _e.push({ index: t2.index, time: t2.time, dateStr: qt(t2.time), price: t2.price, candleHigh: t2.high, rejectionPct: t2.rejectionPct }), ve = [e2];
          }
          if (ve.length > 0) {
            let e2 = ve.reduce((e3, t2) => e3.high >= t2.high ? e3 : t2);
            _e.push({ index: e2.index, time: e2.time, dateStr: qt(e2.time), price: e2.price, candleHigh: e2.high, rejectionPct: e2.rejectionPct });
          }
          if (_e.length < 3) continue;
          let ye = true;
          for (let e2 = 1; e2 < _e.length; e2++) if (_e[e2].candleHigh >= _e[e2 - 1].candleHigh) {
            ye = false;
            break;
          }
          if (!ye) continue;
          let A = 0;
          for (let e2 = 1; e2 < _e.length; e2++) {
            let t2 = _e[e2].index - _e[e2 - 1].index;
            t2 > A && (A = t2);
          }
          if (A > te * 0.72) continue;
          let j = e[se].volume / (((B, K) => {
            for (let Q = Math.max(0, se - 20); Q < se; Q++) {
              B += e[Q].volume;
              K++;
            }
            return K ? B / K : 0;
          })(0, 0) || 1), M = j >= 1.5, be = `\u{1F525} MAJ\xD6R D\xDC\u015EEN TREND KIRILDI`;
          pe ? be = `\u2705 RETEST ONAYLI MAJ\xD6R KIRILIM` : M && (be = `\u{1F525} HAC\u0130ML\u0130 MAJ\xD6R KIRILIM`);
          let xe = `${a}_${t}_${n}_${_e.map((e2) => e2.time).join(`_`)}_${e[se].time}`, Se = _e.length * 20 + E * 100 + (M ? 15 : 0) + (O ? 25 : 0);
          (!b || S.high > b.startPrice || S.high === b.startPrice && (l2.high > b.lineFormula(l2.index) + 1e-9 || Math.abs(l2.high - b.lineFormula(l2.index)) <= 1e-9 && Se > ee)) && (ee = Se, b = { symbol: t, exchange: a, timeframe: n, signalName: be, signalType: be, trendAgeDays: Math.round((e[se].time - S.time) / 86400), trendAgeBars: se - S.index, majorTouchCount: _e.length, breakoutPrice: C(se), confirmationPrice: e[se].close, breakoutConfirmedAt: f(e[se]), retestTime: fe === void 0 ? void 0 : f(e[fe]), currentPrice: e[o - 1].close, breakoutTime: e[se].time, breakoutTimeStr: Kt(f(e[se])), trendlinePriceAtBreakout: C(se), startPrice: S.high, startDateStr: qt(S.time), touches: _e, klines: e, lineFormula: C, volume24hUsd: r, change24h: i, volumeRatio: j, isHighVolume: M, isRetest: pe, uniqueId: xe, logScale: LG });
        }
      }
    }
    return b;
  }

  // dist/assets/historical-short-detector.js
  var period = (tf) => tf === "1H" || tf === "4H" ? 8 : tf === "1D" || tf === "3D" ? 6 : 4;
  var minBars = { "1H": 70, "4H": 70, "1D": 45, "3D": 30, "1W": 20, "1M": 10 };
  var minDays = { "1H": 4.5, "4H": 18, "1D": 60, "3D": 120, "1W": 180, "1M": 365 };
  function atr(bars, n = 14) {
    const tr = bars.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low);
    let sum = tr.slice(0, Math.min(n, bars.length)).reduce((a, b) => a + b, 0);
    const seed = sum / Math.min(n, bars.length);
    return tr.map((v, i) => {
      if (i < n) return seed;
      sum += v - tr[i - n];
      return sum / n;
    });
  }
  function end(b, tf) {
    if (tf === "1M") {
      const d = new Date(b.time * 1e3);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1e3;
    }
    return b.time + { "1H": 3600, "4H": 14400, "1D": 86400, "3D": 259200, "1W": 604800 }[tf];
  }
  function pivotLows(bars, tf, a) {
    const r = period(tf), out = [];
    for (let i = r; i < bars.length - r; i++) {
      let low = bars[i].low, ok = true;
      for (let k = 1; k <= r; k++) if (bars[i - k].low < low || bars[i + k].low < low) {
        ok = false;
        break;
      }
      if (!ok) continue;
      let high = low;
      for (let k = -r; k <= r; k++) high = Math.max(high, bars[i + k].high);
      const prominence = high - low;
      if (prominence >= 1.8 * (a[i] || bars[i].close * 0.03)) out.push({ index: i, time: bars[i].time, low, prominence });
    }
    return out;
  }
  function historicalShortDetect(bars, symbol, tf, volume24hUsd = 0, change24h = 0, exchange = "bybit", now = Date.now() / 1e3) {
    const r = period(tf), n = bars?.length || 0;
    if (n < Math.max(minBars[tf] + 2, 2 * (r + 1) + 2)) return null;
    const a = atr(bars);
    let last = n - 1;
    while (last >= 0 && end(bars[last], tf) > now) last--;
    if (last < 2) return null;
    const pivots = pivotLows(bars.slice(0, last + 1), tf, a);
    if (pivots.length < 2) return null;
    const floor = Math.min(...bars.map((b) => b.low));
    let best = null, bestScore = -Infinity;
    for (let current = Math.max(1, n - 3); current <= last; current++) {
      const previous = current - 1, c = bars[current], p = bars[previous], at = a[current] || c.close * 0.03, tolerance = Math.max(0.18 * at, c.close * 35e-4);
      for (let x = 0; x < pivots.length; x++) {
        const start = pivots[x];
        if (!(start.low <= floor / 0.78 || pivots.filter((v) => v.low < start.low).length <= 2)) continue;
        const age = current - start.index;
        if (age < minBars[tf] || Math.round((c.time - start.time) / 86400) < minDays[tf]) continue;
        for (let y = x + 1; y < pivots.length; y++) for (const logarithmic of [false, true]) {
          const anchor = pivots[y], span = anchor.index - start.index;
          if (anchor.index >= previous - 6 || anchor.low <= start.low || span < r + 1) continue;
          const slope = logarithmic ? Math.log(anchor.low / start.low) / span : (anchor.low - start.low) / span;
          if (slope <= 0) continue;
          const line = (i) => logarithmic ? start.low * Math.exp(slope * (i - start.index)) : start.low + slope * (i - start.index);
          const value = line(current), prev = line(previous);
          if (value <= 0 || prev <= 0) continue;
          const breakout = p.close >= prev && c.close < value - tolerance;
          const previousAtr = a[previous] || p.close * 0.03;
          const retest = !breakout && bars[previous - 1].close >= line(previous - 1) && p.close < prev - Math.max(0.18 * previousAtr, p.close * 35e-4) && c.high >= value - 0.15 * at && c.low <= value && c.close <= value && c.close <= c.open;
          if (!breakout && !retest) continue;
          const signalIndex = retest ? previous : current;
          if (n - signalIndex > 3) continue;
          const currentLine = line(n - 1);
          if (currentLine <= 0) continue;
          const distance = (currentLine - bars[n - 1].close) / currentLine, maxDistance = Math.max(0.03, 0.5 * (a[last] || 0) / currentLine);
          if (distance < -1e-10 || distance > maxDistance + 1e-10) continue;
          let invalid = bars[n - 1].close > currentLine, lastRetest;
          for (let j = signalIndex + 1; j <= last; j++) {
            const b = bars[j], v = line(j);
            if (b.close > v) {
              invalid = true;
              break;
            }
            if (b.high >= v - 0.15 * a[j] && b.low <= v && b.close <= b.open) lastRetest = j;
          }
          if (invalid) continue;
          const before = signalIndex - 1;
          let crossed = false;
          for (let j = start.index; j <= before; j++) if (bars[j].close < line(j)) {
            crossed = true;
            break;
          }
          if (crossed) continue;
          let hiddenSupport = false;
          for (let j = 0; j < pivots.length && !hiddenSupport; j++) {
            const root = pivots[j];
            if (root.low >= start.low / 1.05 || root.index >= current - 20) continue;
            for (let k = j + 1; k < pivots.length; k++) {
              const tip = pivots[k], length = tip.index - root.index;
              if (tip.low <= root.low || tip.index >= previous || length < 10) continue;
              const m = (tip.low - root.low) / length;
              if (root.low + m * (current - root.index) >= c.close) continue;
              let breaches = 0;
              for (let q = root.index; q <= current; q++) if (bars[q].close < root.low + m * (q - root.index)) breaches++;
              if (breaches === 0) {
                hiddenSupport = true;
                break;
              }
            }
          }
          if (hiddenSupport) continue;
          const contacts = [];
          for (let j = start.index; j <= before; j++) {
            const v = line(j), b = bars[j], atj = a[j] || b.close * 0.03;
            if (!(b.low <= v || Math.abs(b.low - v) <= Math.max(0.15 * atj, v * 3e-3)) || b.close < v) continue;
            let rebound = 0;
            for (let k = j + 1; k <= Math.min(before, j + 8); k++) rebound = Math.max(rebound, (bars[k].high - b.low) / b.low);
            if (rebound >= 0.025 || rebound * b.low >= 1.5 * atj || j >= before - 2) contacts.push({ index: j, time: b.time, low: b.low, price: v, rejectionPct: rebound * 100 });
          }
          const touches = [];
          let cluster = [];
          const flush = () => {
            if (!cluster.length) return;
            const low = cluster.reduce((a2, b) => a2.low <= b.low ? a2 : b);
            touches.push({ index: low.index, time: low.time, dateStr: String(low.time), price: low.price, candleLow: low.low, rejectionPct: low.rejectionPct });
            cluster = [];
          };
          for (const touch of contacts) {
            if (cluster.length && touch.index - cluster[0].index > r) flush();
            cluster.push(touch);
          }
          flush();
          if (touches.length < 3 || touches.some((v, i) => i > 0 && v.candleLow <= touches[i - 1].candleLow)) continue;
          let gap = 0;
          for (let j = 1; j < touches.length; j++) gap = Math.max(gap, touches[j].index - touches[j - 1].index);
          if (gap > age * 0.72) continue;
          const mean2 = bars.slice(Math.max(0, signalIndex - 20), signalIndex).reduce((s, b) => s + b.volume, 0) / Math.min(20, signalIndex) || 1;
          const volumeRatio = bars[signalIndex].volume / mean2, isHighVolume = volumeRatio >= 1.5, rise = (value - start.low) / start.low;
          const score = touches.length * 20 + rise * 100 + (isHighVolume ? 15 : 0) + (retest ? 25 : 0);
          const preferred = !best || start.low < best.startPrice || start.low === best.startPrice && (anchor.low < best.lineFormula(anchor.index) - 1e-9 || Math.abs(anchor.low - best.lineFormula(anchor.index)) <= 1e-9 && score > bestScore);
          if (!preferred) continue;
          const isRetest = lastRetest !== void 0, name = isRetest ? "Y\xDCKSELEN TREND \xB7 SHORT RETEST" : isHighVolume ? "HAC\u0130ML\u0130 Y\xDCKSELEN TREND KIRILIMI \xB7 SHORT" : "Y\xDCKSELEN TREND KIRILIMI \xB7 SHORT";
          bestScore = score;
          best = { side: "SHORT", symbol, exchange, timeframe: tf, signalName: name, signalType: name, trendAgeDays: Math.round((bars[signalIndex].time - start.time) / 86400), trendAgeBars: signalIndex - start.index, majorTouchCount: touches.length, breakoutPrice: line(signalIndex), confirmationPrice: bars[signalIndex].close, breakoutConfirmedAt: end(bars[signalIndex], tf), retestTime: isRetest ? end(bars[lastRetest], tf) : void 0, currentPrice: bars[n - 1].close, breakoutTime: bars[signalIndex].time, breakoutTimeStr: String(end(bars[signalIndex], tf)), trendlinePriceAtBreakout: line(signalIndex), startPrice: start.low, startDateStr: String(start.time), touches, klines: bars, lineFormula: line, volume24hUsd, change24h, volumeRatio, isHighVolume, isRetest, uniqueId: `${exchange}_${symbol}_${tf}_SHORT_${touches.map((t) => t.time).join("_")}_${bars[signalIndex].time}`, logScale: logarithmic };
        }
      }
    }
    return best;
  }
  function historicalBothDetect(...args) {
    const long = historicalDetect(...args), short = historicalShortDetect(...args);
    return [long ? { ...long, side: "LONG" } : null, short].filter(Boolean);
  }

  // dist/assets/macd.js
  function emaSeries(values, period2) {
    const out = Array(values.length).fill(null);
    if (values.length < period2) return out;
    let e = values.slice(0, period2).reduce((a, b) => a + b, 0) / period2;
    out[period2 - 1] = e;
    const k = 2 / (period2 + 1);
    for (let i = period2; i < values.length; i++) {
      e += (values[i] - e) * k;
      out[i] = e;
    }
    return out;
  }
  function macdFeatures(candles) {
    const closes = candles.map((c) => c.close), empty = { macdLine: null, macdSignal: null, macdHistogram: null, macdHistogramChange1: null };
    if (closes.length < 34) return empty;
    const fast = emaSeries(closes, 12), slow = emaSeries(closes, 26), lines = closes.slice(25).map((_, i2) => fast[i2 + 25] - slow[i2 + 25]), signals = emaSeries(lines, 9), i = lines.length - 1, line = lines[i], signal = signals[i], hist = line - signal, previous = i > 0 && signals[i - 1] !== null ? lines[i - 1] - signals[i - 1] : null;
    return { macdLine: line, macdSignal: signal, macdHistogram: hist, macdHistogramChange1: previous === null ? null : hist - previous };
  }

  // dist/assets/trade-analysis.js
  var mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  var sma = (a, n) => a.length >= n ? mean(a.slice(-n)) : null;
  var pct = (value, reference) => Number.isFinite(value) && Number.isFinite(reference) && reference !== 0 ? (value / reference - 1) * 100 : null;
  function ema(a, n) {
    if (a.length < n) return null;
    let e = mean(a.slice(0, n)), k = 2 / (n + 1);
    for (let i = n; i < a.length; i++) e = a[i] * k + e * (1 - k);
    return e;
  }
  function rsi(a, n = 14) {
    if (a.length <= n) return null;
    let gain = 0, loss = 0;
    for (let i = 1; i <= n; i++) {
      let d = a[i] - a[i - 1];
      gain += Math.max(d, 0);
      loss += Math.max(-d, 0);
    }
    gain /= n;
    loss /= n;
    for (let i = n + 1; i < a.length; i++) {
      let d = a[i] - a[i - 1];
      gain = (gain * (n - 1) + Math.max(d, 0)) / n;
      loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    }
    return loss === 0 ? gain === 0 ? 50 : 100 : 100 - 100 / (1 + gain / loss);
  }
  function candleFeatures(candles) {
    if (!candles.length) return {};
    const c = candles.at(-1), closes = candles.map((c2) => c2.close), tr = candles.map((c2, i) => i ? Math.max(c2.high - c2.low, Math.abs(c2.high - candles[i - 1].close), Math.abs(c2.low - candles[i - 1].close)) : c2.high - c2.low), atr2 = sma(tr, 14), m20 = sma(closes, 20), m50 = sma(closes, 50), m200 = sma(closes, 200), window = closes.slice(-20), sd = window.length === 20 ? Math.sqrt(mean(window.map((v) => (v - m20) ** 2))) : null, upper = sd === null ? null : m20 + 2 * sd, lower = sd === null ? null : m20 - 2 * sd, priorVolume = candles.slice(-21, -1).map((c2) => c2.volume), range = c.high - c.low;
    let peak = Math.max(...candles.slice(-20).map((c2) => c2.high)), low = Math.min(...candles.slice(-20).map((c2) => c2.low));
    return { ...macdFeatures(candles), availableBars: candles.length, referenceClosedAt: c.time + 14400, stochastic14K: stochasticK(candles), rsi14: rsi(closes), rsi14Change3: closes.length > 17 ? rsi(closes) - rsi(closes.slice(0, -3)) : null, atr14: atr2, atrPct: atr2 === null ? null : pct(c.close + atr2, c.close), sma20: m20, sma50: m50, sma200: m200, closeAboveSma50: m50 === null ? null : c.close > m50, closeAboveSma200: m200 === null ? null : c.close > m200, ema20: ema(closes, 20), ema50: ema(closes, 50), sma50Slope5Pct: closes.length >= 55 ? pct(m50, sma(closes.slice(0, -5), 50)) : null, closeDistanceSma20Pct: pct(c.close, m20), closeDistanceSma50Pct: pct(c.close, m50), closeDistanceSma200Pct: pct(c.close, m200), bollingerWidthPct: m20 && sd !== null ? (upper - lower) / m20 * 100 : null, bollingerPosition: sd === 0 ? 0.5 : sd === null ? null : (c.close - lower) / (upper - lower), volumeRatio20: priorVolume.length === 20 && mean(priorVolume) > 0 ? c.volume / mean(priorVolume) : null, candleBodyPct: pct(c.close, c.open), upperWickFraction: range > 0 ? (c.high - Math.max(c.open, c.close)) / range : 0, lowerWickFraction: range > 0 ? (Math.min(c.open, c.close) - c.low) / range : 0, closePosition: range > 0 ? (c.close - c.low) / range : 0.5, return4hPct: closes.length > 1 ? pct(c.close, closes.at(-2)) : null, return24hPct: closes.length > 6 ? pct(c.close, closes.at(-7)) : null, return7dPct: closes.length > 42 ? pct(c.close, closes.at(-43)) : null, range20Pct: pct(peak, low) };
  }
  var row = (c) => [c.time, c.open, c.high, c.low, c.close, c.volume];
  function analyzeTrade(past, candles, index, signal, trade) {
    const entry = trade.entryPrice, features = candleFeatures(past), line = typeof signal.lineFormula === "function" ? signal.lineFormula(past.length) : null, last = past.at(-1), atr2 = features.atr14;
    let lastTouch = (signal.touches || []).at(-1);
    let after = candles.slice(index), observed = trade.exitTime === null ? after : after.filter((c) => trade.exitAtOpen ? c.time < trade.exitTime : c.time <= trade.exitTime);
    let high = observed.length ? Math.max(...observed.map((c) => c.high)) : entry, low = observed.length ? Math.min(...observed.map((c) => c.low)) : entry;
    return { analysisVersion: 1, entryFeatures: { ...features, entryDistanceTrendPct: pct(entry, line), entryDistanceConfirmationPct: pct(entry, signal.confirmationPrice), entryGapPct: pct(entry, last.close), stopAtrRatio: null, targetAtrRatio: atr2 > 0 ? entry * 0.05 / atr2 : null, trendAgeDays: signal.trendAgeDays, trendAgeBars: signal.trendAgeBars, touchCount: signal.majorTouchCount, trendDropPct: pct(line, signal.startPrice), barsSinceLastTouch: lastTouch ? past.length - lastTouch.index : null, breakoutVolumeRatio: signal.volumeRatio, isHighVolume: signal.isHighVolume, isRetest: signal.isRetest, logScale: signal.logScale }, outcomeFeatures: { directionalMaximumFavorablePct: trade.side === "SHORT" ? 100 * (1 - low / entry) : 100 * (high / entry - 1), directionalMaximumAdversePct: trade.side === "SHORT" ? 100 * (1 - high / entry) : 100 * (low / entry - 1), observedBars: observed.length, maximumHighReturnPct: pct(high, entry), maximumLowReturnPct: pct(low, entry), returnAfter1BarPct: after.length >= 1 ? pct(after[0].close, entry) : null, returnAfter3BarsPct: after.length >= 3 ? pct(after[2].close, entry) : null, returnAfter6BarsPct: after.length >= 6 ? pct(after[5].close, entry) : null, returnAfter12BarsPct: after.length >= 12 ? pct(after[11].close, entry) : null }, context: { columns: ["unixSeconds", "open", "high", "low", "close", "volume"], before: past.slice(-80).map(row), after: after.slice(0, 80).map(row) }, trend: { priceAtEntry: line, priceAtConfirmation: signal.breakoutPrice, startPrice: signal.startPrice, touches: signal.touches } };
  }
  function benchmarkFeatures(candles, entryTime) {
    let before = candles.filter((c) => c.time + 14400 <= entryTime).slice(-499);
    return candleFeatures(before);
  }

  // dist/assets/confirmation.js
  function attachConfirmations(trade) {
    const f = trade.entryFeatures || {}, b = trade.benchmarkFeatures || {}, past = trade.context?.before || [];
    const previousHigh = past.length >= 11 ? Math.max(...past.slice(-11, -1).map((c) => c[2])) : null, last = past.at(-1);
    const number = (v) => typeof v === "number" && Number.isFinite(v);
    trade.entryMode = "baseline";
    trade.confirmations = { coinTrend: typeof f.closeAboveSma50 === "boolean" && number(f.sma50Slope5Pct) ? f.closeAboveSma50 && f.sma50Slope5Pct > 0 : null, high10: previousHigh !== null && last ? last[4] > previousHigh : null, btc4h: number(b.return4hPct) ? b.return4hPct > 0 : null };
    trade.confirmations.macd = number(f.macdLine) && number(f.macdSignal) ? f.macdLine > f.macdSignal : null;
    trade.confirmations.ma50Macd = trade.confirmations.coinTrend === null || trade.confirmations.macd === null ? null : trade.confirmations.coinTrend && trade.confirmations.macd;
    trade.confirmations.ma50RangeTouches = trade.confirmations.coinTrend === null || !number(f.range20Pct) || !number(f.touchCount) ? null : trade.confirmations.coinTrend && f.range20Pct >= 10 && f.touchCount >= 4;
    trade.confirmations.ma50RangeTouchesVolume = trade.confirmations.ma50RangeTouches === null || !number(f.volumeRatio20) ? null : trade.confirmations.ma50RangeTouches && f.volumeRatio20 >= 1.5;
    trade.confirmations.btcTrendCoin200 = trade.confirmations.ma50RangeTouchesVolume === null || typeof b.closeAboveSma50 !== "boolean" || !number(b.sma50Slope5Pct) || typeof f.closeAboveSma200 !== "boolean" || !number(b.referenceClosedAt) || !number(f.referenceClosedAt) ? null : trade.confirmations.ma50RangeTouchesVolume === true && b.closeAboveSma50 === true && b.sma50Slope5Pct > 0 && f.closeAboveSma200 === true && b.referenceClosedAt <= trade.entryTime && f.referenceClosedAt <= trade.entryTime;
    trade.confirmations.momentumWick = trade.confirmations.btcTrendCoin200 === null || !number(f.return24hPct) || !number(f.upperWickFraction) ? null : trade.confirmations.btcTrendCoin200 === true && f.return24hPct >= 10 && f.upperWickFraction >= 0 && f.upperWickFraction <= 0.25;
    const shortValues = [f.closeDistanceSma50Pct, f.sma50Slope5Pct, f.closeDistanceSma200Pct, f.range20Pct, f.touchCount, f.volumeRatio20, f.return24hPct, f.lowerWickFraction, b.closeDistanceSma50Pct, b.sma50Slope5Pct, f.referenceClosedAt, b.referenceClosedAt];
    trade.confirmations.momentumWickShort = shortValues.every(number) ? f.closeDistanceSma50Pct < 0 && f.sma50Slope5Pct < 0 && f.closeDistanceSma200Pct < 0 && f.range20Pct >= 10 && f.touchCount >= 4 && f.volumeRatio20 >= 1.5 && f.return24hPct <= -10 && f.lowerWickFraction >= 0 && f.lowerWickFraction <= 0.25 && b.closeDistanceSma50Pct < 0 && b.sma50Slope5Pct < 0 && f.referenceClosedAt <= trade.entryTime && b.referenceClosedAt <= trade.entryTime : null;
    trade.confirmations.momentumWickBoth = trade.side === "SHORT" ? trade.confirmations.momentumWickShort : trade.confirmations.momentumWick;
    trade.confirmationFeatures = { previous10High: previousHigh };
    return attachStochConfirmation(trade);
  }

  // dist/assets/strategy-identity.js
  var MODEL_VERSION = "tp5-no-sl-max168h-dual-period-x10-v14";
  var LEGACY_MODEL_VERSION = "tp5-no-sl-max168h-dual-period-110-105-range-v13";
  var isTrackedStrategy = (v) => v === MODEL_VERSION || v === LEGACY_MODEL_VERSION;

  // dist/assets/backtest-core.js
  var MAX_HOLD_SECONDS = 7 * 24 * 3600;

  // dist/assets/live-strategy.js
  var H = 14400;
  function liveCandidates(candles, info, benchmark, now = Date.now() / 1e3, detect = historicalBothDetect) {
    if (info.exchange !== "bybit") throw Error("Only Bybit USDT crypto is supported");
    const boundary = Math.floor(now / H) * H, current = candles.find((c) => c.time === boundary), past = candles.filter((c) => c.time < boundary && c.time + H <= boundary).slice(-498);
    if (past.length < 72) {
      const e = Error("Yetersiz 4H ge\xE7mi\u015Fi / Insufficient 4H history: " + past.length + " / 72");
      e.code = "INSUFFICIENT_HISTORY";
      throw e;
    }
    if (!current) throw Error("G\xFCncel 4H a\xE7\u0131l\u0131\u015F\u0131 eksik / Current 4H open missing");
    if (past.at(-1).time + H !== boundary) throw Error("Son kapanm\u0131\u015F 4H mumu eksik / Latest closed 4H candle missing");
    if (![current.open, ...past.flatMap((c) => [c.time, c.open, c.high, c.low, c.close, c.volume])].every(Number.isFinite) || current.open <= 0) throw Error("Invalid candle data");
    for (let i = 1; i < past.length; i++) if (past[i].time !== past[i - 1].time + H) throw Error("Missing 4H candles in entry window");
    const btc = benchmarkFeatures(benchmark, boundary);
    if (btc.referenceClosedAt !== boundary) throw Error("BTC latest closed 4H candle unavailable");
    const stub = { time: boundary, rawTime: boundary * 1e3, open: current.open, high: current.open, low: current.open, close: current.open, volume: 0 };
    return detect([...past, stub], info.symbol, "4H", info.volume24hUsd || 0, info.change24h || 0, "bybit", boundary).map((signal) => {
      return evaluateLiveSignal(past, current, info, btc, signal, boundary);
    });
  }
  function evaluateLiveSignal(past, current, info, btc, signal, boundary) {
    if (btc.referenceClosedAt !== boundary) throw Error("BTC closed reference mismatch");
    const stub = { time: boundary, rawTime: boundary * 1e3, open: current.open, high: current.open, low: current.open, close: current.open, volume: 0 };
    const side = signal.side === "SHORT" ? "SHORT" : "LONG", key = "bybit_" + info.symbol + "_4H_" + signal.breakoutTime + (side === "SHORT" ? "_SHORT" : "");
    const t = { key, side, symbol: info.symbol, exchange: "bybit", timeframe: "4H", entryTime: boundary, entryPrice: stub.open, status: "OPEN", exitTime: null, tp: stub.open * (side === "SHORT" ? 0.95 : 1.05), sl: null };
    Object.assign(t, analyzeTrade(past, [stub], 0, signal, t));
    t.benchmarkFeatures = btc;
    attachConfirmations(t);
    return { ...signal, side, entryPrice: t.entryPrice, tp: t.tp, sl: null, entryTime: boundary, entryFeatures: t.entryFeatures, benchmarkFeatures: btc, audit: candidateAudit(t), exclusionGroups: t.exclusionGroups, baseQualified: t.confirmations.dualPeriodBase === true, qualified: t.confirmations.dualPeriodBoth === true, strategyVersion: MODEL_VERSION, tradeKey: key, uniqueId: MODEL_VERSION + "_" + key, isRetest: false, firstDetectedAt: boundary * 1e3, deadline: (boundary + 7 * 86400) * 1e3, currentPrice: current.close, klines: [...past, current] };
  }
  function signalRecord(s, now = Date.now()) {
    if (s.strategyVersion !== MODEL_VERSION || !s.qualified) return null;
    return { strategyVersion: MODEL_VERSION, key: s.uniqueId, notificationKey: s.uniqueId + "_initial", tradeKey: s.tradeKey, symbol: s.symbol, side: s.side, exchange: "bybit", timeframe: "4H", signalAt: s.entryTime * 1e3, confirmationAt: s.breakoutConfirmedAt * 1e3, registeredAt: now, entry: s.entryPrice, tp: s.tp, deadline: s.deadline, status: "OPEN", portfolioPending: true, portfolioAccepted: false, targetAt: null, lastCheckedAt: now, lastPrice: s.currentPrice, coverageGap: false, range20Pct: s.entryFeatures.range20Pct, entryFeatures: s.entryFeatures, benchmarkFeatures: s.benchmarkFeatures, majorTouchCount: s.majorTouchCount, breakoutTime: s.breakoutTime, breakoutPrice: s.breakoutPrice, confirmationPrice: s.confirmationPrice, trendAgeDays: s.trendAgeDays, trendAgeBars: s.trendAgeBars, touches: s.touches, startPrice: s.startPrice, logScale: s.logScale };
  }
  function batchCandidates(candidates, now = Date.now()) {
    return candidates.slice().sort((a, b) => a.entryTime - b.entryTime || compareEntryPriority(a, b)).map((s, priorityRank) => ({ priorityRank, key: s.uniqueId, qualified: !!s.qualified, entryTime: s.entryTime, range20Pct: s.entryFeatures.range20Pct, symbol: s.symbol, side: s.side, row: signalRecord(s, now) }));
  }
  async function scanCurrent({ symbols, request, cancel = () => false, paused = () => false, progress = () => {
  }, onSignal = async () => {
  }, now, detect = historicalBothDetect }) {
    const read = async (url) => {
      let last;
      for (let i = 0; i < 2; i++) {
        if (cancel()) throw Error("Cancelled");
        while (paused() && !cancel()) await new Promise((r) => setTimeout(r, 200));
        if (cancel()) throw Error("Cancelled");
        try {
          const r = await request(url);
          if (!r.ok) throw Error(r.error || "HTTP " + r.status);
          const d = JSON.parse(r.text);
          if (Number(d.retCode) !== 0) throw Error(d.retMsg || "Bybit error");
          return d;
        } catch (e) {
          last = e;
        }
      }
      throw last;
    };
    const bars = async (symbol, limit) => {
      const d = await read("https://api.bybit.com/v5/market/kline?category=linear&symbol=" + encodeURIComponent(symbol) + "&interval=240&limit=" + limit);
      if (!Array.isArray(d.result?.list)) throw Error("Missing candle list");
      return { serverTime: Number(d.time), candles: d.result.list.map((r) => ({ time: Number(r[0]) / 1e3, rawTime: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]), volume: Number(r[5]) })).sort((a, b) => a.time - b.time) };
    };
    const btcReply = await bars("BTCUSDT", 500), phoneNow = Date.now() / 1e3, serverNow = Number.isFinite(btcReply.serverTime) && btcReply.serverTime > 1e12 ? btcReply.serverTime / 1e3 : null, scanNow = Number.isFinite(now) ? now : serverNow ?? phoneNow, btc = btcReply.candles;
    const diagnostics = { clockSource: Number.isFinite(now) ? "explicit" : serverNow ? "exchange" : "phone", clockSkewSeconds: serverNow === null ? null : Math.round(phoneNow - serverNow), referenceAt: Math.floor(scanNow / H) * H * 1e3, checked: 0, noPattern: 0, rawCandidates: 0, longCandidates: 0, shortCandidates: 0, basePassed: 0, baseRejected: 0, x10Blocked: 0, qualified: 0, candidateDetails: [], exclusionHits: Array(10).fill(0) };
    let next = 0, tested = 0;
    const candidates = [], errors = [], insufficient = [], signals = [];
    const worker = async () => {
      while (next < symbols.length && !cancel()) {
        const s = symbols[next++];
        try {
          const reply = await bars(s.symbol, 500), cs = reply.candles;
          const observedNow = Number.isFinite(now) ? now * 1e3 : reply.serverTime;
          const found = liveCandidates(cs, s, btc, scanNow, detect);
          for (const c of found.filter((c2) => c2.qualified)) {
            await onSignal(c, observedNow);
          }
          diagnostics.checked++;
          if (!found.length) diagnostics.noPattern++;
          for (const c of found) {
            diagnostics.candidateDetails.push({ symbol: c.symbol, side: c.side, audit: c.audit });
            diagnostics.rawCandidates++;
            diagnostics[c.side === "SHORT" ? "shortCandidates" : "longCandidates"]++;
            if (c.baseQualified) {
              diagnostics.basePassed++;
              if (c.qualified) diagnostics.qualified++;
              else {
                diagnostics.x10Blocked++;
                for (const group of c.exclusionGroups || []) if (group >= 1 && group <= 10) diagnostics.exclusionHits[group - 1]++;
              }
            } else diagnostics.baseRejected++;
          }
          candidates.push(...found);
          signals.push(...found.filter((x) => x.qualified));
        } catch (e) {
          (e.code === "INSUFFICIENT_HISTORY" ? insufficient : errors).push(s.symbol + ": " + e.message);
        }
        tested++;
        progress({ tested, total: symbols.length, signals: signals.length, errors: errors.length, insufficient: insufficient.length, symbol: s.symbol, diagnostics: { ...diagnostics, candidateDetails: diagnostics.candidateDetails.slice(), exclusionHits: diagnostics.exclusionHits.slice() } });
        await new Promise((r) => setTimeout(r, 0));
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return { candidates, signals, tested, total: symbols.length, errors, insufficient, diagnostics, cancelled: cancel() };
  }

  // dist/assets/forward-core.js
  function forwardCheck(row2, bars, now = Date.now(), minuteBars = []) {
    if (!isTrackedStrategy(row2.strategyVersion) || row2.status !== "OPEN") return null;
    const short = row2.side === "SHORT", sign = short ? -1 : 1, H2 = 14400, reg = row2.registeredAt / 1e3, deadline = row2.deadline / 1e3;
    const start = Math.ceil(reg / 60) * 60, cs = bars.filter((c) => c.time + H2 <= now / 1e3 && c.time >= row2.signalAt / 1e3 && c.time < deadline).sort((a, b) => a.time - b.time), mins = minuteBars.filter((c) => c.time >= start && c.time + 60 <= now / 1e3 && c.time < deadline).sort((a, b) => a.time - b.time);
    const hit = (c) => short ? c.low <= row2.tp : c.high >= row2.tp, opening = (c) => short ? c.open <= row2.tp : c.open >= row2.tp;
    const hits = [];
    for (const c of cs) if (c.time >= reg && hit(c)) hits.push({ at: opening(c) ? c.time : c.time + H2, price: opening(c) ? c.open : row2.tp, free: opening(c) ? c.time : c.time + H2, kind: "4h" });
    for (const c of mins) if (hit(c)) {
      const gap = opening(c) && c.time % H2 === 0;
      hits.push({ at: gap ? c.time : c.time + 60, price: gap ? c.open : row2.tp, free: gap ? c.time : Math.floor(c.time / H2) * H2 + H2, kind: "minute" });
      break;
    }
    hits.sort((a, b) => a.at - b.at);
    const last = bars.at(-1), update = { key: row2.key, lastCheckedAt: now, lastPrice: last?.close ?? row2.lastPrice, coverageGap: !!row2.coverageGap };
    const firstClosed = Math.ceil(reg / H2) * H2, needed = Math.max(firstClosed, row2.signalAt / 1e3);
    let prior = needed - H2, complete = true;
    for (const c of cs.filter((c2) => c2.time >= needed)) {
      if (c.time !== prior + H2) {
        update.coverageGap = true;
        complete = false;
      }
      prior = c.time;
    }
    const partialEnd = (Math.floor(reg / H2) + 1) * H2;
    if (reg % H2 !== 0 && Math.min(Math.floor(now / 6e4) * 60, partialEnd) > start) {
      const first = mins.filter((c) => c.time < partialEnd);
      if (!first.length || first[0].time > start || first.at(-1).time + 60 < Math.min(Math.floor(now / 6e4) * 60, partialEnd)) {
        update.coverageGap = true;
        complete = false;
      }
      for (let i = 1; i < first.length; i++) if (first[i].time !== first[i - 1].time + 60) {
        update.coverageGap = true;
        complete = false;
      }
    }
    if (hits.length) {
      const h = hits[0];
      return { ...update, status: "TP", targetAt: h.at * 1e3, targetKind: h.kind, exitPrice: h.price, exitAt: h.at * 1e3, freeAt: h.free * 1e3, returnPct: sign * (h.price / row2.entry - 1) * 100 };
    }
    if (now / 1e3 >= deadline) {
      const final = cs.find((c) => c.time + H2 === deadline);
      if (final && complete && prior + H2 >= deadline) return { ...update, status: "TIMEOUT", exitAt: row2.deadline, freeAt: row2.deadline, exitPrice: final.close, returnPct: sign * (final.close / row2.entry - 1) * 100 };
      return { ...update, status: "OPEN", coverageGap: true, error: "Deadline candles missing; exit cannot be verified" };
    }
    return { ...update, status: "OPEN" };
  }

  // dist/assets/forward-monitor.js
  async function checkForwardRows(rows, request, mark) {
    rows = rows.filter((r) => isTrackedStrategy(r.strategyVersion) && r.status === "OPEN");
    let next = 0;
    const errors = [];
    const read = async (url) => {
      const r = await request(url);
      if (!r.ok) throw Error(r.error || "HTTP " + r.status);
      const d = JSON.parse(r.text);
      if (Number(d.retCode) !== 0 || !Array.isArray(d.result?.list)) throw Error(d.retMsg || "Invalid candles");
      return d.result.list.map((r2) => ({ time: Number(r2[0]) / 1e3, open: Number(r2[1]), high: Number(r2[2]), low: Number(r2[3]), close: Number(r2[4]) })).sort((a, b) => a.time - b.time);
    };
    const scan = async () => {
      while (next < rows.length) {
        const row2 = rows[next++];
        try {
          const now = Date.now(), q = encodeURIComponent(row2.symbol), deadline = row2.deadline, end2 = Math.min(now, deadline), base = "https://api.bybit.com/v5/market/kline?category=linear&symbol=" + q;
          const four = await read(base + "&interval=240&limit=1000&start=" + row2.signalAt + "&end=" + (end2 - 1));
          if (!four.length || four.some((c) => ![c.time, c.open, c.high, c.low, c.close].every(Number.isFinite))) throw Error("Invalid or missing 4H candles");
          const from = Math.ceil(row2.registeredAt / 6e4) * 6e4, partialEnd = (Math.floor(row2.registeredAt / 144e5) + 1) * 144e5, minEnd = Math.min(partialEnd, end2);
          let minutes = [];
          if (minEnd > from) minutes.push(...await read(base + "&interval=1&limit=1000&start=" + from + "&end=" + (minEnd - 1)));
          const current = Math.floor(now / 144e5) * 144e5;
          if (current >= partialEnd && current < end2) minutes.push(...await read(base + "&interval=1&limit=1000&start=" + current + "&end=" + (end2 - 1)));
          const update = forwardCheck(row2, four, now, minutes);
          if (update) await mark(JSON.stringify(update));
          if (update?.error) errors.push(row2.symbol + ": " + update.error);
        } catch (e) {
          errors.push(row2.symbol + ": " + e.message);
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, scan));
    return errors;
  }

  // ios-worker/entry.js
  globalThis.TRADINGLY_RUN = async function() {
    const native = globalThis.LiveNative, pending = /* @__PURE__ */ new Map();
    let sequence = 0;
    globalThis.liveReply = (id, r) => {
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        clearTimeout(p.timer);
        p.resolve(r);
      }
    };
    const request = (url) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Native request timeout"));
      }, 65e3);
      pending.set(id, { resolve, timer });
      native.request(url, id);
    });
    let result = { tested: 0, total: 0, signals: 0, errors: [], insufficient: [] };
    try {
      result.errors.push(...await checkForwardRows(JSON.parse(native.history()), request, (row2) => native.mark(row2)));
      const instruments = await cryptoInstrumentMap(request, "bybit");
      const symbols = [...instruments.keys()].map((symbol) => ({ symbol, exchange: "bybit", volume24hUsd: 0, change24h: 0 }));
      result.total = symbols.length;
      native.progress(JSON.stringify({ tested: 0, total: symbols.length, symbol: "BTCUSDT" }));
      const scan = await scanCurrent({ symbols, request, onSignal: async (s, at) => {
        const row2 = signalRecord(s, at);
        if (row2) native.observe(JSON.stringify(row2));
      }, progress: (p) => native.progress(JSON.stringify(p)) });
      result = { tested: scan.tested, total: scan.total, signals: scan.signals.length, errors: [...result.errors, ...scan.errors], insufficient: scan.insufficient, diagnostics: scan.diagnostics };
      const committed = JSON.parse(native.batch(JSON.stringify({ candidates: batchCandidates(scan.candidates) })));
      if (committed.error) throw Error(committed.error);
      result.errors.push(...await checkForwardRows(JSON.parse(native.history()), request, (row2) => native.mark(row2)));
      result.accepted = committed.accepted?.length || 0;
      result.recorded = committed.recorded?.length || 0;
      result.notified = committed.notified || 0;
      result.pendingNotifications = committed.pendingNotifications || 0;
      result.processedBefore = Math.max(0, scan.signals.length - result.recorded);
      result.skippedBusy = committed.skippedBusy || 0;
    } catch (e) {
      result.errors.push(String(e.message || e));
    } finally {
      native.done(JSON.stringify(result));
    }
  };
})();
