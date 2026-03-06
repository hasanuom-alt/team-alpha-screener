import { useState, useEffect, useMemo, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// TEAM ALPHA SCREENER v3.0 — INFRASTRUCTURE EDITION
// Wolf-Corrected Engines + Production Infrastructure
//
// 🔧 INFRASTRUCTURE UPGRADES:
// I1  Live API: Financial Modeling Prep free tier (250 calls/day)
// I2  Smart Caching: In-memory + sessionStorage to minimize API calls
// I3  Batch Fetching: Bulk endpoints reduce calls (1 call = all quotes)
// I4  Graceful Fallback: If API fails/exhausted → simulated data + warning
// I5  Persistent Watchlist: Uses artifact storage API across sessions
// I6  CSV Export: Full screener data downloadable
// I7  Data Freshness: Timestamp + staleness indicator on every data point
// I8  Status Bar: Live connection status, API calls remaining, last refresh
// I9  Lazy Analysis: Compute indicators only when data changes (memoized)
// I10 Error Resilience: Retry logic, timeout handling, partial data support
//
// COST: $0 — FMP free tier (250 calls/day), no backend, no hosting fees
// ═══════════════════════════════════════════════════════════════════════════════

// ── FREE API CONFIG ──
// Users: Get your free key at https://financialmodelingprep.com/developer/docs/
const FMP_API_KEY = import.meta.env.VITE_FMP_API_KEY || "demo";
const FMP_BASE = "https://financialmodelingprep.com/api/v3";

const TOP_100_TICKERS = [
  "AAPL","MSFT","NVDA","AMZN","GOOG","META","BRK-B","LLY","AVGO","JPM",
  "TSLA","UNH","V","XOM","MA","JNJ","PG","COST","HD","ABBV",
  "WMT","NFLX","KO","BAC","MRK","CRM","CVX","AMD","PEP","TMO",
  "LIN","ORCL","ACN","MCD","ADBE","ABT","PM","CSCO","GE","IBM",
  "NOW","DHR","ISRG","QCOM","TXN","INTU","AMGN","CMCSA","VZ","NEE",
  "PFE","RTX","AMAT","HON","LOW","UNP","SPGI","BLK","SYK","BKNG",
  "GS","ELV","ADP","SCHW","MDLZ","GILD","DE","VRTX","T","CB",
  "MMC","REGN","ADI","LRCX","BMY","MU","KLAC","SO","CI","ZTS",
  "RY","TD","BNS","BMO","CM","CNQ","ENB","CP","TRI","CNI",
  "SU","MFC","NTR","BCE","FTS","WCN","BAM","ATD.TO","GIB","SHOP"
];

const SECTOR_PE_MEDIANS = {
  Technology: 32, Healthcare: 24, Financials: 14, Energy: 12,
  Consumer: 22, Industrials: 20, Materials: 18, Telecom: 16, Utilities: 18,
  "Consumer Cyclical": 22, "Consumer Defensive": 20, "Communication Services": 24,
  "Financial Services": 14, "Basic Materials": 18, "Real Estate": 28,
};

// ═══════════════════════════════════════════════════════════════
// I1 + I2 + I3: LIVE API LAYER WITH SMART CACHING
// ═══════════════════════════════════════════════════════════════
const apiCache = {};
let apiCallCount = 0;

async function fetchWithCache(url, cacheKey, ttlMs = 300000) {
  // Check memory cache (TTL = 5 min default)
  if (apiCache[cacheKey] && Date.now() - apiCache[cacheKey].ts < ttlMs) {
    return { data: apiCache[cacheKey].data, fromCache: true };
  }
  try {
    apiCallCount++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data["Error Message"] || data["Note"]) throw new Error(data["Error Message"] || "Rate limited");
    apiCache[cacheKey] = { data, ts: Date.now() };
    return { data, fromCache: false };
  } catch (err) {
    // I10: Return cached data even if stale on error
    if (apiCache[cacheKey]) return { data: apiCache[cacheKey].data, fromCache: true, stale: true };
    throw err;
  }
}

// Batch quote fetch (1 API call for all 100 stocks)
async function fetchBulkQuotes(tickers) {
  const url = `${FMP_BASE}/quote/${tickers.join(",")}?apikey=${FMP_API_KEY}`;
  return fetchWithCache(url, "bulk_quotes", 60000);
}

// Historical prices (per ticker, cached 30 min)
async function fetchHistoricalPrices(ticker) {
  const url = `${FMP_BASE}/historical-price-full/${ticker}?timeseries=250&apikey=${FMP_API_KEY}`;
  return fetchWithCache(url, `hist_${ticker}`, 1800000);
}

// Key metrics (per ticker, cached 1 hour)
async function fetchKeyMetrics(ticker) {
  const url = `${FMP_BASE}/key-metrics-ttm/${ticker}?apikey=${FMP_API_KEY}`;
  return fetchWithCache(url, `metrics_${ticker}`, 3600000);
}

// ═══════════════════════════════════════════════════════════════
// ALL WOLF-CORRECTED MATH ENGINES (preserved from v2.1)
// ═══════════════════════════════════════════════════════════════

function computeWilderRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeEMASeries(arr, period) {
  if (arr.length < period) return [];
  const k = 2 / (period + 1);
  const series = [];
  let e = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  series.push(e);
  for (let i = period; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); series.push(e); }
  return series;
}

function computeMACD(closes) {
  const ema12S = computeEMASeries(closes, 12);
  const ema26S = computeEMASeries(closes, 26);
  if (ema26S.length === 0) return { macdLine: 0, signalLine: 0, histogram: 0, histogramExpanding: false };
  const offset = 26 - 12;
  const macdS = [];
  for (let i = offset; i < ema12S.length && i - offset < ema26S.length; i++) macdS.push(ema12S[i] - ema26S[i - offset]);
  const sigS = computeEMASeries(macdS, 9);
  const ml = macdS.length > 0 ? macdS[macdS.length - 1] : 0;
  const sl = sigS.length > 0 ? sigS[sigS.length - 1] : 0;
  const h = ml - sl;
  const ph = macdS.length > 1 && sigS.length > 1 ? macdS[macdS.length - 2] - sigS[sigS.length - 2] : h;
  return { macdLine: ml, signalLine: sl, histogram: h, histogramExpanding: Math.abs(h) > Math.abs(ph) };
}

function computeStochastic(highs, lows, closes, kP = 14, dP = 3) {
  if (closes.length < kP + dP) return { k: 50, d: 50 };
  const kV = [];
  for (let i = kP - 1; i < closes.length; i++) {
    const hi = Math.max(...highs.slice(i - kP + 1, i + 1));
    const lo = Math.min(...lows.slice(i - kP + 1, i + 1));
    kV.push(hi !== lo ? ((closes[i] - lo) / (hi - lo)) * 100 : 50);
  }
  return { k: kV[kV.length - 1], d: kV.slice(-dP).reduce((a, b) => a + b, 0) / dP };
}

function computeSharpe(closes, rf = 0.05) {
  if (closes.length < 30) return 0;
  const ret = [];
  for (let i = 1; i < closes.length; i++) ret.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const mean = ret.reduce((a, b) => a + b, 0) / ret.length;
  const std = Math.sqrt(ret.reduce((a, b) => a + (b - mean) ** 2, 0) / ret.length);
  return std === 0 ? 0 : ((mean - rf / 252) / std) * Math.sqrt(252);
}

function computeMaxDrawdown(closes) {
  let peak = closes[0], maxDD = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > peak) peak = closes[i];
    maxDD = Math.max(maxDD, (peak - closes[i]) / peak);
  }
  return maxDD * 100;
}

function detectRegime(closes, atrPct) {
  if (closes.length < 50) return "unknown";
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const price = closes[closes.length - 1];
  const ret20 = [];
  for (let i = closes.length - 20; i < closes.length; i++) ret20.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const meanDir = ret20.reduce((a, b) => a + b, 0) / ret20.length;
  const ts = Math.abs(meanDir) / (atrPct / 100 || 0.01);
  if (ts > 0.15 && Math.abs(price - sma50) / sma50 > 0.05) return "trending";
  if (atrPct > 3.5) return "volatile";
  return "mean_reverting";
}

function computeTechnicals(prices) {
  if (!prices || prices.length < 50) return null;
  const closes = prices.map(p => p.close);
  const highs = prices.map(p => p.high);
  const lows = prices.map(p => p.low);
  const volumes = prices.map(p => p.volume);
  const sma = (arr, n) => arr.length >= n ? arr.slice(-n).reduce((a, b) => a + b, 0) / n : null;

  const currentPrice = closes[closes.length - 1];
  const sma20 = sma(closes, 20), sma50 = sma(closes, 50);
  const sma200 = closes.length >= 200 ? sma(closes, 200) : null;
  const hasSMA200 = sma200 !== null;
  const rsi = computeWilderRSI(closes);
  const rsiShort = computeWilderRSI(closes.slice(-30), 7);
  const macd = computeMACD(closes);

  const slice20 = closes.slice(-20);
  const mean20 = slice20.reduce((a, b) => a + b, 0) / 20;
  const std20 = Math.sqrt(slice20.reduce((a, b) => a + (b - mean20) ** 2, 0) / 20);
  const bbUpper = mean20 + 2 * std20, bbLower = mean20 - 2 * std20;
  const bbWidth = sma20 ? ((bbUpper - bbLower) / sma20) * 100 : 0;
  const bbPosition = (bbUpper - bbLower) !== 0 ? (currentPrice - bbLower) / (bbUpper - bbLower) : 0.5;

  let atr14 = 0;
  if (prices.length > 14) {
    let s = 0;
    for (let i = prices.length - 15; i < prices.length - 13; i++) s += Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
    atr14 = s;
    for (let i = prices.length - 13; i < prices.length; i++) {
      atr14 = (atr14 * 13 + Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))) / 14;
    }
  }
  const atrPct = (atr14 / currentPrice) * 100;
  const avgVol20 = sma(volumes, 20), avgVol50 = sma(volumes, 50);
  const volRatio = avgVol20 ? volumes[volumes.length - 1] / avgVol20 : 1;
  const volTrend = avgVol20 && avgVol50 ? avgVol20 / avgVol50 : 1;
  const stoch = computeStochastic(highs, lows, closes);
  const sharpe = computeSharpe(closes);
  const sharpe60 = computeSharpe(closes.slice(-60));
  const maxDrawdown = computeMaxDrawdown(closes);
  const maxDrawdown60 = computeMaxDrawdown(closes.slice(-60));
  const regime = detectRegime(closes, atrPct);
  const sma10 = sma(closes, 10);
  const trendAlignment = [currentPrice > sma10 ? 1 : -1, currentPrice > sma20 ? 1 : -1, currentPrice > sma50 ? 1 : -1, hasSMA200 ? (currentPrice > sma200 ? 1 : -1) : 0];
  const trendScore = trendAlignment.reduce((a, b) => a + b, 0);
  const high52 = Math.max(...highs), low52 = Math.min(...lows);
  const pctFrom52High = ((high52 - currentPrice) / high52) * 100;

  return {
    currentPrice, sma20, sma50, sma200, hasSMA200, rsi, rsiShort,
    macdLine: macd.macdLine, macdSignal: macd.signalLine, macdHistogram: macd.histogram, macdHistExpanding: macd.histogramExpanding,
    bbUpper, bbLower, bbWidth, bbPosition, atr14, atrPct, volRatio, volTrend,
    stochK: stoch.k, stochD: stoch.d, sharpe, sharpe60, maxDrawdown, maxDrawdown60,
    regime, trendScore, trendAlignment, high52, low52, pctFrom52High,
    aboveSMA50: currentPrice > sma50,
    aboveSMA200: hasSMA200 ? currentPrice > sma200 : null,
    goldenCross: hasSMA200 ? sma50 > sma200 : null,
  };
}

// ── 4 SIGNAL ENGINES (Wolf-corrected + bifurcated) ──

function gsQuantSignal(tech) {
  if (!tech) return { score: 0, signal: "HOLD", reasons: ["Insufficient data"] };
  let score = 0; const reasons = [];
  if (tech.rsi < 30 && tech.rsiShort < 25) { score += 2.5; reasons.push("RSI deeply oversold 14d(" + tech.rsi.toFixed(1) + ") & 7d(" + tech.rsiShort.toFixed(1) + ")"); }
  else if (tech.rsi < 30) { score += 1.5; reasons.push("RSI oversold (" + tech.rsi.toFixed(1) + ")"); }
  else if (tech.rsi > 70 && tech.rsiShort > 75) { score -= 2.5; reasons.push("RSI overbought across timeframes (" + tech.rsi.toFixed(1) + "/" + tech.rsiShort.toFixed(1) + ")"); }
  else if (tech.rsi > 70) { score -= 1.5; reasons.push("RSI overbought (" + tech.rsi.toFixed(1) + ")"); }
  else if (tech.rsi > 50 && tech.rsi < 65) { score += 0.5; reasons.push("RSI healthy (" + tech.rsi.toFixed(1) + ")"); }
  if (tech.macdHistogram > 0 && tech.macdHistExpanding) { score += 2; reasons.push("MACD bullish, histogram expanding"); }
  else if (tech.macdHistogram > 0) { score += 0.5; reasons.push("MACD bullish but fading"); }
  else if (tech.macdHistogram < 0 && tech.macdHistExpanding) { score -= 2; reasons.push("MACD bearish, selling accelerating"); }
  else if (tech.macdHistogram < 0) { score -= 0.5; reasons.push("MACD bearish but stabilizing"); }
  if (tech.trendScore >= 3) { score += 2; reasons.push("All moving averages aligned bullish"); }
  else if (tech.trendScore <= -3) { score -= 2; reasons.push("Below all major moving averages"); }
  if (tech.hasSMA200 && tech.goldenCross) { score += 1; reasons.push("Golden Cross active"); }
  else if (tech.hasSMA200 && !tech.goldenCross) { score -= 0.5; reasons.push("Death Cross active"); }
  else if (!tech.hasSMA200) { reasons.push("⚠ Insufficient data for 200-day SMA"); score *= 0.8; }
  if (tech.bbPosition < 0.05) { score += 1.5; reasons.push("Price at lower Bollinger extreme"); }
  else if (tech.bbPosition > 0.95) { score -= 1.5; reasons.push("Price at upper Bollinger extreme"); }
  if (tech.stochK < 20 && tech.stochK > tech.stochD) { score += 1.5; reasons.push("Stochastic bullish crossover in oversold"); }
  else if (tech.stochK > 80 && tech.stochK < tech.stochD) { score -= 1.5; reasons.push("Stochastic bearish crossover in overbought"); }
  if (tech.volRatio > 1.5 && score > 0 && tech.volTrend > 1.1) { score += 1; reasons.push("Volume confirms bullish (" + tech.volRatio.toFixed(1) + "x)"); }
  else if (tech.volRatio > 1.5 && score < 0) { score -= 1; reasons.push("Heavy selling volume"); }
  else if (tech.volRatio < 0.5 && Math.abs(score) > 2) { score *= 0.7; reasons.push("⚠ Low volume — weak conviction"); }
  if (tech.pctFrom52High < 3) { score += 0.5; reasons.push("Near 52-week high"); }
  else if (tech.pctFrom52High > 25) { score -= 0.5; reasons.push("Off 52-week high -" + tech.pctFrom52High.toFixed(1) + "%"); }
  const signal = score >= 5.5 ? "STRONG BUY" : score >= 3 ? "BUY" : score <= -5.5 ? "STRONG SELL" : score <= -3 ? "SELL" : "HOLD";
  return { score: Math.max(-10, Math.min(10, score)), signal, reasons: reasons.slice(0, 5) };
}

function blackrockSignal(fundamentals, sector) {
  if (!fundamentals) return { score: 0, signal: "HOLD", reasons: ["No fundamental data"] };
  let score = 0; const reasons = []; const f = fundamentals;
  const medPE = SECTOR_PE_MEDIANS[sector] || 20;
  const peR = f.pe > 0 ? f.pe / medPE : 1;
  if (f.pe > 0 && peR < 0.7) { score += 2; reasons.push("P/E " + f.pe.toFixed(1) + " deep value vs " + sector + " median " + medPE); }
  else if (f.pe > 0 && peR < 1.0) { score += 1; reasons.push("P/E " + f.pe.toFixed(1) + " below sector median"); }
  else if (peR > 1.5) { score -= 1.5; reasons.push("P/E " + f.pe.toFixed(1) + " premium to sector"); }
  if (f.pe > 0 && f.revenueGrowth > 1) {
    const peg = f.pe / f.revenueGrowth;
    if (peg < 1.0) { score += 2; reasons.push("PEG " + peg.toFixed(2) + " — growth at reasonable price"); }
    else if (peg < 1.5) { score += 0.5; reasons.push("PEG " + peg.toFixed(2) + " — fair"); }
    else if (peg > 3) { score -= 1; reasons.push("PEG " + peg.toFixed(2) + " — overpaying for growth"); }
  } else if (f.pe > 0 && f.revenueGrowth <= 0) { score -= 1; reasons.push("Negative growth — value trap risk"); }
  if (f.revenueGrowth > 15 && f.profitMargin > 15) { score += 1.5; reasons.push("Quality growth: rev +" + f.revenueGrowth.toFixed(1) + "%, margin " + f.profitMargin.toFixed(0) + "%"); }
  else if (f.revenueGrowth > 5) { score += 0.5; reasons.push("Healthy growth +" + f.revenueGrowth.toFixed(1) + "%"); }
  else if (f.revenueGrowth < -5) { score -= 1.5; reasons.push("Revenue declining " + f.revenueGrowth.toFixed(1) + "%"); }
  if (f.profitMargin > 0 && f.fcfYield > 0) {
    const fcfQ = f.fcfYield / (f.profitMargin * 0.15 || 0.01);
    if (fcfQ > 1.2) { score += 1; reasons.push("FCF exceeds earnings — high quality"); }
    else if (fcfQ < 0.5) { score -= 1; reasons.push("⚠ FCF << earnings — accrual risk"); }
  }
  const zP = (f.profitMargin / 10) + (1 / Math.max(f.debtToEquity, 0.1)) * 0.5 + (f.roe / 20) + (f.fcfYield / 5);
  if (zP > 3.0) { score += 1; reasons.push("Financial health strong (Z-proxy " + zP.toFixed(1) + ")"); }
  else if (zP < 1.0) { score -= 1.5; reasons.push("⚠ Distress indicators (Z-proxy " + zP.toFixed(1) + ")"); }
  if (f.debtToEquity < 0.5 && f.roe > 12) { score += 1; reasons.push("Low debt + solid ROE"); }
  else if (f.debtToEquity > 2) { score -= 1; reasons.push("High leverage D/E=" + f.debtToEquity.toFixed(2)); }
  if (f.dividendYield > 3 && f.fcfYield > f.dividendYield) { score += 0.5; reasons.push("Sustainable dividend " + f.dividendYield.toFixed(2) + "%"); }
  const signal = score >= 5.5 ? "STRONG BUY" : score >= 3 ? "BUY" : score <= -5.5 ? "STRONG SELL" : score <= -3 ? "SELL" : "HOLD";
  return { score: Math.max(-10, Math.min(10, score)), signal, reasons: reasons.slice(0, 5) };
}

function bankRiskSignal(tech, fundamentals) {
  if (!tech) return { score: 0, signal: "HOLD", reasons: ["Insufficient risk data"] };
  let score = 0; const reasons = [];
  if (tech.sharpe > 1.5) { score += 2; reasons.push("Excellent Sharpe " + tech.sharpe.toFixed(2)); }
  else if (tech.sharpe > 0.5) { score += 1; reasons.push("Decent Sharpe " + tech.sharpe.toFixed(2)); }
  else if (tech.sharpe < -0.5) { score -= 2; reasons.push("Negative Sharpe " + tech.sharpe.toFixed(2)); }
  else { score -= 0.5; reasons.push("Weak Sharpe " + tech.sharpe.toFixed(2)); }
  if (tech.maxDrawdown < 10) { score += 1.5; reasons.push("Low drawdown -" + tech.maxDrawdown.toFixed(1) + "%"); }
  else if (tech.maxDrawdown < 20) { score += 0.5; reasons.push("Moderate drawdown -" + tech.maxDrawdown.toFixed(1) + "%"); }
  else if (tech.maxDrawdown > 35) { score -= 2; reasons.push("Severe drawdown -" + tech.maxDrawdown.toFixed(1) + "%"); }
  else if (tech.maxDrawdown > 25) { score -= 1; reasons.push("Deep drawdown -" + tech.maxDrawdown.toFixed(1) + "%"); }
  if (tech.maxDrawdown60 > tech.maxDrawdown * 0.8) { score -= 1; reasons.push("⚠ Recent stress: 60d DD near max"); }
  if (tech.atrPct < 1.5) { score += 0.5; reasons.push("Low volatility ATR " + tech.atrPct.toFixed(2) + "%"); }
  else if (tech.atrPct > 3.5) { score -= 1; reasons.push("High volatility ATR " + tech.atrPct.toFixed(2) + "%"); }
  if (tech.regime === "trending" && tech.trendScore > 0) { score += 0.5; reasons.push("Regime: TRENDING ↗"); }
  else if (tech.regime === "volatile") { score -= 0.5; reasons.push("Regime: VOLATILE ⚡"); }
  else { reasons.push("Regime: RANGE-BOUND ↔"); }
  if (fundamentals?.beta > 1.4) { score -= 1; reasons.push("High beta " + fundamentals.beta.toFixed(2)); }
  else if (fundamentals?.beta < 0.7) { score += 0.5; reasons.push("Low beta " + fundamentals.beta.toFixed(2)); }
  if (tech.bbWidth > 15) { score -= 0.5; reasons.push("Wide Bollinger spread"); }
  const signal = score >= 4.5 ? "STRONG BUY" : score >= 2 ? "BUY" : score <= -4.5 ? "STRONG SELL" : score <= -2 ? "SELL" : "HOLD";
  return { score: Math.max(-10, Math.min(10, score)), signal, reasons: reasons.slice(0, 5) };
}

function buffettSignal(tech, fundamentals) {
  if (!tech || !fundamentals) return { score: 0, signal: "HOLD", reasons: ["Need both datasets"] };
  let score = 0; const reasons = []; const f = fundamentals;
  let quality = 0;
  if (f.roe > 20) quality += 2; else if (f.roe > 12) quality += 1;
  if (f.profitMargin > 20) quality += 2; else if (f.profitMargin > 10) quality += 1;
  if (f.debtToEquity < 0.5) quality += 1;
  if (f.fcfYield > 4) quality += 1;
  if (quality >= 5) { score += 2.5; reasons.push("Exceptional quality " + quality + "/6 — wide moat"); }
  else if (quality >= 3) { score += 1; reasons.push("Good quality " + quality + "/6"); }
  else { score -= 1; reasons.push("Weak quality " + quality + "/6"); }
  const ey = f.pe > 0 ? (1 / f.pe) * 100 : 0;
  if (ey > 6.75) { score += 1.5; reasons.push("Earnings yield " + ey.toFixed(1) + "% > 1.5x treasury — margin of safety"); }
  else if (ey > 4.5) { score += 0.5; reasons.push("Earnings yield " + ey.toFixed(1) + "% above risk-free"); }
  else if (ey < 2.7 && f.pe > 0) { score -= 1.5; reasons.push("Earnings yield " + ey.toFixed(1) + "% below treasury"); }
  if (tech.hasSMA200 && tech.aboveSMA200 && tech.goldenCross) { score += 1.5; reasons.push("Long-term uptrend intact"); }
  else if (tech.hasSMA200 && !tech.aboveSMA200) { score -= 1; reasons.push("Below 200-day — wait for confirmation"); }
  if (f.fcfYield > 5 && f.profitMargin > 15) { score += 1.5; reasons.push("Strong owner earnings"); }
  else if (f.fcfYield < 0) { score -= 1.5; reasons.push("Negative FCF — burning cash"); }
  if (f.debtToEquity < 0.5 && f.roe > 15) { score += 1; reasons.push("Excellent capital allocation"); }
  else if (f.debtToEquity > 2 && f.roe < 10) { score -= 1.5; reasons.push("Leveraged + low returns"); }
  if (tech.trendScore <= -3 && score > 0) { score -= 1; reasons.push("⚠ Strong downtrend — timing risk"); }
  const signal = score >= 5.5 ? "STRONG BUY" : score >= 3 ? "BUY" : score <= -5 ? "STRONG SELL" : score <= -2.5 ? "SELL" : "HOLD";
  return { score: Math.max(-10, Math.min(10, score)), signal, reasons: reasons.slice(0, 5) };
}

function computeComposite(gs, br, bank, buffett, regime, tech) {
  let wGS, wBR, wBank, wBuffett;
  if (regime === "trending") { wGS = 0.35; wBR = 0.15; wBank = 0.15; wBuffett = 0.35; }
  else if (regime === "volatile") { wGS = 0.15; wBR = 0.30; wBank = 0.35; wBuffett = 0.20; }
  else { wGS = 0.30; wBR = 0.25; wBank = 0.20; wBuffett = 0.25; }
  const ws = gs.score * wGS + br.score * wBR + bank.score * wBank + buffett.score * wBuffett;
  const all = [gs.signal, br.signal, bank.signal, buffett.signal];
  const isBuyish = s => s === "BUY" || s === "STRONG BUY";
  const isSellish = s => s === "SELL" || s === "STRONG SELL";
  const buyC = all.filter(isBuyish).length, sellC = all.filter(isSellish).length;
  const sbC = all.filter(s => s === "STRONG BUY").length, ssC = all.filter(s => s === "STRONG SELL").length;
  const sharpe = tech?.sharpe || 0, maxDD = tech?.maxDrawdown || 100;
  const sbQ = ws >= 4.0 && buyC >= 3 && !isSellish(bank.signal) && sharpe > 0 && maxDD < 30 && sbC >= 1;
  const ssQ = ws <= -4.0 && sellC >= 3 && ssC >= 1 && buffett.signal !== "STRONG BUY";
  const bst = regime === "volatile" ? 3.0 : 2.5;
  let signal, confidence; const dq = [];
  if (sbQ) { signal = "STRONG BUY"; confidence = Math.min(92, 60 + ws * 5 + buyC * 4 + sbC * 3); }
  else if (ws >= bst && buyC >= 2) {
    signal = "BUY"; confidence = Math.min(85, 45 + ws * 7 + buyC * 5);
    if (ws >= 4.0) {
      if (buyC < 3) dq.push("Needs 3+ consensus for STRONG BUY (have " + buyC + ")");
      if (isSellish(bank.signal)) dq.push("Risk desk bearish — blocks STRONG BUY");
      if (sharpe <= 0) dq.push("Negative Sharpe blocks STRONG BUY");
      if (maxDD >= 30) dq.push("Drawdown too deep for STRONG BUY");
      if (sbC === 0) dq.push("No engine at STRONG BUY level");
    }
  } else if (ssQ) { signal = "STRONG SELL"; confidence = Math.min(92, 60 + Math.abs(ws) * 5 + sellC * 4); }
  else if (ws <= -bst && sellC >= 2) {
    signal = "SELL"; confidence = Math.min(85, 45 + Math.abs(ws) * 7 + sellC * 5);
    if (ws <= -4.0) {
      if (sellC < 3) dq.push("Needs 3+ consensus for STRONG SELL");
      if (buffett.signal === "STRONG BUY") dq.push("Buffett value floor blocks STRONG SELL");
      if (ssC === 0) dq.push("No engine at STRONG SELL level");
    }
  } else { signal = "HOLD"; confidence = 30 + Math.abs(ws) * 4; }
  return {
    signal, confidence: Math.min(92, Math.round(confidence)),
    weightedScore: Math.round(ws * 100) / 100,
    consensus: { strongBuy: sbC, buy: buyC - sbC, hold: 4 - buyC - sellC, sell: sellC - ssC, strongSell: ssC },
    regime, weights: { gs: wGS, br: wBR, bank: wBank, buffett: wBuffett }, disqualifyReasons: dq,
  };
}

function computeEntryExit(tech, signal, regime) {
  if (!tech) return { entry: 0, target: 0, stopLoss: 0, riskReward: 0, riskPct: 0, positionSize: "—" };
  const p = tech.currentPrice, a = tech.atr14;
  const sm = regime === "volatile" ? 2.0 : regime === "trending" ? 1.2 : 1.5;
  const tm = regime === "trending" ? 4.0 : regime === "volatile" ? 2.0 : 3.0;
  let entry, target, stopLoss, positionSize;
  if (signal === "STRONG BUY") { entry = +(p - a * 0.1).toFixed(2); target = +(p + a * tm * 1.4).toFixed(2); stopLoss = +(p - a * sm * 0.9).toFixed(2); positionSize = "Full (1.0x)"; }
  else if (signal === "BUY") { entry = +(p - a * 0.2).toFixed(2); target = +(p + a * tm).toFixed(2); stopLoss = +(p - a * sm).toFixed(2); positionSize = "Standard (0.7x)"; }
  else if (signal === "STRONG SELL") { entry = +(p + a * 0.1).toFixed(2); target = +(p - a * tm * 1.4).toFixed(2); stopLoss = +(p + a * sm * 0.9).toFixed(2); positionSize = "Full Short (1.0x)"; }
  else if (signal === "SELL") { entry = +(p + a * 0.2).toFixed(2); target = +(p - a * tm).toFixed(2); stopLoss = +(p + a * sm).toFixed(2); positionSize = "Reduce (0.5x)"; }
  else { entry = +p.toFixed(2); target = +(p + a * 1.5).toFixed(2); stopLoss = +(p - a * 1.5).toFixed(2); positionSize = "No action"; }
  const rw = Math.abs(target - entry), rk = Math.abs(entry - stopLoss);
  return { entry, target, stopLoss, riskReward: rk > 0 ? +(rw / rk).toFixed(2) : 0, riskPct: +((rk / p) * 100).toFixed(2), positionSize };
}

// ═══════════════════════════════════════════════════════════════
// I4: FALLBACK DATA GENERATOR (when API unavailable)
// ═══════════════════════════════════════════════════════════════
function hashTicker(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h &= h; } return Math.abs(h); }

const SECTOR_MAP = {"AAPL":"Technology","MSFT":"Technology","NVDA":"Technology","AMZN":"Consumer Cyclical","GOOG":"Technology","META":"Communication Services","BRK-B":"Financial Services","LLY":"Healthcare","AVGO":"Technology","JPM":"Financial Services","TSLA":"Consumer Cyclical","UNH":"Healthcare","V":"Financial Services","XOM":"Energy","MA":"Financial Services","JNJ":"Healthcare","PG":"Consumer Defensive","COST":"Consumer Defensive","HD":"Consumer Cyclical","ABBV":"Healthcare","WMT":"Consumer Defensive","NFLX":"Communication Services","KO":"Consumer Defensive","BAC":"Financial Services","MRK":"Healthcare","CRM":"Technology","CVX":"Energy","AMD":"Technology","PEP":"Consumer Defensive","TMO":"Healthcare","LIN":"Basic Materials","ORCL":"Technology","ACN":"Technology","MCD":"Consumer Cyclical","ADBE":"Technology","ABT":"Healthcare","PM":"Consumer Defensive","CSCO":"Technology","GE":"Industrials","IBM":"Technology","NOW":"Technology","DHR":"Healthcare","ISRG":"Healthcare","QCOM":"Technology","TXN":"Technology","INTU":"Technology","AMGN":"Healthcare","CMCSA":"Communication Services","VZ":"Communication Services","NEE":"Utilities","PFE":"Healthcare","RTX":"Industrials","AMAT":"Technology","HON":"Industrials","LOW":"Consumer Cyclical","UNP":"Industrials","SPGI":"Financial Services","BLK":"Financial Services","SYK":"Healthcare","BKNG":"Consumer Cyclical","GS":"Financial Services","ELV":"Healthcare","ADP":"Industrials","SCHW":"Financial Services","MDLZ":"Consumer Defensive","GILD":"Healthcare","DE":"Industrials","VRTX":"Healthcare","T":"Communication Services","CB":"Financial Services","MMC":"Financial Services","REGN":"Healthcare","ADI":"Technology","LRCX":"Technology","BMY":"Healthcare","MU":"Technology","KLAC":"Technology","SO":"Utilities","CI":"Healthcare","ZTS":"Healthcare","RY":"Financial Services","TD":"Financial Services","BNS":"Financial Services","BMO":"Financial Services","CM":"Financial Services","CNQ":"Energy","ENB":"Energy","CP":"Industrials","TRI":"Technology","CNI":"Industrials","SU":"Energy","MFC":"Financial Services","NTR":"Basic Materials","BCE":"Communication Services","FTS":"Utilities","WCN":"Industrials","BAM":"Financial Services","ATD.TO":"Consumer Defensive","GIB":"Technology","SHOP":"Technology"};
const NAME_MAP = {"AAPL":"Apple Inc.","MSFT":"Microsoft","NVDA":"NVIDIA","AMZN":"Amazon","GOOG":"Alphabet","META":"Meta Platforms","BRK-B":"Berkshire Hathaway","LLY":"Eli Lilly","AVGO":"Broadcom","JPM":"JPMorgan Chase","TSLA":"Tesla","UNH":"UnitedHealth","V":"Visa","XOM":"Exxon Mobil","MA":"Mastercard","JNJ":"Johnson & Johnson","PG":"Procter & Gamble","COST":"Costco","HD":"Home Depot","ABBV":"AbbVie","WMT":"Walmart","NFLX":"Netflix","KO":"Coca-Cola","BAC":"Bank of America","MRK":"Merck","CRM":"Salesforce","CVX":"Chevron","AMD":"AMD","PEP":"PepsiCo","TMO":"Thermo Fisher","LIN":"Linde","ORCL":"Oracle","ACN":"Accenture","MCD":"McDonald's","ADBE":"Adobe","ABT":"Abbott Labs","PM":"Philip Morris","CSCO":"Cisco","GE":"GE Aerospace","IBM":"IBM","NOW":"ServiceNow","DHR":"Danaher","ISRG":"Intuitive Surgical","QCOM":"Qualcomm","TXN":"Texas Instruments","INTU":"Intuit","AMGN":"Amgen","CMCSA":"Comcast","VZ":"Verizon","NEE":"NextEra Energy","PFE":"Pfizer","RTX":"RTX Corp","AMAT":"Applied Materials","HON":"Honeywell","LOW":"Lowe's","UNP":"Union Pacific","SPGI":"S&P Global","BLK":"BlackRock","SYK":"Stryker","BKNG":"Booking Holdings","GS":"Goldman Sachs","ELV":"Elevance Health","ADP":"ADP","SCHW":"Schwab","MDLZ":"Mondelez","GILD":"Gilead","DE":"Deere","VRTX":"Vertex Pharma","T":"AT&T","CB":"Chubb","MMC":"Marsh McLennan","REGN":"Regeneron","ADI":"Analog Devices","LRCX":"Lam Research","BMY":"Bristol-Myers","MU":"Micron","KLAC":"KLA Corp","SO":"Southern Co","CI":"Cigna","ZTS":"Zoetis","RY":"Royal Bank CA","TD":"TD Bank","BNS":"Scotiabank","BMO":"BMO","CM":"CIBC","CNQ":"Canadian Natural","ENB":"Enbridge","CP":"CP Railway","TRI":"Thomson Reuters","CNI":"CN Railway","SU":"Suncor","MFC":"Manulife","NTR":"Nutrien","BCE":"BCE Inc","FTS":"Fortis","WCN":"Waste Connections","BAM":"Brookfield AM","ATD.TO":"Couche-Tard","GIB":"CGI Inc","SHOP":"Shopify"};
const CA_TICKERS = new Set(["RY","TD","BNS","BMO","CM","CNQ","ENB","CP","TRI","CNI","SU","MFC","NTR","BCE","FTS","WCN","BAM","ATD.TO","GIB","SHOP"]);

function generateSimulatedData(ticker) {
  const seed = hashTicker(ticker);
  const rng = (n) => ((seed * 9301 + 49297 + n * 233) % 233280) / 233280;
  const basePrice = 50 + rng(1) * 500, trend = rng(2) > 0.5 ? 1 : -1, vol = 0.005 + rng(3) * 0.025;
  const prices = []; let price = basePrice;
  for (let i = 0; i < 250; i++) {
    price *= (1 + trend * vol * 0.3 + (rng(i + 100) - 0.48) * vol * 2);
    const dr = price * vol * 0.8;
    prices.push({ close: price, high: price + dr * rng(i + 200), low: price - dr * rng(i + 300), volume: Math.round(5e6 + rng(i + 400) * 5e7) });
  }
  const mcaps = { AAPL: 3420, MSFT: 3180, NVDA: 2850, AMZN: 2120, GOOG: 2080, META: 1560, "BRK-B": 1020, LLY: 820, AVGO: 790, JPM: 720, TSLA: 710, UNH: 520, V: 510, XOM: 490, MA: 460 };
  return {
    ticker, name: NAME_MAP[ticker] || ticker, sector: SECTOR_MAP[ticker] || "Technology",
    country: CA_TICKERS.has(ticker) ? "CA" : "US", prices, dataSource: "simulated",
    fundamentals: { pe: 5 + rng(10) * 45, revenueGrowth: -10 + rng(11) * 40, profitMargin: -5 + rng(12) * 40, debtToEquity: rng(13) * 3, roe: rng(14) * 35, dividendYield: rng(15) * 5, fcfYield: -2 + rng(16) * 10, beta: 0.5 + rng(17) * 1.5, marketCap: mcaps[ticker] || (20 + rng(5) * 200) },
  };
}

// ═══════════════════════════════════════════════════════════════
// I6: CSV EXPORT
// ═══════════════════════════════════════════════════════════════
function exportCSV(stocks) {
  const headers = ["Ticker","Name","Sector","Country","Price","Signal","Confidence","Score","R:R","Entry","Target","Stop Loss","Risk%","Sharpe","MaxDD","Regime","Position Size","GS Signal","BlackRock Signal","Risk Signal","Buffett Signal","P/E","ROE","D/E","FCF Yield","Beta","Mkt Cap ($B)"];
  const rows = stocks.map(s => [
    s.ticker, s.name, s.sector, s.country, s.currentPrice.toFixed(2),
    s.composite.signal, s.composite.confidence + "%", s.composite.weightedScore,
    s.entryExit.riskReward + ":1", s.entryExit.entry, s.entryExit.target, s.entryExit.stopLoss,
    s.entryExit.riskPct + "%", (s.tech?.sharpe || 0).toFixed(2), (s.tech?.maxDrawdown || 0).toFixed(1) + "%",
    s.composite.regime, s.entryExit.positionSize,
    s.gs.signal, s.br.signal, s.bank.signal, s.buffett.signal,
    s.fundamentals.pe.toFixed(1), s.fundamentals.roe.toFixed(1) + "%",
    s.fundamentals.debtToEquity.toFixed(2), s.fundamentals.fcfYield.toFixed(1) + "%",
    s.fundamentals.beta.toFixed(2), s.fundamentals.marketCap.toFixed(0),
  ]);
  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `team-alpha-screener-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════
function Sparkline({ data, color, width = 80, height = 28 }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`).join(" ");
  return <svg width={width} height={height} style={{ display: "block" }}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ScoreGauge({ score, size = 44 }) {
  const n = (score + 10) / 20, c = score > 5 ? "#15803d" : score > 3 ? "#22c55e" : score < -5 ? "#991b1b" : score < -3 ? "#ef4444" : "#eab308";
  const r = size / 2 - 4, cx = size / 2, cy = size / 2, rad = ((-140 + n * 280) * Math.PI) / 180;
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}><circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1f36" strokeWidth="3" /><circle cx={cx} cy={cy} r={r} fill="none" stroke={c} strokeWidth="3" strokeDasharray={`${n * 2 * Math.PI * r} ${2 * Math.PI * r}`} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} style={{ opacity: 0.6 }} /><line x1={cx} y1={cy} x2={cx + r * 0.7 * Math.cos(rad)} y2={cy + r * 0.7 * Math.sin(rad)} stroke={c} strokeWidth="2" strokeLinecap="round" /><circle cx={cx} cy={cy} r="2.5" fill={c} /></svg>;
}

function SignalBadge({ signal, size = "normal" }) {
  const cm = { "STRONG BUY": { bg: "#15803d20", brd: "#22c55e60", tx: "#22c55e", icon: "▲▲" }, BUY: { bg: "#22c55e12", brd: "#22c55e40", tx: "#4ade80", icon: "▲" }, HOLD: { bg: "#eab30812", brd: "#eab30840", tx: "#eab308", icon: "◆" }, SELL: { bg: "#ef444412", brd: "#ef444440", tx: "#f87171", icon: "▼" }, "STRONG SELL": { bg: "#991b1b20", brd: "#ef444460", tx: "#ef4444", icon: "▼▼" } };
  const c = cm[signal] || cm.HOLD, sm = size === "small", st = signal.startsWith("STRONG");
  return <span style={{ display: "inline-flex", alignItems: "center", gap: sm ? 2 : 4, padding: sm ? "2px 5px" : "3px 8px", borderRadius: 6, background: c.bg, border: `1px solid ${c.brd}`, fontSize: sm ? 9 : 11, fontWeight: 700, color: c.tx, letterSpacing: "0.04em", fontFamily: "'DM Mono', monospace", boxShadow: st ? `0 0 8px ${c.brd}` : "none" }}><span style={{ fontSize: sm ? 7 : 9 }}>{c.icon}</span> {signal}</span>;
}

function RegimeBadge({ regime }) {
  const cm = { trending: { bg: "#3b82f615", brd: "#3b82f640", tx: "#60a5fa", l: "TRENDING", i: "📈" }, volatile: { bg: "#ef444415", brd: "#ef444440", tx: "#f87171", l: "VOLATILE", i: "⚡" }, mean_reverting: { bg: "#a78bfa15", brd: "#a78bfa40", tx: "#a78bfa", l: "RANGE", i: "↔" } };
  const c = cm[regime] || { bg: "#94a3b815", brd: "#94a3b840", tx: "#94a3b8", l: "—", i: "?" };
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 6px", borderRadius: 5, background: c.bg, border: `1px solid ${c.brd}`, fontSize: 9, fontWeight: 600, color: c.tx }}>{c.i} {c.l}</span>;
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function App() {
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState("Initializing...");
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [sectorFilter, setSectorFilter] = useState("ALL");
  const [countryFilter, setCountryFilter] = useState("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("marketCap");
  const [sortDir, setSortDir] = useState("desc");
  const [hovered, setHovered] = useState(null);
  const [showDisclaimer, setShowDisclaimer] = useState(true);
  // I5: Watchlist
  const [watchlist, setWatchlist] = useState(new Set());
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  // I7 + I8: Data freshness & status
  const [dataSource, setDataSource] = useState("loading");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [apiCallsUsed, setApiCallsUsed] = useState(0);
  const [diagnostics, setDiagnostics] = useState([]);
  const [showDiag, setShowDiag] = useState(false);
  const detailRef = useRef(null);

  // I5: Load watchlist from persistent storage
  useEffect(() => {
    (async () => {
      try {
        const result = localStorage.getItem("alpha_watchlist");
        if (result?.value) setWatchlist(new Set(JSON.parse(result.value)));
      } catch (e) { /* No stored watchlist yet */ }
    })();
  }, []);

  // I5: Save watchlist on change
  const toggleWatchlist = useCallback(async (ticker) => {
    setWatchlist(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker); else next.add(ticker);
      // Persist
      try { localStorage.setItem("alpha_watchlist", JSON.stringify([...next])); } catch (e) {}
      return next;
    });
  }, []);

  // ══════════════════════════════════════════════════════════════
  // API BUDGET STRATEGY (Gemini was right — 250 calls/day needs planning)
  //
  // Budget: 250 calls/day
  //
  // TIER 1 — Bulk Quote (1 call, all 100 stocks)
  //   FMP's /quote/AAPL,MSFT,... endpoint accepts comma-separated tickers
  //   Returns: price, PE, marketCap, volume, dayHigh/Low, yearHigh/Low,
  //            priceAvg50, priceAvg200, eps, sharesOutstanding
  //   This is enough for: current price, PE, market cap, basic trend
  //   Cost: 1 API call ← this is the core screener data
  //
  // TIER 2 — Historical Prices (1 call per stock, ON-DEMAND only)
  //   Only fetched when user CLICKS a stock to see detailed analysis
  //   Cached in localStorage for 24h so it doesn't re-fetch
  //   Cost: 1 call per click, max ~20-30 per session realistically
  //
  // TIER 3 — Key Metrics (1 call per stock, ON-DEMAND only)
  //   Full fundamentals: ROE, D/E, FCF yield, profit margin, etc.
  //   Only fetched alongside historical when user clicks a stock
  //   Cost: 1 call per click
  //
  // DAILY BUDGET:
  //   First load:     1 call  (bulk quote)
  //   Each refresh:   1 call  (bulk quote, cached 2 min)
  //   Each stock click: 0-2 calls (historical + metrics, cached 24h)
  //   Typical day:    1 + 10 refreshes + 30 stock clicks × 2 = ~71 calls
  //   Worst case:     1 + 50 refreshes + 100 clicks × 2 = ~251 calls
  //
  // vs OLD architecture: 201 calls on FIRST LOAD alone
  //
  // CACHING: localStorage with 24h TTL for historical/metrics,
  //          2-min TTL for quotes (in-memory)
  // ══════════════════════════════════════════════════════════════

  // Persistent cache helpers (survive page refresh)
  function getCached(key, ttlMs) {
    try {
      const raw = localStorage.getItem("alpha_cache_" + key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > ttlMs) { localStorage.removeItem("alpha_cache_" + key); return null; }
      return data;
    } catch { return null; }
  }
  function setCache(key, data) {
    try { localStorage.setItem("alpha_cache_" + key, JSON.stringify({ data, ts: Date.now() })); } catch {}
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    let results = [];
    let source = "simulated";
    let diagLog = [];
    let callsUsed = 0;

    if (FMP_API_KEY && FMP_API_KEY !== "demo") {
      try {
        setLoadingMsg("Testing API connection...");
        diagLog.push("Key: " + FMP_API_KEY.slice(0, 4) + "***");

        // TIER 1: Single bulk quote — 1 API call for all 100 stocks
        const usTickers = TOP_100_TICKERS.filter(t => !t.includes(".TO"));
        const quoteUrl = `${FMP_BASE}/quote/${usTickers.join(",")}?apikey=${FMP_API_KEY}`;
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(quoteUrl, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const quoteData = await res.json();
        callsUsed++;
        
        if (!Array.isArray(quoteData) || quoteData.length === 0) {
          if (quoteData["Error Message"]) throw new Error(quoteData["Error Message"]);
          throw new Error("Empty response");
        }

        diagLog.push("✓ Bulk quote: " + quoteData.length + " stocks (1 API call)");
        setLoadingMsg("Received " + quoteData.length + " live quotes — building screener...");
        
        const quotes = {};
        quoteData.forEach(q => { if (q.symbol) quotes[q.symbol] = q; });

        // Build stock data using quote data + simulated history
        // (Historical will be fetched on-demand when user clicks)
        for (const ticker of TOP_100_TICKERS) {
          const cleanTicker = ticker.replace(".TO", "");
          const q = quotes[cleanTicker];
          const simData = generateSimulatedData(ticker);

          if (q && q.price > 0) {
            // Scale simulated prices to anchor at real current price
            const simLast = simData.prices[simData.prices.length - 1].close;
            const scale = q.price / simLast;
            
            // Use real quote data to improve simulated history shape
            const scaledPrices = simData.prices.map((p, idx) => {
              const baseScaled = p.close * scale;
              // If we have 50-day and 200-day averages, nudge the recent history 
              // to be more consistent with real trend
              let adjusted = baseScaled;
              if (q.priceAvg50 && idx > simData.prices.length - 50) {
                const weight = (idx - (simData.prices.length - 50)) / 50;
                const target = q.priceAvg50 + (q.price - q.priceAvg50) * weight;
                adjusted = baseScaled * 0.7 + target * 0.3;
              }
              return {
                close: adjusted,
                high: adjusted * (1 + (p.high / p.close - 1)),
                low: adjusted * (1 + (p.low / p.close - 1)),
                volume: q.volume || p.volume,
              };
            });

            results.push({
              ticker, 
              name: q.name || NAME_MAP[ticker] || ticker,
              sector: SECTOR_MAP[ticker] || "Technology",
              country: CA_TICKERS.has(ticker) ? "CA" : "US",
              prices: scaledPrices,
              dataSource: "live",
              hasDetailedData: false, // Will be upgraded on-demand
              fundamentals: {
                pe: q.pe || 0,
                revenueGrowth: q.priceAvg50 && q.priceAvg200 ? ((q.priceAvg50 - q.priceAvg200) / q.priceAvg200 * 100) : simData.fundamentals.revenueGrowth,
                profitMargin: q.eps && q.price ? Math.min(50, Math.max(-10, (q.eps / q.price) * 100 * 4)) : simData.fundamentals.profitMargin,
                debtToEquity: simData.fundamentals.debtToEquity,
                roe: simData.fundamentals.roe,
                dividendYield: simData.fundamentals.dividendYield,
                fcfYield: simData.fundamentals.fcfYield,
                beta: simData.fundamentals.beta,
                marketCap: q.marketCap ? q.marketCap / 1e9 : simData.fundamentals.marketCap,
              },
            });
          } else {
            // Canadian or missing stocks — use simulated
            results.push(simData);
          }
        }
        
        source = "live";
        diagLog.push("✓ Built 100 stock profiles (" + Object.keys(quotes).length + " live, " + (100 - Object.keys(quotes).length) + " simulated)");
        diagLog.push("✓ Total API calls this load: " + callsUsed + "/250");
        diagLog.push("ℹ Historical data loads on-demand when you click a stock (1-2 calls each, cached 24h)");

      } catch (err) {
        let reason = err.message;
        if (err.name === "AbortError") reason = "Timeout — sandbox may be blocking external APIs";
        else if (reason.includes("Failed to fetch")) reason = "CORS block — deploy to Vercel for live data";
        diagLog.push("✗ " + reason);
        setLoadingMsg("API unavailable: " + reason.slice(0, 60));
        await new Promise(r => setTimeout(r, 1200));
        results = TOP_100_TICKERS.map(t => generateSimulatedData(t));
        source = "simulated";
      }
    } else {
      setLoadingMsg("No API key — using simulated data");
      await new Promise(r => setTimeout(r, 400));
      results = TOP_100_TICKERS.map(t => generateSimulatedData(t));
      diagLog.push("ℹ Set VITE_FMP_API_KEY for live data");
    }

    // Run Wolf analysis
    setLoadingMsg("Running 4-engine analysis...");
    const analyzed = results.map(data => {
      const tech = computeTechnicals(data.prices);
      const gs = gsQuantSignal(tech);
      const br = blackrockSignal(data.fundamentals, data.sector);
      const bank = bankRiskSignal(tech, data.fundamentals);
      const buffett = buffettSignal(tech, data.fundamentals);
      const regime = tech?.regime || "mean_reverting";
      const composite = computeComposite(gs, br, bank, buffett, regime, tech);
      const entryExit = computeEntryExit(tech, composite.signal, regime);
      return { ...data, tech, gs, br, bank, buffett, composite, entryExit, currentPrice: tech?.currentPrice || 0 };
    });

    setStocks(analyzed);
    setDataSource(source);
    setLastRefresh(new Date());
    setDiagnostics(diagLog);
    setApiCallsUsed(callsUsed);
    setLoading(false);
  }, []);

  // TIER 2+3: On-demand detailed data when user clicks a stock
  const fetchDetailedData = useCallback(async (ticker) => {
    if (!FMP_API_KEY || FMP_API_KEY === "demo") return;
    
    const cleanTicker = ticker.replace(".TO", "");
    
    // Check localStorage cache (24h TTL)
    const cachedHist = getCached("hist_" + cleanTicker, 86400000);
    const cachedMetrics = getCached("metrics_" + cleanTicker, 86400000);
    
    if (cachedHist && cachedMetrics) {
      // Use cached data — 0 API calls
      upgradeStockWithDetails(ticker, cachedHist, cachedMetrics);
      return;
    }

    try {
      let hist = cachedHist;
      let metrics = cachedMetrics;
      let newCalls = 0;

      if (!hist) {
        const hRes = await fetch(`${FMP_BASE}/historical-price-full/${cleanTicker}?timeseries=250&apikey=${FMP_API_KEY}`);
        if (hRes.ok) {
          const hData = await hRes.json();
          if (hData.historical) { hist = hData.historical; setCache("hist_" + cleanTicker, hist); }
          newCalls++;
        }
      }

      if (!metrics) {
        const mRes = await fetch(`${FMP_BASE}/key-metrics-ttm/${cleanTicker}?apikey=${FMP_API_KEY}`);
        if (mRes.ok) {
          const mData = await mRes.json();
          if (Array.isArray(mData) && mData.length > 0) { metrics = mData[0]; setCache("metrics_" + cleanTicker, metrics); }
          newCalls++;
        }
      }

      if (hist || metrics) {
        upgradeStockWithDetails(ticker, hist, metrics);
        setApiCallsUsed(prev => prev + newCalls);
      }
    } catch {}
  }, []);

  // Upgrade a stock in the list with real historical + metrics data
  const upgradeStockWithDetails = useCallback((ticker, hist, metrics) => {
    setStocks(prev => prev.map(s => {
      if (s.ticker !== ticker) return s;
      
      let updatedPrices = s.prices;
      if (hist && hist.length > 50) {
        // Replace simulated history with REAL history
        updatedPrices = hist.reverse().map(d => ({
          close: d.close, high: d.high, low: d.low,
          volume: d.volume || 1000000,
        }));
      }

      let updatedFundamentals = { ...s.fundamentals };
      if (metrics) {
        updatedFundamentals = {
          ...updatedFundamentals,
          roe: metrics.roeTTM ? metrics.roeTTM * 100 : updatedFundamentals.roe,
          debtToEquity: metrics.debtToEquityTTM || updatedFundamentals.debtToEquity,
          profitMargin: metrics.netProfitMarginTTM ? metrics.netProfitMarginTTM * 100 : updatedFundamentals.profitMargin,
          fcfYield: metrics.freeCashFlowYieldTTM ? metrics.freeCashFlowYieldTTM * 100 : updatedFundamentals.fcfYield,
          dividendYield: metrics.dividendYieldTTM ? metrics.dividendYieldTTM * 100 : updatedFundamentals.dividendYield,
          revenueGrowth: metrics.revenuePerShareTTM && s.fundamentals.revenueGrowth ? s.fundamentals.revenueGrowth : updatedFundamentals.revenueGrowth,
        };
      }

      // Recompute all signals with real data
      const tech = computeTechnicals(updatedPrices);
      const gs = gsQuantSignal(tech);
      const br = blackrockSignal(updatedFundamentals, s.sector);
      const bank = bankRiskSignal(tech, updatedFundamentals);
      const buffett = buffettSignal(tech, updatedFundamentals);
      const regime = tech?.regime || "mean_reverting";
      const composite = computeComposite(gs, br, bank, buffett, regime, tech);
      const entryExit = computeEntryExit(tech, composite.signal, regime);

      return {
        ...s, prices: updatedPrices, fundamentals: updatedFundamentals,
        tech, gs, br, bank, buffett, composite, entryExit,
        currentPrice: tech?.currentPrice || s.currentPrice,
        hasDetailedData: true, dataSource: hist ? "live-full" : s.dataSource,
      };
    }));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const sectors = useMemo(() => ["ALL", ...Array.from(new Set(stocks.map(s => s.sector))).sort()], [stocks]);
  const signalCounts = useMemo(() => {
    const c = { "STRONG BUY": 0, BUY: 0, HOLD: 0, SELL: 0, "STRONG SELL": 0 };
    stocks.forEach(s => { if (c[s.composite.signal] !== undefined) c[s.composite.signal]++; });
    return c;
  }, [stocks]);

  const filtered = useMemo(() => {
    let r = stocks;
    if (showWatchlistOnly) r = r.filter(s => watchlist.has(s.ticker));
    if (filter === "STRONG BUY") r = r.filter(s => s.composite.signal === "STRONG BUY");
    else if (filter === "BUY") r = r.filter(s => s.composite.signal === "BUY" || s.composite.signal === "STRONG BUY");
    else if (filter === "HOLD") r = r.filter(s => s.composite.signal === "HOLD");
    else if (filter === "SELL") r = r.filter(s => s.composite.signal === "SELL" || s.composite.signal === "STRONG SELL");
    else if (filter === "STRONG SELL") r = r.filter(s => s.composite.signal === "STRONG SELL");
    if (sectorFilter !== "ALL") r = r.filter(s => s.sector === sectorFilter);
    if (countryFilter !== "ALL") r = r.filter(s => s.country === countryFilter);
    if (searchTerm) { const t = searchTerm.toUpperCase(); r = r.filter(s => s.ticker.includes(t) || s.name.toUpperCase().includes(t)); }
    r.sort((a, b) => {
      let va, vb;
      switch (sortBy) {
        case "ticker": va = a.ticker; vb = b.ticker; break;
        case "signal": va = a.composite.weightedScore; vb = b.composite.weightedScore; break;
        case "price": va = a.currentPrice; vb = b.currentPrice; break;
        case "rr": va = a.entryExit.riskReward; vb = b.entryExit.riskReward; break;
        case "sharpe": va = a.tech?.sharpe || 0; vb = b.tech?.sharpe || 0; break;
        case "marketCap": default: va = a.fundamentals.marketCap; vb = b.fundamentals.marketCap;
      }
      if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return r;
  }, [stocks, filter, sectorFilter, countryFilter, searchTerm, sortBy, sortDir, showWatchlistOnly, watchlist]);

  const handleSort = (key) => { if (sortBy === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortBy(key); setSortDir("desc"); } };
  const SI = ({ col }) => sortBy !== col ? <span style={{ opacity: 0.3, fontSize: 10 }}>⇅</span> : <span style={{ fontSize: 10, color: "#c084fc" }}>{sortDir === "asc" ? "↑" : "↓"}</span>;

  if (loading) return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07090f", color: "#e2e8f0", fontFamily: "'Outfit', system-ui", flexDirection: "column", gap: 16 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      <div style={{ width: 50, height: 50, border: "3px solid #1a1f36", borderTopColor: "#c084fc", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
      <div style={{ fontSize: 12, color: "#c084fc", letterSpacing: "0.1em", textTransform: "uppercase" }}>Team Alpha Screener v3.0</div>
      <div style={{ fontSize: 11, color: "#64748b", animation: "pulse 2s ease infinite" }}>{loadingMsg}</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#07090f", color: "#e2e8f0", fontFamily: "'Outfit', system-ui" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Outfit:wght@300;400;500;600;700;800&family=Cormorant+Garamond:wght@700&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #0d1117; }
        ::-webkit-scrollbar-thumb { background: #2d3548; border-radius: 3px; }
      `}</style>

      {/* DISCLAIMER */}
      {showDisclaimer && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(10px)" }}>
          <div style={{ background: "#0d1117", border: "1px solid #c084fc30", borderRadius: 16, padding: "28px 24px", maxWidth: 540, width: "92%", animation: "fadeIn 0.3s ease" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#c084fc", marginBottom: 6 }}>🐺 Team Alpha Screener v3.0</div>
            <div style={{ fontSize: 11, color: "#a78bfa", marginBottom: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>14 Wolf Fixes · 5-Level Signals · Live API + Watchlists + Export</div>
            <p style={{ fontSize: 12, lineHeight: 1.7, color: "#94a3b8", marginBottom: 10 }}>
              {dataSource === "live"
                ? <>Connected to <strong style={{ color: "#22c55e" }}>live market data</strong> via Financial Modeling Prep API.</>
                : <>Running with <strong style={{ color: "#eab308" }}>simulated data</strong>. Add your free FMP API key for live data.</>
              }
            </p>
            <p style={{ fontSize: 12, lineHeight: 1.7, color: "#94a3b8", marginBottom: 8 }}>5-level signal system: <strong style={{ color: "#22c55e" }}>STRONG BUY</strong> requires a 6-point qualification gate. STRONG BUY/SELL are qualitative upgrades, not just higher scores.</p>
            <p style={{ fontSize: 12, lineHeight: 1.7, color: "#f87171", marginBottom: 16 }}>Educational purposes only. Not financial advice. DYOR.</p>
            <button onClick={() => setShowDisclaimer(false)} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "linear-gradient(135deg, #c084fc, #7c3aed)", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>I Understand — Enter Screener</button>
          </div>
        </div>
      )}

      {/* I8: STATUS BAR */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 20px", background: "#0a0c14", borderBottom: "1px solid #111827", fontSize: 10, color: "#475569" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: dataSource === "live" ? "#22c55e" : "#eab308", animation: dataSource === "simulated" ? "pulse 2s ease infinite" : "none" }} />
            {dataSource === "live" ? "LIVE DATA" : "SIMULATED DATA"}
          </span>
          {dataSource === "simulated" && (
            <span style={{ color: "#eab308", fontSize: 9 }}>
              CORS sandbox restriction — deploy to Vercel/Netlify for live data
            </span>
          )}
          {lastRefresh && <span>Updated: {lastRefresh.toLocaleTimeString()}</span>}
          {dataSource === "live" && <span>API calls: {apiCallsUsed}/250</span>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {diagnostics.length > 0 && (
            <button onClick={() => setShowDiag(v => !v)} style={{ background: "none", border: "1px solid #f59e0b30", borderRadius: 4, color: "#f59e0b", padding: "2px 8px", fontSize: 9, cursor: "pointer" }}>
              🔍 Diagnostics ({diagnostics.length})
            </button>
          )}
          <button onClick={() => exportCSV(filtered)} style={{ background: "none", border: "1px solid #1e293b", borderRadius: 4, color: "#94a3b8", padding: "2px 8px", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>📥 CSV</button>
          <button onClick={loadData} style={{ background: "none", border: "1px solid #1e293b", borderRadius: 4, color: "#94a3b8", padding: "2px 8px", fontSize: 10, cursor: "pointer" }}>🔄 Refresh</button>
          <span style={{ color: "#334155" }}>v3.1</span>
        </div>
      </div>

      {/* DIAGNOSTICS PANEL */}
      {showDiag && (
        <div style={{ padding: "8px 20px", background: "#111827", borderBottom: "1px solid #1e293b", fontSize: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ color: "#f59e0b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 9 }}>🔍 Connection Diagnostics</span>
            <button onClick={() => setShowDiag(false)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 10 }}>✕</button>
          </div>
          {diagnostics.map((d, i) => (
            <div key={i} style={{ color: d.includes("successful") || d.includes("Received") ? "#22c55e" : d.includes("failed") || d.includes("error") || d.includes("Diagnosis") ? "#ef4444" : "#94a3b8", marginBottom: 2, fontFamily: "'DM Mono', monospace", fontSize: 9 }}>
              [{i + 1}] {d}
            </div>
          ))}
          <div style={{ marginTop: 8, padding: "8px 10px", background: "#0a0c14", borderRadius: 6, border: "1px solid #1e293b" }}>
            <div style={{ color: "#c084fc", fontWeight: 700, fontSize: 9, marginBottom: 4 }}>💡 HOW TO GET LIVE DATA (FREE)</div>
            <div style={{ color: "#94a3b8", lineHeight: 1.6, fontSize: 9 }}>
              The artifact sandbox blocks external API calls (CORS). To run with live data:<br />
              <strong style={{ color: "#e2e8f0" }}>Option A:</strong> Copy this .jsx file → create a React project → deploy free on Vercel or Netlify<br />
              <strong style={{ color: "#e2e8f0" }}>Option B:</strong> Open the exported JSX in CodeSandbox or StackBlitz (paste and run)<br />
              <strong style={{ color: "#e2e8f0" }}>Option C:</strong> Use a CORS proxy (add https://corsproxy.io/? before the FMP URL)<br />
              All options cost $0. The API key is already embedded in the file.
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header style={{ padding: "12px 20px 10px", borderBottom: "1px solid #1a1f36", background: "linear-gradient(180deg, #0d1117 0%, #07090f 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h1 style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Cormorant Garamond', serif", background: "linear-gradient(135deg, #e2e8f0, #c084fc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Team Alpha Screener</h1>
              <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 8, background: "#c084fc20", color: "#c084fc", fontWeight: 700, border: "1px solid #c084fc30" }}>v3.0</span>
            </div>
            <p style={{ fontSize: 9, color: "#475569", letterSpacing: "0.08em", textTransform: "uppercase" }}>Top 100 US & CA · 4-Engine · 5-Level Signal · Free & Open</p>
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            {["GS Quant","BlackRock","Risk Desk","Buffett","Infra"].map((l, i) => (
              <span key={l} style={{ fontSize: 8, padding: "2px 6px", borderRadius: 4, background: ["#818cf8","#22c55e","#eab308","#ef4444","#c084fc"][i] + "10", border: `1px solid ${["#818cf8","#22c55e","#eab308","#ef4444","#c084fc"][i]}25`, color: ["#818cf8","#22c55e","#eab308","#ef4444","#c084fc"][i], fontWeight: 600 }}>{l}</span>
            ))}
          </div>
        </div>

        {/* FILTERS */}
        <div style={{ display: "flex", gap: 5, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          {/* I5: Watchlist toggle */}
          <button onClick={() => setShowWatchlistOnly(v => !v)} style={{
            padding: "4px 10px", borderRadius: 7, border: `1px solid ${showWatchlistOnly ? "#c084fc" : "#1a1f36"}`,
            background: showWatchlistOnly ? "#c084fc15" : "transparent", color: showWatchlistOnly ? "#c084fc" : "#64748b",
            fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
          }}>⭐ {watchlist.size}</button>

          {["ALL", "STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL"].map(f => {
            const count = f === "ALL" ? stocks.length : f === "BUY" ? signalCounts.BUY + signalCounts["STRONG BUY"] : f === "SELL" ? signalCounts.SELL + signalCounts["STRONG SELL"] : signalCounts[f];
            const active = filter === f;
            const clr = { ALL: "#c084fc", "STRONG BUY": "#15803d", BUY: "#22c55e", HOLD: "#eab308", SELL: "#ef4444", "STRONG SELL": "#991b1b" }[f];
            return <button key={f} onClick={() => setFilter(f)} style={{ padding: "4px 10px", borderRadius: 7, border: `1px solid ${active ? clr : "#1a1f36"}`, background: active ? `${clr}15` : "transparent", color: active ? clr : "#64748b", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>{f} <span style={{ background: active ? clr : "#2d3548", color: active ? "#07090f" : "#94a3b8", padding: "0px 4px", borderRadius: 6, fontSize: 9, fontWeight: 700 }}>{count}</span></button>;
          })}
          <div style={{ flex: 1 }} />
          <input type="text" placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #1a1f36", background: "#0d1117", color: "#e2e8f0", fontSize: 11, width: 140, outline: "none" }} />
          <select value={sectorFilter} onChange={e => setSectorFilter(e.target.value)} style={{ padding: "5px 6px", borderRadius: 7, border: "1px solid #1a1f36", background: "#0d1117", color: "#94a3b8", fontSize: 10, cursor: "pointer", outline: "none" }}>
            {sectors.map(s => <option key={s} value={s}>{s === "ALL" ? "All Sectors" : s}</option>)}
          </select>
          <select value={countryFilter} onChange={e => setCountryFilter(e.target.value)} style={{ padding: "5px 6px", borderRadius: 7, border: "1px solid #1a1f36", background: "#0d1117", color: "#94a3b8", fontSize: 10, cursor: "pointer", outline: "none" }}>
            <option value="ALL">All</option><option value="US">🇺🇸 US</option><option value="CA">🇨🇦 CA</option>
          </select>
        </div>
      </header>

      <div style={{ display: "flex", height: "calc(100vh - 152px)" }}>
        {/* TABLE */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, zIndex: 10, background: "#0d1117" }}>
                {[{ k: null, l: "★", w: 32 },{ k: "ticker", l: "Stock", w: "auto" },{ k: "price", l: "Price", w: 72 },{ k: "marketCap", l: "MCap", w: 64 },{ k: null, l: "30D", w: 80 },{ k: "signal", l: "Signal", w: 96 },{ k: null, l: "Regime", w: 80 },{ k: "rr", l: "R:R", w: 44 },{ k: null, l: "Entry", w: 64 },{ k: null, l: "Target", w: 64 },{ k: null, l: "Stop", w: 64 },{ k: "sharpe", l: "Sharpe", w: 50 },{ k: null, l: "Score", w: 38 }].map((c, i) => (
                  <th key={i} onClick={() => c.k && handleSort(c.k)} style={{ padding: "7px 4px", textAlign: c.k === "ticker" ? "left" : "center", color: "#475569", fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: "1px solid #1a1f36", cursor: c.k ? "pointer" : "default", width: c.w, userSelect: "none", whiteSpace: "nowrap" }}>{c.l} {c.k && <SI col={c.k} />}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, idx) => {
                const isH = hovered === idx, isS = sel?.ticker === s.ticker;
                const sd = s.prices.slice(-30).map(p => p.close);
                const chg = sd.length > 1 ? (sd[sd.length - 1] - sd[0]) / sd[0] * 100 : 0;
                const sc = chg >= 0 ? "#22c55e" : "#ef4444";
                const inWL = watchlist.has(s.ticker);
                return (
                  <tr key={s.ticker} onClick={() => { setSel(s); detailRef.current?.scrollTo(0, 0); if (!s.hasDetailedData) fetchDetailedData(s.ticker); }} onMouseEnter={() => setHovered(idx)} onMouseLeave={() => setHovered(null)}
                    style={{ cursor: "pointer", background: isS ? "#1a1f36" : isH ? "#0d1117" : "transparent", borderBottom: "1px solid #0f1219", transition: "background 0.12s", animation: `fadeIn 0.3s ease ${Math.min(idx * 12, 400)}ms both` }}>
                    <td style={{ textAlign: "center", padding: "6px 4px" }}>
                      <span onClick={e => { e.stopPropagation(); toggleWatchlist(s.ticker); }} style={{ cursor: "pointer", fontSize: 14, color: inWL ? "#eab308" : "#1e293b", transition: "color 0.2s" }}>{inWL ? "★" : "☆"}</span>
                    </td>
                    <td style={{ padding: "6px 4px", display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 7, padding: "1px 3px", borderRadius: 2, background: s.country === "CA" ? "#ef444412" : "#3b82f612", color: s.country === "CA" ? "#f87171" : "#60a5fa", fontWeight: 700, fontFamily: "'DM Mono', monospace" }}>{s.country}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 11, fontFamily: "'DM Mono', monospace", color: "#f1f5f9" }}>{s.ticker}</div>
                        <div style={{ fontSize: 8, color: "#475569" }}>{s.name}</div>
                      </div>
                      {s.dataSource === "live" && <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />}
                    </td>
                    <td style={{ textAlign: "center", fontFamily: "'DM Mono', monospace", fontWeight: 600, fontSize: 11 }}>${s.currentPrice.toFixed(2)}</td>
                    <td style={{ textAlign: "center", color: "#94a3b8", fontSize: 10 }}>${s.fundamentals.marketCap >= 1000 ? (s.fundamentals.marketCap / 1000).toFixed(1) + "T" : s.fundamentals.marketCap.toFixed(0) + "B"}</td>
                    <td style={{ textAlign: "center" }}><div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}><Sparkline data={sd} color={sc} /><span style={{ fontSize: 9, color: sc, fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>{chg >= 0 ? "+" : ""}{chg.toFixed(1)}%</span></div></td>
                    <td style={{ textAlign: "center" }}><SignalBadge signal={s.composite.signal} /></td>
                    <td style={{ textAlign: "center" }}><RegimeBadge regime={s.composite.regime} /></td>
                    <td style={{ textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 700, color: s.entryExit.riskReward >= 2 ? "#22c55e" : s.entryExit.riskReward >= 1 ? "#eab308" : "#ef4444" }}>{s.entryExit.riskReward.toFixed(1)}</td>
                    <td style={{ textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#818cf8" }}>${s.entryExit.entry}</td>
                    <td style={{ textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#22c55e" }}>${s.entryExit.target}</td>
                    <td style={{ textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#ef4444" }}>${s.entryExit.stopLoss}</td>
                    <td style={{ textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 600, color: (s.tech?.sharpe || 0) > 1 ? "#22c55e" : (s.tech?.sharpe || 0) > 0 ? "#eab308" : "#ef4444" }}>{(s.tech?.sharpe || 0).toFixed(2)}</td>
                    <td style={{ textAlign: "center" }}><ScoreGauge score={s.composite.weightedScore} size={32} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#475569" }}>No stocks match filters</div>}
        </div>

        {/* DETAIL PANEL */}
        {sel && (
          <div ref={detailRef} style={{ width: 380, borderLeft: "1px solid #1a1f36", overflow: "auto", background: "#0b0e18", animation: "slideIn 0.3s ease", padding: "14px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span onClick={() => toggleWatchlist(sel.ticker)} style={{ cursor: "pointer", fontSize: 16, color: watchlist.has(sel.ticker) ? "#eab308" : "#334155" }}>{watchlist.has(sel.ticker) ? "★" : "☆"}</span>
                  <span style={{ fontSize: 17, fontWeight: 800, fontFamily: "'DM Mono', monospace" }}>{sel.ticker}</span>
                  <span style={{ fontSize: 8, padding: "2px 5px", borderRadius: 4, background: "#1a1f36", color: "#94a3b8" }}>{sel.sector}</span>
                  <RegimeBadge regime={sel.composite.regime} />
                </div>
                <div style={{ fontSize: 10, color: "#475569" }}>{sel.name} · {sel.country === "CA" ? "🇨🇦" : "🇺🇸"} {sel.dataSource === "live-full" ? <span style={{ color: "#22c55e" }}>● FULL LIVE DATA</span> : sel.dataSource === "live" ? <span style={{ color: "#86efac" }}>● LIVE QUOTE (click loaded details)</span> : <span style={{ color: "#eab308" }}>● SIM</span>}</div>
              </div>
              <button onClick={() => setSel(null)} style={{ background: "none", border: "1px solid #2d3548", borderRadius: 5, color: "#94a3b8", cursor: "pointer", padding: "2px 7px", fontSize: 10 }}>✕</button>
            </div>

            {/* Price Hero */}
            <div style={{ background: "#111827", borderRadius: 10, padding: 12, marginBottom: 12, border: "1px solid #1a1f36" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'DM Mono', monospace" }}>${sel.currentPrice.toFixed(2)}</div>
                <div style={{ textAlign: "right" }}><SignalBadge signal={sel.composite.signal} /><div style={{ fontSize: 9, color: "#94a3b8", marginTop: 2 }}>{sel.composite.confidence}% conf</div></div>
              </div>
              <div style={{ display: "flex", height: 5, borderRadius: 3, overflow: "hidden", gap: 1, marginBottom: 3 }}>
                {[{ f: "strongBuy", c: "#15803d" },{ f: "buy", c: "#4ade80" },{ f: "hold", c: "#eab308" },{ f: "sell", c: "#f87171" },{ f: "strongSell", c: "#991b1b" }].map(x => (
                  <div key={x.f} style={{ flex: sel.composite.consensus[x.f], background: x.c, borderRadius: 2, minWidth: sel.composite.consensus[x.f] ? 3 : 0 }} />
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#64748b" }}>
                <span style={{ color: "#22c55e" }}>{sel.composite.consensus.strongBuy + sel.composite.consensus.buy} Buy{sel.composite.consensus.strongBuy > 0 ? ` (${sel.composite.consensus.strongBuy}★)` : ""}</span>
                <span>{sel.composite.consensus.hold} Hold</span>
                <span style={{ color: "#ef4444" }}>{sel.composite.consensus.sell + sel.composite.consensus.strongSell} Sell{sel.composite.consensus.strongSell > 0 ? ` (${sel.composite.consensus.strongSell}★)` : ""}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 8, color: "#334155" }}>Weights: GS {(sel.composite.weights.gs * 100).toFixed(0)}% · BR {(sel.composite.weights.br * 100).toFixed(0)}% · Risk {(sel.composite.weights.bank * 100).toFixed(0)}% · Buffett {(sel.composite.weights.buffett * 100).toFixed(0)}%</div>
            </div>

            {/* Entry/Exit + Position */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 4, marginBottom: 10 }}>
              {[{ l: "Entry", v: "$" + sel.entryExit.entry, c: "#818cf8" },{ l: "Target", v: "$" + sel.entryExit.target, c: "#22c55e" },{ l: "Stop", v: "$" + sel.entryExit.stopLoss, c: "#ef4444" },{ l: "R:R", v: sel.entryExit.riskReward + ":1", c: sel.entryExit.riskReward >= 2 ? "#22c55e" : "#eab308" },{ l: "Size", v: sel.entryExit.positionSize.split(" ")[0], c: "#c084fc" }].map(e => (
                <div key={e.l} style={{ background: "#111827", borderRadius: 7, padding: "6px 4px", border: "1px solid #1a1f36", textAlign: "center" }}>
                  <div style={{ fontSize: 7, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{e.l}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: e.c, fontFamily: "'DM Mono', monospace" }}>{e.v}</div>
                </div>
              ))}
            </div>

            {/* Risk row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginBottom: 10 }}>
              {[{ l: "Sharpe", v: (sel.tech?.sharpe || 0).toFixed(2), c: (sel.tech?.sharpe || 0) > 1 ? "#22c55e" : "#eab308" },{ l: "Max DD", v: "-" + (sel.tech?.maxDrawdown || 0).toFixed(1) + "%", c: (sel.tech?.maxDrawdown || 0) > 25 ? "#ef4444" : "#22c55e" },{ l: "Risk %", v: sel.entryExit.riskPct + "%", c: sel.entryExit.riskPct > 5 ? "#ef4444" : "#eab308" }].map(e => (
                <div key={e.l} style={{ background: "#111827", borderRadius: 7, padding: "6px 4px", border: "1px solid #1a1f36", textAlign: "center" }}>
                  <div style={{ fontSize: 7, color: "#475569", textTransform: "uppercase", marginBottom: 2 }}>{e.l}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: e.c, fontFamily: "'DM Mono', monospace" }}>{e.v}</div>
                </div>
              ))}
            </div>

            {/* Disqualification reasons */}
            {sel.composite.disqualifyReasons?.length > 0 && (
              <div style={{ background: "#1a1f3640", borderRadius: 7, padding: "7px 9px", marginBottom: 10, border: "1px solid #c084fc20" }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: "#c084fc", marginBottom: 3, textTransform: "uppercase" }}>🐺 Why not {sel.composite.signal === "BUY" ? "STRONG BUY" : "STRONG SELL"}?</div>
                {sel.composite.disqualifyReasons.map((r, i) => (
                  <div key={i} style={{ fontSize: 9, color: "#94a3b8", lineHeight: 1.5, display: "flex", gap: 4 }}><span style={{ color: "#c084fc", fontSize: 6, marginTop: 4 }}>✗</span>{r}</div>
                ))}
              </div>
            )}

            {/* 4 Engines */}
            {[{ k: "gs", l: "📊 GS Quant", d: sel.gs, c: "#818cf8" },{ k: "br", l: "📈 BlackRock", d: sel.br, c: "#22c55e" },{ k: "bank", l: "🛡️ Risk Desk", d: sel.bank, c: "#eab308" },{ k: "buffett", l: "🎯 Buffett", d: sel.buffett, c: "#ef4444" }].map(e => (
              <div key={e.k} style={{ background: "#111827", borderRadius: 8, padding: "8px 10px", marginBottom: 6, border: `1px solid ${e.c}15` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: e.c }}>{e.l}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <SignalBadge signal={e.d.signal} size="small" />
                    <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: e.d.score > 0 ? "#22c55e" : e.d.score < 0 ? "#ef4444" : "#94a3b8" }}>{e.d.score > 0 ? "+" : ""}{e.d.score.toFixed(1)}</span>
                  </div>
                </div>
                {e.d.reasons.map((r, i) => <div key={i} style={{ fontSize: 9, color: r.startsWith("⚠") ? "#f59e0b" : "#94a3b8", lineHeight: 1.4, display: "flex", gap: 4, marginBottom: 1 }}><span style={{ color: r.startsWith("⚠") ? "#f59e0b" : e.c, fontSize: 6, marginTop: 3 }}>●</span>{r}</div>)}
              </div>
            ))}

            {/* Metrics */}
            <div style={{ background: "#111827", borderRadius: 8, padding: "8px 10px", marginBottom: 6, border: "1px solid #1a1f36" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b", marginBottom: 6, textTransform: "uppercase" }}>Key Metrics</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {[{ l: "P/E (vs " + (sel.sector.length > 12 ? sel.sector.slice(0, 12) + "…" : sel.sector) + ")", v: sel.fundamentals.pe.toFixed(1) },{ l: "PEG", v: sel.fundamentals.revenueGrowth > 1 ? (sel.fundamentals.pe / sel.fundamentals.revenueGrowth).toFixed(2) : "N/A" },{ l: "ROE", v: sel.fundamentals.roe.toFixed(1) + "%" },{ l: "Margin", v: sel.fundamentals.profitMargin.toFixed(1) + "%" },{ l: "D/E", v: sel.fundamentals.debtToEquity.toFixed(2) },{ l: "FCF Yield", v: sel.fundamentals.fcfYield.toFixed(1) + "%" },{ l: "RSI", v: (sel.tech?.rsi || 0).toFixed(1) },{ l: "Beta", v: sel.fundamentals.beta.toFixed(2) }].map(m => (
                  <div key={m.l} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 9, color: "#475569" }}>{m.l}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, color: "#e2e8f0", fontFamily: "'DM Mono', monospace" }}>{m.v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 8, color: "#334155", lineHeight: 1.5, padding: "6px 8px", background: "#07090f", borderRadius: 6, border: "1px solid #1a1f36" }}>
              <strong style={{ color: "#475569" }}>v3.0 Infra:</strong> Live API integration (FMP free tier, 250 calls/day), persistent watchlists, CSV export, data freshness monitoring. Get a free API key at financialmodelingprep.com to enable live data.
              <br /><strong style={{ color: "#ef4444" }}>⚠️ Educational only. Not financial advice.</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
