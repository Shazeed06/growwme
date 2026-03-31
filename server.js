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

// ── Warren Buffett & Rakesh Jhunjhunwala Scoring ─────────────────────────────
function computeInvestorScores({ closes, highs, lows, volumes, currentPrice,
  currentRSI, currentMACD, currentSMA20, currentSMA50, currentBB, volumeRatio,
  resistance, support }) {

  const w52High = Math.max(...highs.slice(-252).length ? highs.slice(-252) : highs);
  const w52Low  = Math.min(...lows.slice(-252).length  ? lows.slice(-252)  : lows);
  const range   = w52High - w52Low || 1;
  const pricePosition = (currentPrice - w52Low) / range; // 0 = at low, 1 = at high

  // Daily returns (for volatility / consistency)
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const recent30Returns = returns.slice(-30);
  const avgReturn = recent30Returns.reduce((a, b) => a + b, 0) / (recent30Returns.length || 1);
  const stdDev    = Math.sqrt(recent30Returns.reduce((a, b) => a + (b - avgReturn) ** 2, 0) / (recent30Returns.length || 1));
  const sharpeProxy = stdDev > 0 ? (avgReturn / stdDev) : 0; // Higher = better risk-adjusted return

  // Trend consistency: % of last 20 days that closed up
  const last20Returns = returns.slice(-20);
  const positiveDays  = last20Returns.filter(r => r > 0).length;
  const trendConsistency = positiveDays / (last20Returns.length || 1); // 0–1

  // Bollinger band width (volatility proxy)
  const bbWidth = currentBB ? (currentBB.upper - currentBB.lower) / currentBB.middle : 0.1;

  // Price vs SMA proximity (trend health)
  const aboveSMA20 = currentPrice > currentSMA20;
  const aboveSMA50 = currentPrice > currentSMA50;
  const goldenCross = currentSMA20 > currentSMA50;

  // MACD histogram trend (last 3 bars)
  const macdPositive = currentMACD && currentMACD.histogram > 0;

  // ────────────────────────────────────────────────────────────────────────────
  // WARREN BUFFETT SCORE  (Value + Safety + Quality)
  // Philosophy: "Buy wonderful companies at fair prices; focus on durable moat,
  //              low debt, consistent earnings, and a margin of safety."
  // ────────────────────────────────────────────────────────────────────────────
  let buffettScore = 0;
  const buffettInsights = [];
  const buffettPositive = [];
  const buffettNegative = [];

  // 1. Value zone: Price in lower half of 52W range (Margin of Safety)
  if (pricePosition < 0.35) {
    buffettScore += 25;
    buffettPositive.push('Trading near 52-week lows — classic margin of safety');
  } else if (pricePosition < 0.55) {
    buffettScore += 15;
    buffettPositive.push('Price in fair-value zone — reasonable entry point');
  } else if (pricePosition > 0.85) {
    buffettNegative.push('Trading near 52-week highs — limited margin of safety');
  }

  // 2. Low volatility (Buffett hates unpredictable businesses)
  if (bbWidth < 0.05) {
    buffettScore += 20;
    buffettPositive.push('Low price volatility — signals stable, predictable business');
  } else if (bbWidth < 0.10) {
    buffettScore += 10;
    buffettPositive.push('Moderate volatility — business reasonably stable');
  } else {
    buffettNegative.push('High volatility — Buffett avoids unpredictable price swings');
  }

  // 3. Trend quality (consistent uptrend = durable competitive advantage)
  if (trendConsistency > 0.65) {
    buffettScore += 20;
    buffettPositive.push('Consistent upward trend — signs of strong competitive moat');
  } else if (trendConsistency > 0.50) {
    buffettScore += 10;
    buffettPositive.push('Mostly positive trend — moderate business strength');
  } else {
    buffettNegative.push('Inconsistent price trend — uncertain business performance');
  }

  // 4. Established long-term trend (SMA50)
  if (aboveSMA50 && goldenCross) {
    buffettScore += 20;
    buffettPositive.push('Golden Cross active — long-term uptrend intact');
  } else if (aboveSMA50) {
    buffettScore += 10;
    buffettPositive.push('Above 50-day average — medium-term trend positive');
  } else {
    buffettNegative.push('Below 50-day average — long-term trend weakening');
  }

  // 5. RSI in non-speculative zone (Buffett avoids frothy stocks)
  if (currentRSI >= 35 && currentRSI <= 60) {
    buffettScore += 15;
    buffettPositive.push('RSI in healthy zone — stock not overbought or in panic');
  } else if (currentRSI < 35) {
    buffettScore += 8;
    buffettPositive.push('Oversold RSI — potential value opportunity emerging');
  } else {
    buffettNegative.push('Elevated RSI — stock may be overvalued, reduced margin of safety');
  }

  const buffettRating =
    buffettScore >= 75 ? 'STRONG BUY'  :
    buffettScore >= 55 ? 'BUY'         :
    buffettScore >= 40 ? 'HOLD'        :
    buffettScore >= 25 ? 'WATCH'       : 'AVOID';

  const buffettQuote =
    buffettScore >= 75 ? '"Price is what you pay, value is what you get. This looks like value."' :
    buffettScore >= 55 ? '"Be fearless when others are fearful. A reasonable entry is forming."' :
    buffettScore >= 40 ? '"Only buy something you\'d be perfectly happy to hold for 10 years."' :
                         '"The stock market is a device for transferring money from the impatient to the patient."';

  // ────────────────────────────────────────────────────────────────────────────
  // RAKESH JHUNJHUNWALA SCORE  (Growth + Momentum + India Story)
  // Philosophy: "Invest in high-growth companies with strong management;
  //              ride the India growth story with conviction."
  // ────────────────────────────────────────────────────────────────────────────
  let rjScore = 0;
  const rjPositive = [];
  const rjNegative = [];

  // 1. Strong momentum (RJ loved high-momentum, near-52W-high stocks)
  if (pricePosition > 0.75) {
    rjScore += 25;
    rjPositive.push('Near 52-week high — strong market leadership & momentum');
  } else if (pricePosition > 0.50) {
    rjScore += 12;
    rjPositive.push('Above mid-range — positive momentum building');
  } else {
    rjNegative.push('Well below 52-week high — momentum not yet established');
  }

  // 2. RSI in momentum zone (RJ bought strength, not weakness)
  if (currentRSI >= 55 && currentRSI <= 72) {
    rjScore += 20;
    rjPositive.push('RSI in momentum zone (55–72) — classic RJ sweet spot');
  } else if (currentRSI >= 45 && currentRSI < 55) {
    rjScore += 8;
    rjPositive.push('RSI building momentum — watch for breakout');
  } else if (currentRSI > 72) {
    rjNegative.push('RSI overbought — short-term pullback risk');
  } else {
    rjNegative.push('Low RSI — momentum not supportive of entry');
  }

  // 3. MACD bullish (trend continuation signal)
  if (macdPositive) {
    rjScore += 20;
    rjPositive.push('MACD positive — bullish momentum confirmed');
  } else {
    rjNegative.push('MACD not bullish — wait for momentum to turn positive');
  }

  // 4. Sharpe-like ratio (RJ focused on quality of returns)
  if (sharpeProxy > 0.15) {
    rjScore += 20;
    rjPositive.push('Excellent risk-adjusted returns — high-quality growth stock');
  } else if (sharpeProxy > 0.05) {
    rjScore += 10;
    rjPositive.push('Positive risk-adjusted returns — decent growth potential');
  } else {
    rjNegative.push('Poor risk-adjusted returns — growth story not yet playing out');
  }

  // 5. Volume surge (RJ watched for institutional conviction)
  if (volumeRatio > 1.8) {
    rjScore += 15;
    rjPositive.push('Volume surge detected — institutional conviction and accumulation');
  } else if (volumeRatio > 1.2) {
    rjScore += 8;
    rjPositive.push('Above-average volume — growing investor interest');
  } else {
    rjNegative.push('Low volume — institutional participation limited');
  }

  const rjRating =
    rjScore >= 75 ? 'STRONG BUY'  :
    rjScore >= 55 ? 'BUY'         :
    rjScore >= 40 ? 'HOLD'        :
    rjScore >= 25 ? 'WATCH'       : 'AVOID';

  const rjQuote =
    rjScore >= 75 ? '"I am bullish on India. This stock has the growth story written all over it."' :
    rjScore >= 55 ? '"Be a buyer of businesses that ride the India growth wave."'                    :
    rjScore >= 40 ? '"Patience is the key. Wait for the right entry in a good business."'            :
                    '"Don\'t fight the trend. Wait for the momentum to establish itself."';

  // ── Derived fundamental proxies ──
  const priceChangeVsSupport   = round2(((currentPrice - support) / support) * 100);
  const priceChangeVsResistance = round2(((resistance - currentPrice) / currentPrice) * 100);
  const uptrendStrength = round2(trendConsistency * 100);
  const volatilityPct   = round2(stdDev * 100);
  const returnPct30d    = round2(avgReturn * 100 * 30); // annualised 30d

  return {
    buffett: {
      score:    Math.min(buffettScore, 100),
      rating:   buffettRating,
      quote:    buffettQuote,
      positive: buffettPositive,
      negative: buffettNegative,
    },
    jhunjhunwala: {
      score:    Math.min(rjScore, 100),
      rating:   rjRating,
      quote:    rjQuote,
      positive: rjPositive,
      negative: rjNegative,
    },
    metrics: {
      pricePosition:         round2(pricePosition * 100),  // % of 52W range
      trendConsistency:      uptrendStrength,               // % positive days (20d)
      volatilityPct,                                        // daily std dev %
      returnPct30d,                                         // approx 30d return %
      priceVsSupport:        priceChangeVsSupport,          // % above support
      upsideToResistance:    priceChangeVsResistance,       // % to resistance
      sharpeProxy:           round2(sharpeProxy),
    },
  };
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
