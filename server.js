const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { RSI, MACD, SMA, EMA, BollingerBands, Stochastic, ADX } = require('technicalindicators');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Utility ──────────────────────────────────────────────────────────────────
const round2 = (n) => +Number(n).toFixed(2);
const cleanSymbol = (s) => String(s).replace('.NS', '').replace('.BO', '');

// ── Stock lists ───────────────────────────────────────────────────────────────
const POPULAR_STOCKS = [
  'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
  'HINDUNILVR.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'ITC.NS', 'KOTAKBANK.NS',
  'LT.NS', 'AXISBANK.NS', 'WIPRO.NS', 'ADANIENT.NS', 'TATAMOTORS.NS',
  'MARUTI.NS', 'SUNPHARMA.NS', 'TITAN.NS', 'BAJFINANCE.NS', 'ASIANPAINT.NS',
];
const INDICES = ['^NSEI', '^BSESN', '^NSEBANK'];

const SECTORS = {
  Banking:  ['HDFCBANK.NS', 'ICICIBANK.NS', 'SBIN.NS', 'KOTAKBANK.NS', 'AXISBANK.NS'],
  IT:       ['TCS.NS', 'INFY.NS', 'WIPRO.NS'],
  Consumer: ['HINDUNILVR.NS', 'ITC.NS', 'TITAN.NS', 'ASIANPAINT.NS'],
  Auto:     ['TATAMOTORS.NS', 'MARUTI.NS'],
  Energy:   ['RELIANCE.NS', 'ADANIENT.NS'],
  Pharma:   ['SUNPHARMA.NS'],
  Telecom:  ['BHARTIARTL.NS'],
  Finance:  ['BAJFINANCE.NS', 'LT.NS'],
};

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ── Yahoo Finance helpers ─────────────────────────────────────────────────────
async function fetchChartData(symbol, range = '6mo', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await axios.get(url, { headers: YF_HEADERS, timeout: 12000 });

  const result = res.data?.chart?.result?.[0];
  if (!result) throw new Error('No data for ' + symbol);

  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const ohlcv = result.indicators?.quote?.[0] || {};

  const history = timestamps.map((t, i) => ({
    date: new Date(t * 1000).toISOString(),
    open: ohlcv.open?.[i],
    high: ohlcv.high?.[i],
    low: ohlcv.low?.[i],
    close: ohlcv.close?.[i],
    volume: ohlcv.volume?.[i],
  })).filter(d => d.close != null);

  const prevClose = meta.chartPreviousClose || meta.previousClose;
  const price = meta.regularMarketPrice;
  const change = (price && prevClose) ? round2(price - prevClose) : 0;
  const changePercent = prevClose ? round2((change / prevClose) * 100) : 0;

  return {
    quote: {
      symbol: meta.symbol || symbol,
      name: meta.shortName || meta.longName || cleanSymbol(symbol),
      price,
      change,
      changePercent,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      open: history.length > 0 ? history[history.length - 1].open : null,
      prevClose,
      volume: meta.regularMarketVolume,
      marketCap: null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
    },
    history,
  };
}

// Only quote metadata needed (for popular/indices) — use 1d range to minimise payload
async function fetchQuoteOnly(symbol) {
  const { quote } = await fetchChartData(symbol, '1d', '1d');
  return quote;
}

// Batch quotes in groups of 5 with a small delay to avoid rate-limiting
async function fetchQuotesBatch(symbols) {
  const BATCH = 5;
  const DELAY = 50; // ms — enough to avoid bursts without adding noticeable latency
  const all = [];

  for (let i = 0; i < symbols.length; i += BATCH) {
    const results = await Promise.allSettled(
      symbols.slice(i, i + BATCH).map(fetchQuoteOnly)
    );
    results.filter(r => r.status === 'fulfilled').forEach(r => all.push(r.value));
    if (i + BATCH < symbols.length) await new Promise(r => setTimeout(r, DELAY));
  }
  return all;
}

async function searchStocks(query) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=15&newsCount=0`;
  const res = await axios.get(url, { headers: YF_HEADERS, timeout: 8000 });
  return res.data?.quotes || [];
}

// ── Technical Analysis ────────────────────────────────────────────────────────
function analyzeStock(history) {
  const closes  = history.map(d => d.close).filter(Boolean);
  const highs   = history.map(d => d.high).filter(Boolean);
  const lows    = history.map(d => d.low).filter(Boolean);
  const volumes = history.map(d => d.volume).filter(Boolean);

  if (closes.length < 26) {
    return { signal: 'HOLD', strength: 50, reasons: ['Insufficient data'], indicators: {}, targets: {}, investorScores: {} };
  }

  // ── Indicators ──
  const rsiArr  = RSI.calculate({ values: closes, period: 14 });
  const macdArr = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
  const sma20Arr = SMA.calculate({ values: closes, period: 20 });
  const sma50Arr = SMA.calculate({ values: closes, period: 50 });
  const bbArr    = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const stochArr = Stochastic.calculate({ high: highs, low: lows, close: closes, period: 14, signalPeriod: 3 });
  const adxArr   = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });

  const last = arr => arr.length ? arr[arr.length - 1] : null;

  const currentRSI  = last(rsiArr) ?? 50;
  const currentMACD = last(macdArr);
  const currentSMA20 = last(sma20Arr) ?? closes[closes.length - 1];
  const currentSMA50 = last(sma50Arr) ?? closes[closes.length - 1];
  const currentBB    = last(bbArr);
  const currentPrice = closes[closes.length - 1];
  const currentStoch = stochArr.length ? stochArr[stochArr.length - 1] : null;
  const currentADX   = adxArr.length   ? adxArr[adxArr.length - 1]   : null;

  // Volume
  const recentVols   = volumes.slice(-20);
  const avgVolume    = recentVols.reduce((a, b) => a + b, 0) / (recentVols.length || 1);
  const currentVolume = volumes[volumes.length - 1] ?? avgVolume;
  const volumeRatio  = avgVolume > 0 ? currentVolume / avgVolume : 1;

  // ── Buy / Sell signals ──
  let buySignals = 0, sellSignals = 0;
  const reasons = [];

  if (currentRSI < 30)      { buySignals  += 2; reasons.push('RSI Oversold (<30)'); }
  else if (currentRSI < 40) { buySignals  += 1; reasons.push('RSI Low Zone'); }
  else if (currentRSI > 70) { sellSignals += 2; reasons.push('RSI Overbought (>70)'); }
  else if (currentRSI > 60) { sellSignals += 1; reasons.push('RSI High Zone'); }

  if (currentMACD) {
    if (currentMACD.histogram > 0 && currentMACD.MACD > currentMACD.signal) {
      buySignals += 2; reasons.push('MACD Bullish Crossover');
    } else if (currentMACD.histogram < 0 && currentMACD.MACD < currentMACD.signal) {
      sellSignals += 2; reasons.push('MACD Bearish Crossover');
    }
  }

  if (currentPrice > currentSMA20) { buySignals  += 1; reasons.push('Price > SMA20'); }
  else                              { sellSignals += 1; reasons.push('Price < SMA20'); }

  if (currentPrice > currentSMA50) { buySignals  += 1; reasons.push('Price > SMA50'); }
  else                              { sellSignals += 1; reasons.push('Price < SMA50'); }

  if (currentSMA20 > currentSMA50) { buySignals  += 1; reasons.push('Golden Cross (SMA20 > SMA50)'); }
  else                              { sellSignals += 1; reasons.push('Death Cross (SMA20 < SMA50)'); }

  if (currentBB) {
    if (currentPrice <= currentBB.lower) { buySignals  += 2; reasons.push('Price at Lower Bollinger Band'); }
    else if (currentPrice >= currentBB.upper) { sellSignals += 2; reasons.push('Price at Upper Bollinger Band'); }
  }

  if (currentStoch) {
    if (currentStoch.k < 20)      { buySignals  += 1; reasons.push('Stochastic Oversold (<20)'); }
    else if (currentStoch.k > 80) { sellSignals += 1; reasons.push('Stochastic Overbought (>80)'); }
  }
  // ADX filters weak trends — only boost confidence when ADX > 25
  if (currentADX?.adx > 25) {
    if (buySignals > sellSignals)  { buySignals  += 1; reasons.push('ADX Trend Strong (>25) — Momentum Confirmed'); }
    else if (sellSignals > buySignals) { sellSignals += 1; reasons.push('ADX Trend Strong (>25) — Bearish Momentum'); }
  }

  if (volumeRatio > 1.5) {
    if (buySignals > sellSignals) { buySignals  += 1; reasons.push('High Volume Confirmation'); }
    else                          { sellSignals += 1; reasons.push('High Volume Selling'); }
  }

  // ── Signal ──
  const total = (buySignals + sellSignals) || 1;
  let signal, strength;
  if      (buySignals  > sellSignals + 2) { signal = 'STRONG BUY';  strength = Math.min(Math.round((buySignals  / total) * 100), 95); }
  else if (buySignals  > sellSignals)     { signal = 'BUY';          strength = Math.min(Math.round((buySignals  / total) * 100), 80); }
  else if (sellSignals > buySignals  + 2) { signal = 'STRONG SELL'; strength = Math.min(Math.round((sellSignals / total) * 100), 95); }
  else if (sellSignals > buySignals)      { signal = 'SELL';         strength = Math.min(Math.round((sellSignals / total) * 100), 80); }
  else                                    { signal = 'HOLD';         strength = 50; }

  // ── Targets ──
  const recentHighs = highs.slice(-20);
  const recentLows  = lows.slice(-20);
  const resistance  = Math.max(...recentHighs);
  const support     = Math.min(...recentLows);
  const pivot       = (resistance + support + currentPrice) / 3;

  // ── Investor Scores ──
  const investorScores = computeInvestorScores({
    closes, highs, lows, volumes,
    currentPrice, currentRSI, currentMACD,
    currentSMA20, currentSMA50, currentBB,
    volumeRatio, resistance, support,
  });

  return {
    signal, strength, reasons,
    indicators: {
      rsi:  round2(currentRSI),
      macd: currentMACD ? {
        value:     round2(currentMACD.MACD),
        signal:    round2(currentMACD.signal),
        histogram: round2(currentMACD.histogram),
      } : null,
      sma20: round2(currentSMA20),
      sma50: round2(currentSMA50),
      bollingerBands: currentBB ? {
        upper:  round2(currentBB.upper),
        middle: round2(currentBB.middle),
        lower:  round2(currentBB.lower),
      } : null,
      volumeRatio: round2(volumeRatio),
      stochastic: currentStoch ? { k: round2(currentStoch.k), d: round2(currentStoch.d) } : null,
      adx: currentADX ? round2(currentADX.adx) : null,
    },
    targets: {
      target1:    round2(pivot + (pivot - support)),
      target2:    round2(pivot + (resistance - support)),
      stopLoss:   round2(pivot - (resistance - pivot)),
      support:    round2(support),
      resistance: round2(resistance),
      pivotPoint: round2(pivot),
    },
    investorScores,
  };
}

// ── All 10 Legendary Investor Scoring Engines ────────────────────────────────
function computeInvestorScores({ closes, highs, lows, volumes, currentPrice,
  currentRSI, currentMACD, currentSMA20, currentSMA50, currentBB, volumeRatio,
  resistance, support }) {

  const w52High = Math.max(...(highs.slice(-252).length ? highs.slice(-252) : highs));
  const w52Low  = Math.min(...(lows.slice(-252).length  ? lows.slice(-252)  : lows));
  const range   = w52High - w52Low || 1;
  const pricePosition = (currentPrice - w52Low) / range;

  const returns = [];
  for (let i = 1; i < closes.length; i++)
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);

  const recent30 = returns.slice(-30);
  const avgReturn = recent30.reduce((a, b) => a + b, 0) / (recent30.length || 1);
  const stdDev    = Math.sqrt(recent30.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / (recent30.length || 1));
  const sharpeProxy = stdDev > 0 ? avgReturn / stdDev : 0;

  const last20Returns  = returns.slice(-20);
  const trendConsistency = last20Returns.filter(r => r > 0).length / (last20Returns.length || 1);
  const bbWidth = currentBB ? (currentBB.upper - currentBB.lower) / currentBB.middle : 0.1;
  const aboveSMA20 = currentPrice > currentSMA20;
  const aboveSMA50 = currentPrice > currentSMA50;
  const goldenCross = currentSMA20 > currentSMA50;
  const macdPositive = currentMACD && currentMACD.histogram > 0;

  const makeRating = (score) =>
    score >= 75 ? 'STRONG BUY' : score >= 55 ? 'BUY' : score >= 38 ? 'HOLD' : score >= 22 ? 'WATCH' : 'AVOID';

  // ── 1. BENJAMIN GRAHAM — Deep Value / Net-Net / Margin of Safety ──────────
  let grahamScore = 0;
  const grahamPos = [], grahamNeg = [];
  if (pricePosition < 0.25)      { grahamScore += 30; grahamPos.push('Deeply discounted from 52W high — classic Graham margin of safety'); }
  else if (pricePosition < 0.40) { grahamScore += 18; grahamPos.push('Trading at discount — margin of safety exists'); }
  else if (pricePosition > 0.75) { grahamNeg.push('Near 52W high — insufficient margin of safety'); }

  if (bbWidth < 0.05)      { grahamScore += 25; grahamPos.push('Extremely stable price — hallmark of a durable business'); }
  else if (bbWidth < 0.09) { grahamScore += 12; grahamPos.push('Moderate volatility — business reasonably stable'); }
  else                     { grahamNeg.push('High volatility — Graham avoids speculative stocks'); }

  if (currentRSI < 30)      { grahamScore += 25; grahamPos.push('RSI deeply oversold — market has given up on it, potential deep value'); }
  else if (currentRSI < 40) { grahamScore += 15; grahamPos.push('Low RSI — market undervaluing the stock'); }
  else if (currentRSI > 65) { grahamNeg.push('Elevated RSI — market may have fully priced in value'); }

  if (!aboveSMA50 && trendConsistency > 0.45) { grahamScore += 20; grahamPos.push('Below trend average but stabilising — potential turnaround'); }
  else if (aboveSMA50)                         { grahamScore += 10; }

  // ── 2. WARREN BUFFETT — Value / Safety / Moat ────────────────────────────
  let buffettScore = 0;
  const buffettPos = [], buffettNeg = [];
  if (pricePosition < 0.35)      { buffettScore += 25; buffettPos.push('Near 52W lows — classic margin of safety'); }
  else if (pricePosition < 0.55) { buffettScore += 15; buffettPos.push('Price in fair-value zone — reasonable entry'); }
  else if (pricePosition > 0.85) { buffettNeg.push('Near 52W highs — limited margin of safety'); }

  if (bbWidth < 0.05)      { buffettScore += 20; buffettPos.push('Low volatility — stable, predictable business'); }
  else if (bbWidth < 0.10) { buffettScore += 10; buffettPos.push('Moderate volatility — reasonably stable'); }
  else                     { buffettNeg.push('High volatility — Buffett avoids unpredictable swings'); }

  if (trendConsistency > 0.65)      { buffettScore += 20; buffettPos.push('Consistent uptrend — signs of strong competitive moat'); }
  else if (trendConsistency > 0.50) { buffettScore += 10; buffettPos.push('Mostly positive trend — moderate strength'); }
  else                               { buffettNeg.push('Inconsistent trend — uncertain business performance'); }

  if (aboveSMA50 && goldenCross) { buffettScore += 20; buffettPos.push('Golden Cross active — long-term uptrend intact'); }
  else if (aboveSMA50)           { buffettScore += 10; buffettPos.push('Above 50-day average — medium-term trend positive'); }
  else                           { buffettNeg.push('Below 50-day average — long-term trend weakening'); }

  if (currentRSI >= 35 && currentRSI <= 60) { buffettScore += 15; buffettPos.push('RSI in healthy zone — not overbought or panic-sold'); }
  else if (currentRSI < 35)                  { buffettScore += 8;  buffettPos.push('Oversold RSI — potential value opportunity emerging'); }
  else                                        { buffettNeg.push('Elevated RSI — reduced margin of safety'); }

  // ── 3. PETER LYNCH — GARP / Growth at Reasonable Price ──────────────────
  let lynchScore = 0;
  const lynchPos = [], lynchNeg = [];
  if (currentRSI >= 45 && currentRSI <= 65)  { lynchScore += 20; lynchPos.push('RSI in GARP zone — not overvalued, not beaten down'); }
  else if (currentRSI >= 40 && currentRSI < 45) { lynchScore += 10; }
  else if (currentRSI > 70)                   { lynchNeg.push('Overbought — Lynch avoids overpriced growth stocks'); }
  else if (currentRSI < 35)                   { lynchNeg.push('Too beaten down — may not be a growth compounder yet'); }

  if (pricePosition >= 0.40 && pricePosition <= 0.75) { lynchScore += 20; lynchPos.push('Price in GARP sweet spot — growth at reasonable price'); }
  else if (pricePosition > 0.75)                       { lynchNeg.push('Too expensive for GARP — Lynch would wait for a pullback'); }

  if (aboveSMA20 && aboveSMA50) { lynchScore += 20; lynchPos.push('Above both moving averages — consistent growth trend'); }
  else if (aboveSMA50)          { lynchScore += 10; }
  else                          { lynchNeg.push('Below key averages — growth trend not established'); }

  if (trendConsistency > 0.60)      { lynchScore += 20; lynchPos.push('Strong trend consistency — hallmark of a ten-bagger candidate'); }
  else if (trendConsistency > 0.50) { lynchScore += 10; }
  else                               { lynchNeg.push('Inconsistent performance — not a steady compounder'); }

  if (sharpeProxy > 0.12) { lynchScore += 20; lynchPos.push('Excellent risk-adjusted returns — Lynch-style quality growth'); }
  else if (sharpeProxy > 0.05) { lynchScore += 10; }
  else { lynchNeg.push('Poor risk-adjusted returns — not yet a ten-bagger story'); }

  // ── 4. JOHN BOGLE — Index / Low-Cost / Long-Term / Diversification ────────
  let bogleScore = 0;
  const boglePos = [], bogleNeg = [];
  if (bbWidth < 0.05)      { bogleScore += 30; boglePos.push('Very low volatility — Bogle loves stable, predictable returns'); }
  else if (bbWidth < 0.09) { bogleScore += 15; boglePos.push('Moderate volatility — acceptable for long-term holding'); }
  else                     { bogleNeg.push('High volatility — Bogle prefers boring, stable returns'); }

  if (aboveSMA50 && goldenCross) { bogleScore += 30; boglePos.push('Strong long-term uptrend — ideal for stay-the-course investing'); }
  else if (aboveSMA50)           { bogleScore += 15; boglePos.push('Above 50-day average — medium-term trend supports holding'); }
  else                           { bogleNeg.push('Below key trend lines — not a comfortable long-term hold yet'); }

  if (trendConsistency > 0.55) { bogleScore += 20; boglePos.push('Consistent positive days — rewards patient, long-term investors'); }
  else                          { bogleNeg.push('Inconsistent performance — Bogle prefers steady market returns'); }

  if (volumeRatio < 1.4) { bogleScore += 20; boglePos.push('Normal volume — low speculation, genuine market price'); }
  else                    { bogleNeg.push('Elevated volume — possible speculation, not Bogle\'s style'); }

  // ── 5. BURTON MALKIEL — Efficient Market / Random Walk ───────────────────
  let malkielScore = 0;
  const malkielPos = [], malkielNeg = [];
  if (pricePosition >= 0.35 && pricePosition <= 0.65) { malkielScore += 30; malkielPos.push('Near fair value — efficient market pricing at work'); }
  else if (pricePosition < 0.25 || pricePosition > 0.80) { malkielNeg.push('At extremes — random walk suggests reversion to mean'); }

  if (bbWidth < 0.07)      { malkielScore += 25; malkielPos.push('Low volatility — market efficiently pricing the stock'); }
  else if (bbWidth > 0.14) { malkielNeg.push('High volatility — inefficient pricing, random walk likely'); }
  else                     { malkielScore += 12; }

  if (currentRSI >= 43 && currentRSI <= 57) { malkielScore += 25; malkielPos.push('RSI near neutral — perfectly efficient market equilibrium'); }
  else if (currentRSI < 35 || currentRSI > 70) { malkielNeg.push('RSI at extremes — market temporarily inefficient, expect reversion'); malkielScore += 10; }
  else { malkielScore += 12; }

  if (trendConsistency >= 0.45 && trendConsistency <= 0.60) { malkielScore += 20; malkielPos.push('Random-walk-like returns — validates efficient market hypothesis'); }
  else { malkielScore += 8; }

  // ── 6. CHARLIE MUNGER — Quality Moat / Cash Generation / Mental Models ────
  let mungerScore = 0;
  const mungerPos = [], mungerNeg = [];
  if (trendConsistency > 0.65) { mungerScore += 25; mungerPos.push('Exceptional trend consistency — strong competitive moat evident'); }
  else if (trendConsistency > 0.55) { mungerScore += 12; mungerPos.push('Good consistency — moderate moat, worth monitoring'); }
  else { mungerNeg.push('Inconsistent performance — moat may not be durable'); }

  if (sharpeProxy > 0.15) { mungerScore += 25; mungerPos.push('Excellent risk-adjusted returns — high-quality cash-generating business'); }
  else if (sharpeProxy > 0.08) { mungerScore += 12; mungerPos.push('Positive risk-adjusted returns — decent quality business'); }
  else { mungerNeg.push('Poor risk-adjusted returns — business quality questionable'); }

  if (pricePosition < 0.65) { mungerScore += 20; mungerPos.push('Below peak price — wonderful company at a fair price'); }
  else { mungerNeg.push('Near peak price — Munger says pay fair, not dear'); }

  if (aboveSMA50 && goldenCross) { mungerScore += 20; mungerPos.push('Golden cross with uptrend — business compounding is confirmed'); }
  else if (aboveSMA50)           { mungerScore += 10; }
  else                           { mungerNeg.push('Below key averages — business may be losing its compounding power'); }

  if (macdPositive) { mungerScore += 10; mungerPos.push('MACD positive — bullish momentum confirming business strength'); }
  else { mungerNeg.push('Weak MACD — momentum not supporting quality narrative yet'); }

  // ── 7. GEORGE SOROS — Reflexivity / Macro Momentum / Contrarian ──────────
  let sorosScore = 0;
  const sorosPos = [], sorosNeg = [];
  if (pricePosition > 0.70)      { sorosScore += 25; sorosPos.push('Near 52W high — reflexivity in action, trend feeding itself'); }
  else if (pricePosition > 0.50) { sorosScore += 12; sorosPos.push('Above mid-range — positive reflexivity starting'); }
  else if (pricePosition < 0.25) { sorosNeg.push('Near lows — negative reflexivity, trend could continue down'); }

  if (currentRSI >= 55 && currentRSI <= 78) { sorosScore += 25; sorosPos.push('RSI in momentum zone — Soros sweet spot for trend riding'); }
  else if (currentRSI > 78) { sorosNeg.push('RSI overbought — reflexive trend may be exhausted'); }
  else if (currentRSI < 45) { sorosNeg.push('Weak RSI — reflexivity not yet established'); }
  else { sorosScore += 10; }

  if (macdPositive) { sorosScore += 20; sorosPos.push('MACD bullish — trend continuation signal for reflexive bet'); }
  else              { sorosNeg.push('MACD not bullish — reflexive momentum not confirmed'); }

  if (volumeRatio > 1.8) { sorosScore += 20; sorosPos.push('Volume surge — institutional conviction, classic Soros entry signal'); }
  else if (volumeRatio > 1.3) { sorosScore += 10; sorosPos.push('Above-average volume — growing investor interest'); }
  else { sorosNeg.push('Low volume — lacks the conviction Soros looks for'); }

  if (sharpeProxy > 0.15) { sorosScore += 10; sorosPos.push('Strong risk-adjusted momentum — high-conviction trade setup'); }
  else if (sharpeProxy > 0.05) { sorosScore += 5; }

  // ── 8. STANLEY DRUCKENMILLER — Top-Down / High Conviction / 30% Returns ──
  let druckenmillerScore = 0;
  const druckPos = [], druckNeg = [];
  if (pricePosition > 0.65)      { druckenmillerScore += 25; druckPos.push('Near 52W high — Druckenmiller rides strong upward momentum'); }
  else if (pricePosition > 0.50) { druckenmillerScore += 12; druckPos.push('Above mid-range — momentum building for a high-conviction bet'); }
  else                           { druckNeg.push('Below mid-range — not the momentum Druckenmiller seeks'); }

  if (currentRSI >= 55 && currentRSI <= 75) { druckenmillerScore += 25; druckPos.push('RSI in momentum zone — strong but not overextended'); }
  else if (currentRSI > 75)                  { druckNeg.push('RSI overextended — Druckenmiller trims at extremes'); }
  else if (currentRSI < 45)                  { druckNeg.push('Weak RSI — lacks the momentum for a Druckenmiller-style bet'); }
  else                                        { druckenmillerScore += 10; }

  if (macdPositive && currentMACD?.histogram > 0) { druckenmillerScore += 20; druckPos.push('MACD strongly positive — trend confirmation for high-conviction entry'); }
  else if (macdPositive)                           { druckenmillerScore += 10; }
  else                                             { druckNeg.push('MACD not bullish — no momentum confirmation'); }

  if (volumeRatio > 1.7) { druckenmillerScore += 20; druckPos.push('High volume conviction — institutional players accumulating'); }
  else if (volumeRatio > 1.2) { druckenmillerScore += 10; druckPos.push('Above-average volume — smart money taking notice'); }
  else { druckNeg.push('Low volume — missing the institutional conviction Druckenmiller needs'); }

  if (goldenCross && aboveSMA50) { druckenmillerScore += 10; druckPos.push('Golden Cross confirmed — long-term momentum in full swing'); }
  else { druckNeg.push('No golden cross — long-term momentum not yet confirmed'); }

  // ── 9. CARL ICAHN — Activist / Beaten-Down / Unlock Shareholder Value ─────
  let icahnScore = 0;
  const icahnPos = [], icahnNeg = [];
  if (pricePosition < 0.30)      { icahnScore += 30; icahnPos.push('Deeply beaten down — classic Icahn activist opportunity territory'); }
  else if (pricePosition < 0.45) { icahnScore += 18; icahnPos.push('Below mid-range — potential undervaluation for activist campaign'); }
  else if (pricePosition > 0.75) { icahnNeg.push('Near highs — limited upside for activist unlock thesis'); }

  if (!aboveSMA50) { icahnScore += 20; icahnPos.push('Below 50-day average — stock is unloved, ripe for activist attention'); }
  else             { icahnNeg.push('Above trend average — may already be fairly priced'); }

  if (currentRSI < 35)      { icahnScore += 25; icahnPos.push('RSI deeply oversold — market has given up, activist discount confirmed'); }
  else if (currentRSI < 45) { icahnScore += 15; icahnPos.push('Below-neutral RSI — stock not loved by the market'); }
  else if (currentRSI > 60) { icahnNeg.push('RSI elevated — activist discount may not exist'); }

  if (volumeRatio > 1.5) { icahnScore += 15; icahnPos.push('Unusual volume — possible accumulation underway, Icahn-like activity'); }
  else if (volumeRatio > 1.1) { icahnScore += 8; }
  else { icahnNeg.push('Low volume — no signs of institutional accumulation yet'); }

  const upsidePct = (resistance - currentPrice) / currentPrice;
  if (upsidePct > 0.20) { icahnScore += 10; icahnPos.push('Large upside to resistance — significant shareholder value to unlock'); }
  else if (upsidePct > 0.10) { icahnScore += 5; }

  // ── 10. RAY DALIO — All-Weather / Risk Parity / Macro Cycles ─────────────
  let dalioScore = 0;
  const dalioPos = [], dalioNeg = [];
  if (currentRSI >= 42 && currentRSI <= 62) { dalioScore += 25; dalioPos.push('RSI balanced — all-weather zone, not overheated or panicked'); }
  else if (currentRSI < 30 || currentRSI > 75) { dalioNeg.push('RSI at extremes — not consistent with all-weather stability'); dalioScore += 5; }
  else { dalioScore += 12; }

  if (bbWidth < 0.07)      { dalioScore += 25; dalioPos.push('Low volatility — all-weather portfolio needs stable assets'); }
  else if (bbWidth < 0.12) { dalioScore += 12; dalioPos.push('Moderate volatility — manageable in a diversified portfolio'); }
  else                     { dalioNeg.push('High volatility — too risky for all-weather allocation'); }

  if (trendConsistency > 0.55) { dalioScore += 20; dalioPos.push('Consistent positive returns — ideal for risk-parity framework'); }
  else if (trendConsistency > 0.45) { dalioScore += 10; }
  else { dalioNeg.push('Inconsistent returns — does not fit Dalio\'s balanced portfolio'); }

  if (aboveSMA50) { dalioScore += 20; dalioPos.push('Above 50-day average — macro trend supports long position'); }
  else            { dalioNeg.push('Below trend average — macro cycle may be turning negative'); }

  if (pricePosition >= 0.30 && pricePosition <= 0.70) { dalioScore += 10; dalioPos.push('In middle of 52W range — balanced risk/reward for all-weather'); }
  else { dalioNeg.push('At price extremes — not ideal for balanced risk-parity allocation'); }

  // ── Quotes ────────────────────────────────────────────────────────────────
  const quotes = {
    graham: grahamScore >= 65
      ? '"The intelligent investor is a realist who sells to optimists and buys from pessimists."'
      : '"Price is what you pay. You must always have a margin of safety."',
    buffett: buffettScore >= 65
      ? '"Price is what you pay, value is what you get. This looks like value."'
      : '"Be fearful when others are greedy, and greedy when others are fearful."',
    lynch: lynchScore >= 65
      ? '"Go for a business that any idiot can run — because sooner or later, any idiot probably is going to run it."'
      : '"Know what you own, and know why you own it."',
    bogle: bogleScore >= 65
      ? '"Time is your friend; impulse is your enemy. Stay the course."'
      : '"Don\'t look for the needle in the haystack. Just buy the haystack."',
    malkiel: malkielScore >= 65
      ? '"A blindfolded monkey throwing darts… would select a portfolio that would do just as well."'
      : '"Most investors would be better off in an index fund."',
    munger: mungerScore >= 65
      ? '"It\'s not supposed to be easy. Anyone who finds it easy is stupid."'
      : '"All I want to know is where I\'m going to die, so I\'ll never go there."',
    soros: sorosScore >= 65
      ? '"Markets are constantly in a state of uncertainty and flux. Money is made by discounting the obvious."'
      : '"It\'s not whether you\'re right or wrong that matters, but how much money you make when you\'re right."',
    druckenmiller: druckenmillerScore >= 65
      ? '"The most important thing to me is preserving capital, and then making a lot of money."'
      : '"I\'ve learned many things from George Soros, but perhaps the most is that it\'s not whether you\'re right or wrong."',
    icahn: icahnScore >= 65
      ? '"In business, I look for economic castles protected by unbreachable moats."'
      : '"My father always said that if you want a friend on Wall Street, get a dog."',
    dalio: dalioScore >= 65
      ? '"The biggest mistake investors make is to believe that what happened in the recent past is likely to persist."'
      : '"He who lives by the crystal ball will eat shattered glass."',
  };

  // ── Build result ──────────────────────────────────────────────────────────
  const investors = {
    graham:        { score: Math.min(grahamScore,        100), rating: makeRating(grahamScore),        quote: quotes.graham,        positive: grahamPos,   negative: grahamNeg,   name: 'Benjamin Graham',      icon: '📚', philosophy: 'Value · Margin of Safety · Net-Net' },
    buffett:       { score: Math.min(buffettScore,       100), rating: makeRating(buffettScore),       quote: quotes.buffett,       positive: buffettPos,  negative: buffettNeg,  name: 'Warren Buffett',       icon: '🏦', philosophy: 'Value · Safety · Moat' },
    lynch:         { score: Math.min(lynchScore,         100), rating: makeRating(lynchScore),         quote: quotes.lynch,         positive: lynchPos,    negative: lynchNeg,    name: 'Peter Lynch',          icon: '📈', philosophy: 'Growth · GARP · Ten-Bagger' },
    bogle:         { score: Math.min(bogleScore,         100), rating: makeRating(bogleScore),         quote: quotes.bogle,         positive: boglePos,    negative: bogleNeg,    name: 'John Bogle',           icon: '📊', philosophy: 'Index · Low-Cost · Long-Term' },
    malkiel:       { score: Math.min(malkielScore,       100), rating: makeRating(malkielScore),       quote: quotes.malkiel,       positive: malkielPos,  negative: malkielNeg,  name: 'Burton Malkiel',       icon: '🎲', philosophy: 'Efficient Market · Random Walk' },
    munger:        { score: Math.min(mungerScore,        100), rating: makeRating(mungerScore),        quote: quotes.munger,        positive: mungerPos,   negative: mungerNeg,   name: 'Charlie Munger',       icon: '🔬', philosophy: 'Quality · Moat · Mental Models' },
    soros:         { score: Math.min(sorosScore,         100), rating: makeRating(sorosScore),         quote: quotes.soros,         positive: sorosPos,    negative: sorosNeg,    name: 'George Soros',         icon: '🌊', philosophy: 'Reflexivity · Macro · Momentum' },
    druckenmiller: { score: Math.min(druckenmillerScore, 100), rating: makeRating(druckenmillerScore), quote: quotes.druckenmiller, positive: druckPos,    negative: druckNeg,    name: 'Stanley Druckenmiller', icon: '⚡', philosophy: 'Top-Down · Macro · High Conviction' },
    icahn:         { score: Math.min(icahnScore,         100), rating: makeRating(icahnScore),         quote: quotes.icahn,         positive: icahnPos,    negative: icahnNeg,    name: 'Carl Icahn',           icon: '🦅', philosophy: 'Activist · Undervalued · Catalyst' },
    dalio:         { score: Math.min(dalioScore,         100), rating: makeRating(dalioScore),         quote: quotes.dalio,         positive: dalioPos,    negative: dalioNeg,    name: 'Ray Dalio',            icon: '🌐', philosophy: 'All-Weather · Risk Parity · Macro' },
    jhunjhunwala:  null, // computed below for backward compat
  };

  // Keep original Jhunjhunwala engine (India-specific)
  let rjScore = 0;
  const rjPos = [], rjNeg = [];
  if (pricePosition > 0.75)      { rjScore += 25; rjPos.push('Near 52-week high — strong market leadership & momentum'); }
  else if (pricePosition > 0.50) { rjScore += 12; rjPos.push('Above mid-range — positive momentum building'); }
  else                           { rjNeg.push('Well below 52-week high — momentum not yet established'); }
  if (currentRSI >= 55 && currentRSI <= 72) { rjScore += 20; rjPos.push('RSI in momentum zone (55–72) — classic RJ sweet spot'); }
  else if (currentRSI >= 45 && currentRSI < 55) { rjScore += 8; rjPos.push('RSI building — watch for breakout'); }
  else if (currentRSI > 72)      { rjNeg.push('RSI overbought — short-term pullback risk'); }
  else                           { rjNeg.push('Low RSI — momentum not supportive of entry'); }
  if (macdPositive) { rjScore += 20; rjPos.push('MACD positive — bullish momentum confirmed'); }
  else              { rjNeg.push('MACD not bullish — wait for momentum turn'); }
  if (sharpeProxy > 0.15) { rjScore += 20; rjPos.push('Excellent risk-adjusted returns — high-quality growth stock'); }
  else if (sharpeProxy > 0.05) { rjScore += 10; rjPos.push('Positive risk-adjusted returns — decent growth potential'); }
  else { rjNeg.push('Poor risk-adjusted returns — growth story not playing out'); }
  if (volumeRatio > 1.8)      { rjScore += 15; rjPos.push('Volume surge — institutional conviction and accumulation'); }
  else if (volumeRatio > 1.2) { rjScore += 8;  rjPos.push('Above-average volume — growing investor interest'); }
  else                        { rjNeg.push('Low volume — institutional participation limited'); }
  const rjRating = makeRating(rjScore);
  const rjQuote = rjScore >= 75
    ? '"I am bullish on India. This stock has the growth story written all over it."'
    : rjScore >= 55 ? '"Be a buyer of businesses that ride the India growth wave."'
    : '"Patience is the key. Wait for the right entry in a good business."';
  investors.jhunjhunwala = { score: Math.min(rjScore, 100), rating: rjRating, quote: rjQuote, positive: rjPos, negative: rjNeg, name: 'Rakesh Jhunjhunwala', icon: '🇮🇳', philosophy: 'Growth · Momentum · India Story' };

  // ── Consensus ─────────────────────────────────────────────────────────────
  const allScores = Object.values(investors).map(inv => inv.score);
  const avgScore  = Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length);
  const buyCount  = Object.values(investors).filter(inv => inv.rating.includes('BUY')).length;
  const consensus = buyCount >= 8 ? 'STRONG BUY' : buyCount >= 6 ? 'BUY' : buyCount >= 4 ? 'HOLD' : buyCount >= 2 ? 'WATCH' : 'AVOID';

  // ── Derived metrics ───────────────────────────────────────────────────────
  const metrics = {
    pricePosition:      round2(pricePosition * 100),
    trendConsistency:   round2(trendConsistency * 100),
    volatilityPct:      round2(stdDev * 100),
    returnPct30d:       round2(avgReturn * 100 * 30),
    priceVsSupport:     round2(((currentPrice - support) / support) * 100),
    upsideToResistance: round2(((resistance - currentPrice) / currentPrice) * 100),
    sharpeProxy:        round2(sharpeProxy),
  };

  return { ...investors, consensus: { score: avgScore, rating: consensus, buyCount, totalInvestors: 11 }, metrics };
}

// ── News Sentiment ────────────────────────────────────────────────────────────
const POSITIVE_KEYWORDS = ['surge', 'gain', 'profit', 'buy', 'upgrade', 'beat', 'record', 'rally',
  'soar', 'jump', 'rise', 'high', 'strong', 'growth', 'positive', 'bullish', 'outperform',
  'dividend', 'boost', 'breakout', 'boom', 'upbeat', 'expand', 'acquire', 'win', 'award'];
const NEGATIVE_KEYWORDS = ['slump', 'fall', 'loss', 'sell', 'downgrade', 'miss', 'risk', 'drop',
  'decline', 'crash', 'down', 'weak', 'bearish', 'underperform', 'concern', 'worry', 'cut',
  'warn', 'fear', 'plunge', 'halt', 'probe', 'fraud', 'penalty', 'fine', 'recall', 'layoff'];

function analyzeSentiment(text) {
  const lower = text.toLowerCase();
  let pos = 0, neg = 0;
  for (const kw of POSITIVE_KEYWORDS) if (lower.includes(kw)) pos++;
  for (const kw of NEGATIVE_KEYWORDS) if (lower.includes(kw)) neg++;
  return pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
}

async function fetchStockNews(symbol, companyName) {
  const q = companyName
    ? `${companyName} stock NSE India`
    : `${cleanSymbol(symbol)} NSE stock India`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await axios.get(url, { headers: YF_HEADERS, timeout: 10000 });

  const items = [];
  const RE = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = RE.exec(res.data)) !== null && items.length < 10) {
    const chunk   = m[1];
    const title   = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(chunk) || /<title>(.*?)<\/title>/.exec(chunk))?.[1]?.trim() || '';
    const link    = (/<link>(.*?)<\/link>/.exec(chunk)   || [])[1]?.trim() || '';
    const pubDate = (/<pubDate>(.*?)<\/pubDate>/.exec(chunk) || [])[1]?.trim() || '';
    const source  = (/<source[^>]*>(.*?)<\/source>/.exec(chunk) || [])[1]?.trim() || '';
    if (!title) continue;
    items.push({ title, link, pubDate, source, sentiment: analyzeSentiment(title) });
  }
  return items;
}

// ── Candlestick Pattern Detection ─────────────────────────────────────────────
function detectCandlestickPatterns(history) {
  const candles = history.slice(-10);
  const found = [];

  for (let i = 2; i < candles.length; i++) {
    const c1  = candles[i - 2];
    const c2  = candles[i - 1];
    const cur = candles[i];
    if (!cur.open || !cur.close || !cur.high || !cur.low) continue;

    const body    = Math.abs(cur.close - cur.open);
    const range   = (cur.high - cur.low) || 0.01;
    const upper   = cur.high - Math.max(cur.open, cur.close);
    const lower   = Math.min(cur.open, cur.close) - cur.low;
    const isBull  = cur.close >= cur.open;

    if (body / range < 0.10)
      found.push({ name: 'Doji', type: 'neutral', signal: 'WATCH', desc: 'Indecision candle — potential reversal ahead' });

    if (lower > 2 * body && upper < body * 0.5 && isBull)
      found.push({ name: 'Hammer', type: 'bullish', signal: 'BUY', desc: 'Bullish reversal — buyers absorbing selling pressure' });

    if (upper > 2 * body && lower < body * 0.5 && !isBull)
      found.push({ name: 'Shooting Star', type: 'bearish', signal: 'SELL', desc: 'Bearish reversal — selling pressure at highs' });

    if (lower > 2 * body && upper < body * 0.5 && !isBull)
      found.push({ name: 'Hanging Man', type: 'bearish', signal: 'SELL', desc: 'Bearish warning at highs — distribution possible' });

    if (upper > 2 * body && lower < body * 0.5 && isBull)
      found.push({ name: 'Inverted Hammer', type: 'bullish', signal: 'BUY', desc: 'Potential bullish reversal — watch for confirmation' });

    if (c2.open && c2.close < c2.open && isBull && cur.close > c2.open && cur.open < c2.close)
      found.push({ name: 'Bullish Engulfing', type: 'bullish', signal: 'STRONG BUY', desc: 'Strong bullish reversal — buyers fully in control' });

    if (c2.open && c2.close > c2.open && !isBull && cur.close < c2.open && cur.open > c2.close)
      found.push({ name: 'Bearish Engulfing', type: 'bearish', signal: 'STRONG SELL', desc: 'Strong bearish reversal — sellers fully in control' });

    if (c1.open && c1.close < c1.open &&
        Math.abs(c2.close - c2.open) < Math.abs(c1.close - c1.open) * 0.4 &&
        isBull && cur.close > c1.open + (c1.close - c1.open) * 0.5)
      found.push({ name: 'Morning Star', type: 'bullish', signal: 'STRONG BUY', desc: '3-candle bullish reversal — high-reliability pattern' });

    if (c1.open && c1.close > c1.open &&
        Math.abs(c2.close - c2.open) < Math.abs(c1.close - c1.open) * 0.4 &&
        !isBull && cur.close < c1.close - (c1.close - c1.open) * 0.5)
      found.push({ name: 'Evening Star', type: 'bearish', signal: 'STRONG SELL', desc: '3-candle bearish reversal — high-reliability pattern' });
  }

  const seen = new Set();
  return found.filter(p => seen.has(p.name) ? false : (seen.add(p.name), true)).slice(0, 4);
}

// ── Fibonacci Retracement ─────────────────────────────────────────────────────
function computeFibonacci(history) {
  const slice = history.slice(-60);
  const hs = slice.map(d => d.high).filter(Boolean);
  const ls = slice.map(d => d.low).filter(Boolean);
  if (!hs.length || !ls.length) return null;
  const high = Math.max(...hs);
  const low  = Math.min(...ls);
  const diff = high - low;
  return {
    high:     round2(high),
    low:      round2(low),
    level236: round2(high - diff * 0.236),
    level382: round2(high - diff * 0.382),
    level500: round2(high - diff * 0.500),
    level618: round2(high - diff * 0.618),
    level786: round2(high - diff * 0.786),
  };
}

// ── AI Summary ────────────────────────────────────────────────────────────────
function generateAISummary({ quote, analysis, patterns, weeklySignal }) {
  const { signal, indicators, targets, investorScores } = analysis;
  const { buffett, jhunjhunwala } = investorScores;
  const name = (quote.name || cleanSymbol(quote.symbol)).split(' ').slice(0, 3).join(' ');
  const price = round2(quote.price);
  const dir   = quote.change >= 0 ? 'up' : 'down';
  const parts = [];

  parts.push(`${name} is trading at ₹${price}, ${dir} ${Math.abs(quote.changePercent || 0).toFixed(2)}% today.`);

  if (indicators.rsi < 30)      parts.push(`RSI at ${indicators.rsi} is deeply oversold — a bounce is highly probable.`);
  else if (indicators.rsi > 70) parts.push(`RSI at ${indicators.rsi} is overbought — expect profit booking soon.`);
  else parts.push(`RSI at ${indicators.rsi} is in a ${indicators.rsi > 50 ? 'mildly bullish' : 'mildly bearish'} neutral zone.`);

  parts.push(price > indicators.sma50
    ? 'Price is above the 50-day moving average, confirming a medium-term uptrend.'
    : 'Price is below the 50-day moving average — medium-term trend remains bearish.');

  if (indicators.macd?.histogram > 0) parts.push('MACD histogram is positive — bullish momentum is building.');
  else parts.push('MACD histogram is negative — bearish momentum is dominant.');

  if (indicators.adx && indicators.adx > 25) parts.push(`ADX at ${indicators.adx} confirms a strong trend — signals are more reliable.`);

  if (buffett.score >= 65 && jhunjhunwala.score >= 65)
    parts.push(`Both investor models are bullish: Buffett value score ${buffett.score}/100, RJ momentum score ${jhunjhunwala.score}/100.`);
  else if (buffett.score >= 65)
    parts.push(`Buffett value model (${buffett.score}/100) sees a good entry, but RJ momentum model suggests waiting.`);
  else if (jhunjhunwala.score >= 65)
    parts.push(`RJ momentum model (${jhunjhunwala.score}/100) is positive, but value investors may seek a lower entry.`);
  else
    parts.push(`Both investor models are cautious at current levels (Buffett: ${buffett.score}/100, RJ: ${jhunjhunwala.score}/100).`);

  const bullPat = patterns.find(p => p.type === 'bullish');
  const bearPat = patterns.find(p => p.type === 'bearish');
  if (bullPat)  parts.push(`Chart pattern: ${bullPat.name} detected — ${bullPat.desc.toLowerCase()}`);
  else if (bearPat) parts.push(`Chart pattern: ${bearPat.name} detected — ${bearPat.desc.toLowerCase()}`);

  if (weeklySignal) {
    if (signal.includes('BUY') && weeklySignal.includes('BUY'))
      parts.push('Multi-timeframe confluence: both daily and weekly charts are bullish — strong conviction.');
    else if (signal.includes('SELL') && weeklySignal.includes('SELL'))
      parts.push('Multi-timeframe: both daily and weekly are bearish — high conviction sell.');
    else
      parts.push('Daily and weekly timeframes are diverging — wait for alignment before entering.');
  }

  parts.push(`Key target: ₹${targets.target1} | Stop loss: ₹${targets.stopLoss}. Verdict: ${signal}.`);
  return parts.join(' ');
}

// ── Buy Today Cache ───────────────────────────────────────────────────────────
let buyTodayCache = { data: null, ts: 0 };

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/stock/:symbol', async (req, res) => {
  try {
    let symbol = req.params.symbol.toUpperCase();
    if (!symbol.endsWith('.NS') && !symbol.endsWith('.BO')) symbol += '.NS';

    const [dailyResult, weeklyResult] = await Promise.allSettled([
      fetchChartData(symbol, '6mo', '1d'),
      fetchChartData(symbol, '1y',  '1wk'),
    ]);

    if (dailyResult.status === 'rejected') throw dailyResult.reason;
    const { quote, history } = dailyResult.value;

    const analysis  = analyzeStock(history);
    const patterns  = detectCandlestickPatterns(history);
    const fibonacci = computeFibonacci(history);

    let weeklyAnalysis = null;
    if (weeklyResult.status === 'fulfilled' && weeklyResult.value.history.length >= 26) {
      const wa = analyzeStock(weeklyResult.value.history);
      weeklyAnalysis = { signal: wa.signal, strength: wa.strength, rsi: wa.indicators.rsi };
    }

    const aiSummary = generateAISummary({
      quote, analysis, patterns,
      weeklySignal: weeklyAnalysis?.signal || null,
    });

    res.json({ ...quote, analysis, chartData: history.slice(-60), patterns, fibonacci, weeklyAnalysis, aiSummary });
  } catch (err) {
    console.error('Stock error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stock data: ' + err.message });
  }
});

app.get('/api/popular', async (req, res) => {
  try {
    res.json(await fetchQuotesBatch(POPULAR_STOCKS));
  } catch (err) {
    console.error('Popular error:', err.message);
    res.status(500).json({ error: 'Failed to fetch popular stocks' });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.json([]);
    const results = await searchStocks(query);
    const filtered = results
      .filter(q => q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO') || q.exchange === 'NSI' || q.exchange === 'BSE'))
      .slice(0, 10)
      .map(q => ({ symbol: q.symbol, name: q.shortname || q.longname || q.symbol, exchange: q.exchange }));
    res.json(filtered);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/indices', async (req, res) => {
  try {
    res.json(await fetchQuotesBatch(INDICES));
  } catch (err) {
    console.error('Indices error:', err.message);
    res.status(500).json({ error: 'Failed to fetch indices' });
  }
});

app.get('/api/sectors', async (req, res) => {
  try {
    const allSymbols = Object.values(SECTORS).flat();
    const quotes = await fetchQuotesBatch(allSymbols);
    const quoteMap = Object.fromEntries(quotes.map(q => [q.symbol, q]));

    const result = Object.entries(SECTORS).map(([sector, symbols]) => {
      const stocks   = symbols.map(sym => quoteMap[sym]).filter(Boolean);
      const avgChange = stocks.length
        ? round2(stocks.reduce((s, q) => s + (q.changePercent || 0), 0) / stocks.length)
        : 0;
      return { sector, avgChange, stocks: stocks.map(s => ({ symbol: s.symbol, name: s.name, price: s.price, changePercent: s.changePercent })) };
    });

    res.json(result);
  } catch (err) {
    console.error('Sectors error:', err.message);
    res.status(500).json({ error: 'Failed to fetch sector data' });
  }
});

app.get('/api/buy-today', async (req, res) => {
  try {
    const now = Date.now();
    // Serve cached result if fresh (30 min)
    if (buyTodayCache.data && now - buyTodayCache.ts < 30 * 60 * 1000) {
      return res.json(buyTodayCache.data);
    }

    // Analyse all popular stocks in small batches to find BUY signals
    const candidates = [];
    const BATCH = 3, DELAY = 150;
    for (let i = 0; i < POPULAR_STOCKS.length; i += BATCH) {
      const batch = POPULAR_STOCKS.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (symbol) => {
          const { quote, history } = await fetchChartData(symbol, '3mo', '1d');
          if (history.length < 26) return null;
          const analysis = analyzeStock(history);
          if (!analysis.signal.includes('BUY')) return null;
          const patterns = detectCandlestickPatterns(history);
          return { ...quote, analysis, patterns };
        })
      );
      results.forEach(r => { if (r.status === 'fulfilled' && r.value) candidates.push(r.value); });
      if (i + BATCH < POPULAR_STOCKS.length) await new Promise(r => setTimeout(r, DELAY));
    }

    // Take top 5 by signal strength
    const top = candidates
      .sort((a, b) => b.analysis.strength - a.analysis.strength)
      .slice(0, 5);

    // Enrich with news sentiment
    const withNews = await Promise.allSettled(
      top.map(async (stock) => {
        try {
          const newsItems = await fetchStockNews(stock.symbol, stock.name);
          const pos = newsItems.filter(n => n.sentiment === 'positive').length;
          const neg = newsItems.filter(n => n.sentiment === 'negative').length;
          return {
            ...stock,
            news: newsItems.slice(0, 2),
            newsSentiment: pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral',
            newsScore: pos - neg,
          };
        } catch {
          return { ...stock, news: [], newsSentiment: 'neutral', newsScore: 0 };
        }
      })
    );

    const result = withNews.filter(r => r.status === 'fulfilled').map(r => r.value);
    buyTodayCache = { data: result, ts: now };
    res.json(result);
  } catch (err) {
    console.error('Buy today error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/news/:symbol', async (req, res) => {
  try {
    let symbol = req.params.symbol.toUpperCase();
    if (!symbol.endsWith('.NS') && !symbol.endsWith('.BO')) symbol += '.NS';
    const companyName = req.query.name || '';

    const news = await fetchStockNews(symbol, companyName);

    const positiveCount = news.filter(n => n.sentiment === 'positive').length;
    const negativeCount = news.filter(n => n.sentiment === 'negative').length;
    const overallSentiment = positiveCount > negativeCount ? 'positive'
      : negativeCount > positiveCount ? 'negative' : 'neutral';
    const newsSignal = positiveCount >= 3 ? 'BUY' : negativeCount >= 3 ? 'AVOID' : 'NEUTRAL';

    res.json({ news, overallSentiment, newsSignal, positiveCount, negativeCount });
  } catch (err) {
    console.error('News error:', err.message);
    res.status(500).json({ error: 'Failed to fetch news: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`StockPulse AI → http://localhost:${PORT}`));
