// ═══════════════════════════════════════════════════════════════════════════════
// PARTICLE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
class ParticleSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.particles = [];
    this.mouse  = { x: -9999, y: -9999 };
    this._rafId = null;
    this._resizeTimer = null;

    this._onResize    = () => { clearTimeout(this._resizeTimer); this._resizeTimer = setTimeout(() => this._resize(), 250); };
    this._onMouseMove = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };

    window.addEventListener('resize',    this._onResize);
    window.addEventListener('mousemove', this._onMouseMove);

    this._resize();
    this._animate();
  }

  _resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this._init();
  }

  _init() {
    const count = Math.min(Math.floor((this.canvas.width * this.canvas.height) / 18000), 80);
    this.particles = Array.from({ length: count }, () => ({
      x: Math.random() * this.canvas.width,
      y: Math.random() * this.canvas.height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      size: Math.random() * 2 + 0.5,
      opacity: Math.random() * 0.4 + 0.1,
      // Store as [r,g,b] so we never do string replacement in the hot path
      rgb: Math.random() > 0.5 ? [0, 240, 255] : [180, 74, 255],
      pulseSpeed: Math.random() * 0.02 + 0.005,
      pulsePhase: Math.random() * Math.PI * 2,
    }));
  }

  _animate() {
    const { ctx, canvas, particles, mouse } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = Date.now(); // cache once — avoids per-particle call
    const CONN_SQ  = 120 * 120; // squared thresholds — no sqrt needed
    const MOUSE_SQ = 150 * 150;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      // Mouse repulsion (squared distance — no sqrt)
      const mdx = mouse.x - p.x, mdy = mouse.y - p.y;
      const mdSq = mdx * mdx + mdy * mdy;
      if (mdSq < MOUSE_SQ) {
        const force = (MOUSE_SQ - mdSq) / MOUSE_SQ * 0.02;
        p.vx -= mdx * force;
        p.vy -= mdy * force;
      }

      p.vx *= 0.999;
      p.vy *= 0.999;

      if (p.x < -10)                  p.x = canvas.width + 10;
      else if (p.x > canvas.width + 10) p.x = -10;
      if (p.y < -10)                   p.y = canvas.height + 10;
      else if (p.y > canvas.height + 10) p.y = -10;

      const alpha = p.opacity * (Math.sin(now * p.pulseSpeed + p.pulsePhase) * 0.3 + 0.7);
      const [r, g, b] = p.rgb;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fill();

      // Connections (j > i avoids duplicates; squared distance)
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dx = p.x - q.x, dy = p.y - q.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < CONN_SQ) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = `rgba(0,240,255,${(1 - dSq / CONN_SQ) * 0.12})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    this._rafId = requestAnimationFrame(() => this._animate());
  }

  destroy() {
    cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize',    this._onResize);
    window.removeEventListener('mousemove', this._onMouseMove);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchWithTimeout(url, ms = 30000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(tid);
  }
}

const getSignalClass = (signal) =>
  signal.includes('BUY') ? 'buy' : signal.includes('SELL') ? 'sell' : 'hold';

const SIGNAL_COLORS = { buy: 'var(--green)', sell: 'var(--red)', hold: 'var(--orange)' };
const getSignalColor = (cls) => SIGNAL_COLORS[cls] ?? SIGNAL_COLORS.hold;

const cleanSymbol = (s) => String(s).replace('.NS', '').replace('.BO', '');

function formatNumber(num) {
  if (num == null || isNaN(num)) return '--';
  return Number(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatVolume(vol) {
  if (!vol) return '--';
  if (vol >= 10_000_000) return (vol / 10_000_000).toFixed(2) + ' Cr';
  if (vol >= 100_000)    return (vol / 100_000).toFixed(2) + ' L';
  if (vol >= 1_000)      return (vol / 1_000).toFixed(1) + ' K';
  return String(vol);
}

function formatNewsDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return dateStr.slice(0, 16); }
}

const SCORE_RATING_COLOR = {
  'STRONG BUY': 'var(--green)',
  'BUY':        '#56e88b',
  'HOLD':       'var(--orange)',
  'WATCH':      '#ffcc44',
  'AVOID':      'var(--red)',
};

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════
let currentChart   = null;
let currentStockData = null;
let searchTimeout  = null;
let lastMarketOpen = null;

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('particleCanvas');
  if (canvas) new ParticleSystem(canvas);

  updateTime();
  setInterval(updateTime, 1000);
  checkMarketStatus();
  setInterval(checkMarketStatus, 60_000);
  loadIndices();
  loadPopularStocks();
  setupSearch();
  setupKeyboardShortcuts();
});

// ═══════════════════════════════════════════════════════════════════════════════
// TIME & MARKET STATUS
// ═══════════════════════════════════════════════════════════════════════════════
function updateTime() {
  const el = document.getElementById('liveTime');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'Asia/Kolkata',
  }) + ' IST';
}

function checkMarketStatus() {
  // Use Intl directly — no double-conversion via string
  const now   = new Date();
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find(p => p.type === type)?.value;
  const hours   = parseInt(get('hour'),   10);
  const minutes = parseInt(get('minute'), 10);
  const weekday = get('weekday'); // 'Mon', 'Tue', …
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const totalMin  = hours * 60 + minutes;
  const isOpen    = isWeekday && totalMin >= 555 && totalMin <= 930;

  // Only touch DOM when status changes
  if (isOpen === lastMarketOpen) return;
  lastMarketOpen = isOpen;

  const el = document.getElementById('marketStatus');
  if (!el) return;
  el.classList.toggle('open', isOpen);
  el.querySelector('span').textContent = isOpen ? 'MARKET OPEN' : 'MARKET CLOSED';
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDICES
// ═══════════════════════════════════════════════════════════════════════════════
async function loadIndices() {
  try {
    const res  = await fetchWithTimeout('/api/indices', 30_000);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const nameMap = { '^NSEI': 'NIFTY 50', '^BSESN': 'SENSEX', '^NSEBANK': 'BANK NIFTY' };
    const items   = data.map(idx => {
      const pos = idx.change >= 0;
      return `<div class="index-item">
        <span class="index-name">${nameMap[idx.symbol] || idx.name || idx.symbol}</span>
        <span class="index-price">${formatNumber(idx.price)}</span>
        <span class="index-change ${pos ? 'positive' : 'negative'}">
          ${pos ? '▲' : '▼'} ${Math.abs(idx.change).toFixed(2)} (${Math.abs(idx.changePercent).toFixed(2)}%)
        </span>
      </div>`;
    }).join('');

    document.querySelector('.indices-ticker').innerHTML = items + items; // duplicate for infinite scroll
  } catch (err) {
    console.error('Indices failed:', err);
    document.querySelector('.indices-ticker').innerHTML =
      '<div class="index-item" style="color:var(--text-muted)">Indices unavailable</div>';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POPULAR STOCKS
// ═══════════════════════════════════════════════════════════════════════════════
async function loadPopularStocks() {
  const grid = document.getElementById('popularStocks');
  // Skeleton — 20 placeholders matches server's POPULAR_STOCKS list length
  grid.innerHTML = Array(20).fill(`
    <div class="stock-card" style="opacity:.4;pointer-events:none">
      <div class="stock-card-header">
        <div>
          <div class="loading-pulse" style="width:120px;height:18px;background:var(--border);border-radius:4px"></div>
          <div class="loading-pulse" style="width:80px;height:12px;background:var(--border);border-radius:4px;margin-top:6px"></div>
        </div>
        <div class="loading-pulse" style="width:60px;height:22px;background:var(--border);border-radius:8px"></div>
      </div>
      <div class="loading-pulse" style="width:110px;height:28px;background:var(--border);border-radius:4px;margin-top:10px"></div>
    </div>`).join('');

  try {
    const res  = await fetchWithTimeout('/api/popular', 60_000);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    grid.innerHTML = data.map(s => {
      const pos = s.change >= 0;
      return `<div class="stock-card" onclick="loadStock('${s.symbol}')">
        <div class="stock-card-header">
          <div>
            <div class="stock-card-name">${s.name}</div>
            <div class="stock-card-symbol">${cleanSymbol(s.symbol)}</div>
          </div>
          <div class="stock-card-badge ${pos ? 'positive' : 'negative'}">
            ${pos ? '▲' : '▼'} ${Math.abs(s.changePercent).toFixed(2)}%
          </div>
        </div>
        <div class="stock-card-price">₹${formatNumber(s.price)}</div>
        <div class="stock-card-change ${pos ? 'positive' : 'negative'}">
          ${pos ? '+' : ''}${s.change.toFixed(2)} (${pos ? '+' : ''}${s.changePercent.toFixed(2)}%)
        </div>
        <div class="stock-card-footer">
          <span class="stock-card-vol">Vol: ${formatVolume(s.volume)}</span>
          <span class="stock-card-arrow">→</span>
        </div>
      </div>`;
    }).join('');

    // Trigger stagger animation — remove then re-add so it replays cleanly
    grid.classList.remove('stagger-in');
    void grid.offsetWidth; // force reflow
    grid.classList.add('stagger-in');
  } catch (err) {
    console.error('Popular stocks failed:', err);
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 20px">
      <div style="font-size:2rem;margin-bottom:12px">📡</div>
      <p style="color:var(--text-secondary)">Connecting to market data…</p>
      <button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;background:var(--gradient-main);border:none;border-radius:10px;color:var(--bg-primary);font-weight:600;cursor:pointer;font-family:var(--font-body)">Refresh</button>
    </div>`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════════════════════
function setupSearch() {
  const input   = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  const hide    = () => results.classList.remove('active');

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();
    if (q.length < 2) { hide(); return; }
    searchTimeout = setTimeout(async () => {
      try {
        const res  = await fetchWithTimeout(`/api/search?q=${encodeURIComponent(q)}`, 10_000);
        const data = await res.json();
        results.innerHTML = data.length
          ? data.map(s => `<div class="search-result-item" onclick="loadStock('${s.symbol}')">
              <span class="search-result-name">${s.name}</span>
              <span class="search-result-symbol">${s.symbol}</span>
            </div>`).join('')
          : '<div class="search-result-item"><span class="search-result-name" style="color:var(--text-muted)">No Indian stocks found</span></div>';
        results.classList.add('active');
      } catch { /* silent */ }
    }, 350);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const q = input.value.trim(); if (q) loadStock(q); hide(); }
    if (e.key === 'Escape') { hide(); input.blur(); }
  });

  document.addEventListener('click', (e) => { if (!e.target.closest('.search-container')) hide(); });
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('searchInput').focus(); }
    if (e.key === 'Escape' && !document.getElementById('stockView').classList.contains('hidden')) showLanding();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// STOCK LOAD / NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════
async function loadStock(symbol) {
  document.getElementById('searchInput').value = '';
  document.getElementById('searchResults').classList.remove('active');
  showLoading(true);
  try {
    const res  = await fetchWithTimeout(`/api/stock/${encodeURIComponent(symbol)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    currentStockData = data;
    renderStockView(data);
    document.getElementById('landingView').classList.add('hidden');
    document.getElementById('stockView').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error('loadStock failed:', err);
    alert('Stock data fetch failed — please try again.');
  } finally {
    showLoading(false);
  }
}

function showLanding() {
  document.getElementById('stockView').classList.add('hidden');
  document.getElementById('landingView').classList.remove('hidden');
  if (currentChart) { currentChart.destroy(); currentChart = null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER STOCK VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function renderStockView(data) {
  renderStockHeader(data);
  renderSignal(data);
  renderInvestorScores(data);
  renderChart(data, 'line');
  renderIndicators(data);
  renderTargets(data);
  renderReasons(data);
  loadNewsSection(data.symbol, data.name);
  // Chart controls: clone nodes to avoid listener accumulation
  document.querySelectorAll('.chart-btn').forEach(btn => {
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.addEventListener('click', () => {
      document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
      fresh.classList.add('active');
      renderChart(data, fresh.dataset.type);
    });
  });
}

function renderStockHeader(data) {
  const pos = data.change >= 0;
  document.getElementById('stockHeader').innerHTML = `
    <div class="stock-info">
      <h2>${data.name}</h2>
      <div class="symbol-tag">${data.symbol}</div>
      <div class="stock-meta">
        <div class="meta-item">Open: <span>₹${formatNumber(data.open)}</span></div>
        <div class="meta-item">High: <span>₹${formatNumber(data.high)}</span></div>
        <div class="meta-item">Low: <span>₹${formatNumber(data.low)}</span></div>
        <div class="meta-item">Prev Close: <span>₹${formatNumber(data.prevClose)}</span></div>
        <div class="meta-item">Volume: <span>${formatVolume(data.volume)}</span></div>
      </div>
    </div>
    <div>
      <div class="stock-price-big">₹${formatNumber(data.price)}</div>
      <div class="stock-change-big ${pos ? 'positive' : 'negative'}">
        ${pos ? '▲ +' : '▼ '}${Math.abs(data.change).toFixed(2)} (${pos ? '+' : ''}${data.changePercent.toFixed(2)}%)
      </div>
      <div style="font-size:.72rem;color:var(--text-muted);text-align:right;margin-top:6px">
        52W: ₹${formatNumber(data.fiftyTwoWeekLow)} — ₹${formatNumber(data.fiftyTwoWeekHigh)}
      </div>
    </div>`;
}

function renderSignal(data) {
  const { signal, strength } = data.analysis;
  const cls   = getSignalClass(signal);
  const color = getSignalColor(cls);

  document.getElementById('signalSection').innerHTML = `
    <div class="signal-card ${cls}">
      <div class="signal-top">
        <div>
          <div class="signal-label">AI ANALYSIS SIGNAL</div>
          <div class="signal-text">${signal}</div>
        </div>
        <div class="signal-strength">
          <div class="strength-label">Signal Strength</div>
          <div class="strength-bar"><div class="strength-fill" style="width:0%"></div></div>
          <div class="strength-value" style="color:${color}">${strength}%</div>
        </div>
      </div>
    </div>`;

  // Single setTimeout — no rAF wrapper needed
  setTimeout(() => {
    const fill = document.querySelector('.strength-fill');
    if (fill) fill.style.width = strength + '%';
  }, 100);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVESTOR SCORES  (Warren Buffett + Rakesh Jhunjhunwala)
// ═══════════════════════════════════════════════════════════════════════════════
function renderInvestorScores(data) {
  const { buffett, jhunjhunwala, metrics } = data.analysis.investorScores;
  const el = document.getElementById('investorScores');
  if (!el) return;

  const scoreCard = ({ name, icon, score, rating, quote, positive, negative, colorVar, accentClass }) => `
    <div class="investor-card ${accentClass}">
      <div class="investor-card-header">
        <div class="investor-icon">${icon}</div>
        <div>
          <div class="investor-name">${name}</div>
          <div class="investor-philosophy">${name === 'Warren Buffett' ? 'Value · Safety · Moat' : 'Growth · Momentum · India'}</div>
        </div>
        <div class="investor-score-circle" style="--score-color:${colorVar}">
          <svg viewBox="0 0 36 36" class="score-ring">
            <path class="score-ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
            <path class="score-ring-fill" stroke="${colorVar}"
              stroke-dasharray="${score}, 100"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
          </svg>
          <div class="score-number">${score}</div>
        </div>
      </div>
      <div class="investor-rating" style="color:${SCORE_RATING_COLOR[rating] || 'var(--cyan)'}">
        ${rating}
      </div>
      <div class="investor-quote">${quote}</div>
      <div class="investor-points">
        ${positive.map(p => `<div class="inv-point bullish"><span class="inv-dot"></span>${p}</div>`).join('')}
        ${negative.map(p => `<div class="inv-point bearish"><span class="inv-dot"></span>${p}</div>`).join('')}
      </div>
    </div>`;

  const metricsHtml = `
    <div class="metrics-bar">
      ${[
        ['52W Position',    metrics.pricePosition + '%',    metrics.pricePosition > 60 ? 'positive' : metrics.pricePosition < 35 ? 'cyan' : ''],
        ['Trend Consistency', metrics.trendConsistency + '%', metrics.trendConsistency > 60 ? 'positive' : 'negative'],
        ['30D Return',      (metrics.returnPct30d > 0 ? '+' : '') + metrics.returnPct30d + '%', metrics.returnPct30d > 0 ? 'positive' : 'negative'],
        ['Daily Volatility', metrics.volatilityPct + '%',   metrics.volatilityPct < 1.5 ? 'positive' : 'negative'],
        ['Upside to Res.',  metrics.upsideToResistance + '%', 'cyan'],
        ['Above Support',   '+' + metrics.priceVsSupport + '%', 'positive'],
      ].map(([label, val, cls]) => `
        <div class="metric-chip">
          <div class="metric-chip-label">${label}</div>
          <div class="metric-chip-value ${cls}">${val}</div>
        </div>`).join('')}
    </div>`;

  el.innerHTML = `
    <div class="investor-scores-header">
      <h3 class="section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        INVESTOR INTELLIGENCE
      </h3>
    </div>
    <div class="investor-grid">
      ${scoreCard({ name: 'Warren Buffett', icon: '🏦', score: buffett.score, rating: buffett.rating, quote: buffett.quote, positive: buffett.positive, negative: buffett.negative, colorVar: '#00e676', accentClass: 'buffett' })}
      ${scoreCard({ name: 'Rakesh Jhunjhunwala', icon: '📈', score: jhunjhunwala.score, rating: jhunjhunwala.rating, quote: jhunjhunwala.quote, positive: jhunjhunwala.positive, negative: jhunjhunwala.negative, colorVar: '#b44aff', accentClass: 'rj' })}
    </div>
    ${metricsHtml}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHART
// ═══════════════════════════════════════════════════════════════════════════════
function renderChart(data, type) {
  const ctx = document.getElementById('priceChart').getContext('2d');
  if (currentChart) currentChart.destroy();

  const { chartData } = data;
  const labels = chartData.map(d =>
    new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
  const closes = chartData.map(d => d.close);

  if (type === 'line') {
    const grad = ctx.createLinearGradient(0, 0, 0, 360);
    grad.addColorStop(0,   'rgba(0,240,255,.18)');
    grad.addColorStop(0.5, 'rgba(0,240,255,.05)');
    grad.addColorStop(1,   'rgba(0,240,255,0)');
    currentChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Price', data: closes, borderColor: '#00f0ff', borderWidth: 2.5, backgroundColor: grad, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 7, pointHoverBackgroundColor: '#00f0ff', pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2 }] },
      options: chartOptions(),
    });
  } else {
    const colors = chartData.map(d => d.close >= d.open ? '#00e676' : '#ff5252');
    currentChart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'OHLC', data: chartData.map(d => Math.abs(d.close - d.open) || 0.5), backgroundColor: colors.map(c => c + '66'), borderColor: colors, borderWidth: 1.5, borderRadius: 2, base: chartData.map(d => Math.min(d.open, d.close)) }] },
      options: { ...chartOptions(), plugins: { ...chartOptions().plugins, tooltip: { ...chartOptions().plugins.tooltip, callbacks: { label: (ctx) => { const d = chartData[ctx.dataIndex]; return [`O: ₹${d.open?.toFixed(2)}`, `H: ₹${d.high?.toFixed(2)}`, `L: ₹${d.low?.toFixed(2)}`, `C: ₹${d.close?.toFixed(2)}`]; } } } } },
    });
  }
}

function chartOptions() {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 1200, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: 'rgba(13,21,40,.95)', titleColor: '#00f0ff', bodyColor: '#e8eaf6', borderColor: '#1a2545', borderWidth: 1, padding: 14, cornerRadius: 10, titleFont: { family: 'Orbitron', size: 10 }, bodyFont: { family: 'Space Grotesk', size: 13 }, callbacks: { label: (ctx) => `₹${ctx.parsed.y?.toFixed(2)}` } },
    },
    scales: {
      x: { grid: { color: 'rgba(26,37,69,.5)', drawBorder: false }, ticks: { color: '#5a6380', font: { size: 10 }, maxTicksLimit: 10 } },
      y: { grid: { color: 'rgba(26,37,69,.5)', drawBorder: false }, ticks: { color: '#5a6380', font: { size: 10 }, callback: v => '₹' + Number(v).toLocaleString('en-IN') } },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDICATORS  /  TARGETS  /  REASONS
// ═══════════════════════════════════════════════════════════════════════════════
function renderIndicators(data) {
  const ind = data.analysis.indicators;
  const rsiColor = ind.rsi < 30 ? 'var(--green)' : ind.rsi > 70 ? 'var(--red)' : 'var(--cyan)';
  const rsiLabel = ind.rsi < 30 ? 'Oversold — Buy Zone' : ind.rsi > 70 ? 'Overbought — Sell Zone' : 'Neutral';

  document.getElementById('indicatorsPanel').innerHTML = `
    <div class="indicator-item">
      <div class="indicator-name">RSI (14)</div>
      <div class="indicator-value" style="color:${rsiColor}">${ind.rsi}</div>
      <div class="indicator-sub">${rsiLabel}</div>
      <div class="indicator-bar"><div class="indicator-bar-fill" style="width:${ind.rsi}%;background:${rsiColor}"></div></div>
    </div>
    <div class="indicator-item">
      <div class="indicator-name">MACD</div>
      <div class="indicator-value" style="color:${ind.macd?.histogram >= 0 ? 'var(--green)' : 'var(--red)'}">${ind.macd?.value ?? 'N/A'}</div>
      <div class="indicator-sub">Signal: ${ind.macd?.signal ?? 'N/A'} | Histogram: ${ind.macd?.histogram ?? 'N/A'}</div>
    </div>
    <div class="indicator-item">
      <div class="indicator-name">SMA 20</div>
      <div class="indicator-value">₹${formatNumber(ind.sma20)}</div>
      <div class="indicator-sub" style="color:${data.price > ind.sma20 ? 'var(--green)' : 'var(--red)'}">Price ${data.price > ind.sma20 ? 'Above ▲' : 'Below ▼'} SMA20</div>
    </div>
    <div class="indicator-item">
      <div class="indicator-name">SMA 50</div>
      <div class="indicator-value">₹${formatNumber(ind.sma50)}</div>
      <div class="indicator-sub" style="color:${data.price > ind.sma50 ? 'var(--green)' : 'var(--red)'}">Price ${data.price > ind.sma50 ? 'Above ▲' : 'Below ▼'} SMA50</div>
    </div>
    <div class="indicator-item">
      <div class="indicator-name">BOLLINGER BANDS</div>
      <div class="indicator-value" style="font-size:1rem">${ind.bollingerBands ? `₹${ind.bollingerBands.lower} — ₹${ind.bollingerBands.upper}` : 'N/A'}</div>
      <div class="indicator-sub">${ind.bollingerBands ? `Middle: ₹${ind.bollingerBands.middle}` : ''}</div>
    </div>
    <div class="indicator-item">
      <div class="indicator-name">VOLUME RATIO</div>
      <div class="indicator-value" style="color:${ind.volumeRatio > 1.5 ? 'var(--orange)' : ind.volumeRatio < 0.5 ? 'var(--red)' : 'var(--text-primary)'}">${ind.volumeRatio}x</div>
      <div class="indicator-sub">${ind.volumeRatio > 1.5 ? 'High Volume Activity' : ind.volumeRatio < 0.5 ? 'Low Volume' : 'Normal Volume'}</div>
    </div>`;
}

function renderTargets(data) {
  const t = data.analysis.targets;
  document.getElementById('targetsSection').innerHTML = `
    <div class="card-header"><h3>Price Targets & Key Levels</h3></div>
    <div class="targets-grid stagger-in">
      <div class="target-card green"><div class="target-label">TARGET 1</div><div class="target-value">₹${formatNumber(t.target1)}</div></div>
      <div class="target-card green"><div class="target-label">TARGET 2</div><div class="target-value">₹${formatNumber(t.target2)}</div></div>
      <div class="target-card red"><div class="target-label">STOP LOSS</div><div class="target-value">₹${formatNumber(t.stopLoss)}</div></div>
      <div class="target-card cyan"><div class="target-label">SUPPORT</div><div class="target-value">₹${formatNumber(t.support)}</div></div>
      <div class="target-card purple"><div class="target-label">RESISTANCE</div><div class="target-value">₹${formatNumber(t.resistance)}</div></div>
      <div class="target-card orange"><div class="target-label">PIVOT POINT</div><div class="target-value">₹${formatNumber(t.pivotPoint)}</div></div>
    </div>`;
}

function renderReasons(data) {
  const { reasons } = data.analysis;
  const BULLISH_KEYWORDS = ['Oversold', 'Bullish', 'Price >', 'Golden', 'Lower Bollinger', 'Low Zone', 'High Volume Confirmation'];
  document.getElementById('reasonsCard').innerHTML = `
    <div class="card-header"><h3>Analysis Breakdown</h3></div>
    <div class="reasons-list stagger-in">
      ${reasons.map(r => {
        const bullish = BULLISH_KEYWORDS.some(kw => r.includes(kw));
        return `<div class="reason-tag ${bullish ? 'bullish' : 'bearish'}"><div class="reason-dot"></div>${r}</div>`;
      }).join('')}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEWS SECTION
// ═══════════════════════════════════════════════════════════════════════════════
async function loadNewsSection(symbol, name) {
  const el = document.getElementById('newsSection');
  if (!el) return;

  // Skeleton while loading
  el.innerHTML = `
    <div class="news-header">
      <h3 class="section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
          <path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>
        </svg>
        STOCK IN NEWS
      </h3>
    </div>
    <div class="news-skeleton">
      ${Array(4).fill(`<div class="news-skeleton-card">
        <div class="loading-pulse" style="width:70px;height:18px;background:var(--border);border-radius:20px;margin-bottom:10px"></div>
        <div class="loading-pulse" style="width:100%;height:14px;background:var(--border);border-radius:4px;margin-bottom:6px"></div>
        <div class="loading-pulse" style="width:80%;height:14px;background:var(--border);border-radius:4px;margin-bottom:14px"></div>
        <div class="loading-pulse" style="width:120px;height:12px;background:var(--border);border-radius:4px"></div>
      </div>`).join('')}
    </div>`;

  try {
    const params = name ? `?name=${encodeURIComponent(name)}` : '';
    const res  = await fetchWithTimeout(`/api/news/${encodeURIComponent(symbol)}${params}`, 15000);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderNewsSection(data);
  } catch (err) {
    el.innerHTML = `
      <div class="news-header">
        <h3 class="section-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
            <path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>
          </svg>
          STOCK IN NEWS
        </h3>
      </div>
      <div class="news-empty">📡 News feed temporarily unavailable</div>`;
  }
}

function renderNewsSection(data) {
  const el = document.getElementById('newsSection');
  if (!el) return;

  const { news, overallSentiment, newsSignal, positiveCount, negativeCount } = data;
  const neutralCount = news.length - positiveCount - negativeCount;

  const signalCls  = newsSignal === 'BUY' ? 'buy' : newsSignal === 'AVOID' ? 'sell' : 'hold';
  const signalText = newsSignal === 'BUY' ? '📈 NEWS SIGNAL: BUY'
    : newsSignal === 'AVOID' ? '📉 NEWS SIGNAL: AVOID' : '⏸ NEWS SIGNAL: NEUTRAL';

  const recClass = newsSignal === 'BUY' ? 'buy' : newsSignal === 'AVOID' ? 'sell' : 'hold';
  const recText  = newsSignal === 'BUY'   ? '✅ News suggests BUY'
    : newsSignal === 'AVOID' ? '🚫 News suggests AVOID' : '⏸ Mixed / No clear signal';

  const SENT_LABEL = { positive: '🟢 Positive', negative: '🔴 Negative', neutral: '🟡 Neutral' };

  el.innerHTML = `
    <div class="news-header">
      <h3 class="section-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
          <path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>
        </svg>
        STOCK IN NEWS
      </h3>
      <div class="news-overall-signal ${signalCls}">${signalText}</div>
    </div>

    <div class="news-sentiment-summary">
      <div class="news-sent-item">
        <div class="news-sent-dot positive"></div>
        <span class="news-sent-count">${positiveCount}</span>
        <span class="news-sent-label">Positive</span>
      </div>
      <div class="news-sent-divider"></div>
      <div class="news-sent-item">
        <div class="news-sent-dot negative"></div>
        <span class="news-sent-count">${negativeCount}</span>
        <span class="news-sent-label">Negative</span>
      </div>
      <div class="news-sent-divider"></div>
      <div class="news-sent-item">
        <div class="news-sent-dot neutral"></div>
        <span class="news-sent-count">${neutralCount}</span>
        <span class="news-sent-label">Neutral</span>
      </div>
      <div class="news-recommendation ${recClass}">${recText}</div>
    </div>

    ${news.length === 0
      ? '<div class="news-empty">No recent news found for this stock.</div>'
      : `<div class="news-grid">
        ${news.map(item => `
          <a class="news-card ${item.sentiment}" href="${item.link}" target="_blank" rel="noopener noreferrer">
            <div class="news-sentiment-badge">${SENT_LABEL[item.sentiment]}</div>
            <div class="news-title">${item.title}</div>
            <div class="news-footer">
              <span class="news-source">${item.source || 'News'}</span>
              <span class="news-date">${formatNewsDate(item.pubDate)}</span>
            </div>
          </a>`).join('')}
      </div>`}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOADING
// ═══════════════════════════════════════════════════════════════════════════════
function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}
