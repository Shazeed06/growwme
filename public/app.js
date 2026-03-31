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
let currentChart     = null;
let currentStockData = null;
let searchTimeout    = null;
let lastMarketOpen   = null;
let currentTab       = 'stocks';
let sectorsLoaded    = false;
let watchlist        = JSON.parse(localStorage.getItem('sp_watchlist') || '[]');
let priceAlerts      = JSON.parse(localStorage.getItem('sp_alerts')    || '[]');

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
  loadBuyToday();
  setupSearch();
  setupKeyboardShortcuts();
  updateWatchlistCount();
  startAlertChecker();
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
  showTab(currentTab);
}

// ── Landing Tab Switcher ──────────────────────────────────────────────────────
function showTab(tab) {
  currentTab = tab;
  ['stocks', 'sectors', 'watchlist'].forEach(t => {
    document.getElementById(`panel${t.charAt(0).toUpperCase() + t.slice(1)}`)?.classList.toggle('hidden', t !== tab);
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab);
  });
  if (tab === 'sectors' && !sectorsLoaded) { sectorsLoaded = true; loadSectors(); }
  if (tab === 'watchlist') renderWatchlistPanel();
}

// ── Stocks to Buy Today ───────────────────────────────────────────────────────
async function loadBuyToday() {
  const el = document.getElementById('buyTodayGrid');
  if (!el) return;

  // Skeleton
  el.innerHTML = `<div class="buy-today-skeleton">
    ${Array(3).fill(`<div class="buy-card" style="opacity:.35;pointer-events:none">
      <div class="loading-pulse" style="width:140px;height:16px;background:var(--border);border-radius:4px;margin-bottom:6px"></div>
      <div class="loading-pulse" style="width:80px;height:12px;background:var(--border);border-radius:4px;margin-bottom:12px"></div>
      <div class="loading-pulse" style="width:100px;height:24px;background:var(--border);border-radius:4px;margin-bottom:14px"></div>
      <div class="loading-pulse" style="width:100%;height:12px;background:var(--border);border-radius:4px;margin-bottom:5px"></div>
      <div class="loading-pulse" style="width:90%;height:12px;background:var(--border);border-radius:4px"></div>
    </div>`).join('')}
  </div>`;

  try {
    const res  = await fetchWithTimeout('/api/buy-today', 90_000);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderBuyToday(data);
  } catch (err) {
    el.innerHTML = `<div class="buy-today-empty">📡 Could not load today's picks — market data loading…</div>`;
  }
}

function renderBuyToday(stocks) {
  const el = document.getElementById('buyTodayGrid');
  if (!el) return;

  const countEl = document.getElementById('buyTodayCount');
  if (countEl) countEl.textContent = `${stocks.length} stock${stocks.length !== 1 ? 's' : ''}`;

  if (stocks.length === 0) {
    el.innerHTML = '<div class="buy-today-empty">No strong buy signals in Nifty 50 right now. Check back later.</div>';
    return;
  }

  const SENT_ICON = { positive: '🟢', negative: '🔴', neutral: '🟡' };
  const SENT_TEXT = { positive: 'Positive News', negative: 'Negative News', neutral: 'Neutral News' };

  el.innerHTML = `<div class="buy-today-grid">
    ${stocks.map(s => {
      const pos = (s.changePercent || 0) >= 0;
      const isStrong = s.analysis.signal === 'STRONG BUY';
      const topReasons = s.analysis.reasons.slice(0, 3);
      const topPattern = s.patterns?.find(p => p.type === 'bullish');
      const newsItem   = s.news?.[0];

      return `<div class="buy-card" onclick="loadStock('${s.symbol}')">
        <div class="buy-card-top">
          <div>
            <div class="buy-card-name">${s.name?.split(' ').slice(0, 3).join(' ') || cleanSymbol(s.symbol)}</div>
            <div class="buy-card-symbol">${cleanSymbol(s.symbol)} · NSE</div>
          </div>
          <div class="buy-card-signal ${isStrong ? 'strong' : ''}">
            ${isStrong ? '⚡ STRONG BUY' : '↑ BUY'}
          </div>
        </div>
        <div class="buy-card-price">₹${formatNumber(s.price)}</div>
        <div class="buy-card-change ${pos ? 'positive' : 'negative'}">
          ${pos ? '▲ +' : '▼ '}${Math.abs(s.changePercent || 0).toFixed(2)}% today
        </div>
        ${topPattern ? `<div class="buy-card-pattern">🕯️ ${topPattern.name} pattern detected</div>` : ''}
        <div class="buy-card-reasons">
          ${topReasons.map(r => `<div class="buy-card-reason-item"><div class="buy-card-reason-dot"></div>${r}</div>`).join('')}
        </div>
        ${newsItem ? `<div class="buy-card-news">
          <div class="buy-card-news-label ${s.newsSentiment}">
            ${SENT_ICON[s.newsSentiment]} ${SENT_TEXT[s.newsSentiment]}
          </div>
          <div class="buy-card-news-title">${newsItem.title.slice(0, 80)}…</div>
        </div>` : ''}
        <div class="buy-card-footer">
          <div class="buy-card-strength">Signal: <span>${s.analysis.strength}%</span> · Target ₹${formatNumber(s.analysis.targets.target1)}</div>
          <button class="buy-card-analyse-btn" onclick="event.stopPropagation();loadStock('${s.symbol}')">Full Analysis →</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

// ── Sector Heatmap ────────────────────────────────────────────────────────────
async function loadSectors() {
  const el = document.getElementById('sectorHeatmap');
  if (!el) return;
  el.innerHTML = Array(8).fill(`
    <div class="sector-card" style="opacity:.4">
      <div class="loading-pulse" style="width:80px;height:16px;background:var(--border);border-radius:4px;margin-bottom:8px"></div>
      <div class="loading-pulse" style="width:50px;height:22px;background:var(--border);border-radius:4px"></div>
    </div>`).join('');
  try {
    const res  = await fetchWithTimeout('/api/sectors', 40_000);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderSectorHeatmap(data);
  } catch {
    el.innerHTML = '<div style="color:var(--text-muted);padding:20px">Sector data unavailable</div>';
  }
}

function renderSectorHeatmap(sectors) {
  const el = document.getElementById('sectorHeatmap');
  if (!el) return;
  el.innerHTML = sectors.map(s => {
    const pos = s.avgChange >= 0;
    const absChange = Math.abs(s.avgChange);
    const intensity = Math.min(absChange / 3, 1); // 3% = full intensity
    const bg = pos
      ? `rgba(68,194,127,${0.08 + intensity * 0.22})`
      : `rgba(230,91,78,${0.08 + intensity * 0.22})`;
    return `<div class="sector-card" style="background:${bg};border-color:${pos ? '#44C27F33' : '#E65B4E33'}" onclick="">
      <div class="sector-name">${s.sector}</div>
      <div class="sector-change ${pos ? 'positive' : 'negative'}">${pos ? '▲' : '▼'} ${absChange.toFixed(2)}%</div>
      <div class="sector-stocks-mini">
        ${s.stocks.slice(0, 3).map(st => `
          <span class="sector-stock-chip ${(st.changePercent||0) >= 0 ? 'positive' : 'negative'}" onclick="loadStock('${st.symbol}')">
            ${cleanSymbol(st.symbol)} ${(st.changePercent||0) >= 0 ? '▲' : '▼'}${Math.abs(st.changePercent||0).toFixed(1)}%
          </span>`).join('')}
      </div>
    </div>`;
  }).join('');
}

// ── Watchlist ─────────────────────────────────────────────────────────────────
function updateWatchlistCount() {
  const el = document.getElementById('watchlistCount');
  if (!el) return;
  if (watchlist.length > 0) { el.textContent = watchlist.length; el.style.display = ''; }
  else el.style.display = 'none';
}

function toggleWatchlist() {
  if (!currentStockData) return;
  const { symbol, name } = currentStockData;
  const idx = watchlist.findIndex(w => w.symbol === symbol);
  if (idx >= 0) watchlist.splice(idx, 1);
  else watchlist.push({ symbol, name });
  localStorage.setItem('sp_watchlist', JSON.stringify(watchlist));
  updateWatchlistBtn(symbol);
  updateWatchlistCount();
}

function updateWatchlistBtn(symbol) {
  const btn  = document.getElementById('watchlistBtn');
  const text = document.getElementById('watchlistBtnText');
  if (!btn || !text) return;
  const inList = watchlist.some(w => w.symbol === symbol);
  btn.classList.toggle('active', inList);
  text.textContent = inList ? '★ In Watchlist' : 'Add to Watchlist';
}

function renderWatchlistPanel() {
  const el = document.getElementById('watchlistGrid');
  if (!el) return;
  if (watchlist.length === 0) {
    el.innerHTML = `<div class="watchlist-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color:var(--text-muted)"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      <p>Your watchlist is empty.</p>
      <p style="font-size:.82rem;color:var(--text-muted)">Search for a stock and click "Add to Watchlist" to track it here.</p>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="stocks-grid">
    ${watchlist.map(w => `
      <div class="stock-card" onclick="loadStock('${w.symbol}')">
        <div class="stock-card-header">
          <div>
            <div class="stock-card-name">${w.name}</div>
            <div class="stock-card-symbol">${cleanSymbol(w.symbol)}</div>
          </div>
          <button onclick="event.stopPropagation();removeFromWatchlist('${w.symbol}')" class="watchlist-remove-btn" title="Remove">✕</button>
        </div>
        <div style="color:var(--text-muted);font-size:.8rem;margin-top:8px">Click to analyse →</div>
      </div>`).join('')}
  </div>`;
}

function removeFromWatchlist(symbol) {
  watchlist = watchlist.filter(w => w.symbol !== symbol);
  localStorage.setItem('sp_watchlist', JSON.stringify(watchlist));
  updateWatchlistCount();
  renderWatchlistPanel();
}

// ── Price Alerts ──────────────────────────────────────────────────────────────
function toggleAlertsPanel() {
  const panel = document.getElementById('alertsPanel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) renderAlertsList();
}

function addAlert() {
  if (!currentStockData) return;
  const dir   = document.getElementById('alertDir')?.value;
  const price = parseFloat(document.getElementById('alertPrice')?.value);
  if (!price || isNaN(price)) { alert('Please enter a valid price.'); return; }
  priceAlerts.push({ symbol: currentStockData.symbol, name: currentStockData.name, dir, price, id: Date.now() });
  localStorage.setItem('sp_alerts', JSON.stringify(priceAlerts));
  document.getElementById('alertPrice').value = '';
  renderAlertsList();
}

function deleteAlert(id) {
  priceAlerts = priceAlerts.filter(a => a.id !== id);
  localStorage.setItem('sp_alerts', JSON.stringify(priceAlerts));
  renderAlertsList();
}

function renderAlertsList() {
  const el = document.getElementById('alertsList');
  if (!el) return;
  const mine = currentStockData ? priceAlerts.filter(a => a.symbol === currentStockData.symbol) : priceAlerts;
  if (mine.length === 0) { el.innerHTML = '<p style="color:var(--text-muted);font-size:.82rem;padding:8px 0">No alerts set for this stock.</p>'; return; }
  el.innerHTML = mine.map(a => `
    <div class="alert-item">
      <span class="alert-item-dir ${a.dir === 'above' ? 'positive' : 'negative'}">${a.dir === 'above' ? '▲ Above' : '▼ Below'}</span>
      <span class="alert-item-price">₹${a.price.toFixed(2)}</span>
      <button class="alert-delete-btn" onclick="deleteAlert(${a.id})">✕</button>
    </div>`).join('');
}

function startAlertChecker() {
  setInterval(async () => {
    if (!priceAlerts.length) return;
    const symbols = [...new Set(priceAlerts.map(a => a.symbol))];
    try {
      const res  = await fetchWithTimeout('/api/popular', 30_000);
      const data = await res.json();
      const map  = Object.fromEntries(data.map(s => [s.symbol, s.price]));
      priceAlerts.forEach(alert => {
        const cur = map[alert.symbol];
        if (!cur) return;
        const triggered = alert.dir === 'above' ? cur >= alert.price : cur <= alert.price;
        if (triggered && Notification.permission === 'granted') {
          new Notification(`StockPulse Alert: ${cleanSymbol(alert.symbol)}`, {
            body: `${alert.name} is now ₹${cur} (${alert.dir} ₹${alert.price})`,
            icon: '/favicon.ico',
          });
        }
      });
    } catch { /* silent */ }
  }, 60_000);

  if (Notification.permission === 'default') Notification.requestPermission();
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER STOCK VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function renderStockView(data) {
  renderStockHeader(data);
  updateWatchlistBtn(data.symbol);
  renderAlertsList();
  renderSignal(data);
  renderAISummary(data);
  renderMultiTimeframe(data);
  renderInvestorScores(data);
  renderChart(data, 'line');
  renderIndicators(data);
  renderCandlestickPatterns(data);
  renderFibonacci(data);
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
  const scores = data.analysis.investorScores;
  const el = document.getElementById('investorScores');
  if (!el || !scores) return;

  const { consensus, metrics } = scores;

  // Legend: all 11 investors with icon + philosophy
  const LEGENDS = [
    { key: 'graham',        icon: '📚', name: 'Benjamin Graham',      philosophy: 'Deep Value · Margin of Safety' },
    { key: 'buffett',       icon: '🏦', name: 'Warren Buffett',        philosophy: 'Value · Safety · Moat' },
    { key: 'lynch',         icon: '🔍', name: 'Peter Lynch',           philosophy: 'GARP · Ten-Bagger · Growth' },
    { key: 'bogle',         icon: '📊', name: 'John Bogle',            philosophy: 'Index · Low Cost · Long-Term' },
    { key: 'malkiel',       icon: '🎲', name: 'Burton Malkiel',        philosophy: 'Efficient Market · Random Walk' },
    { key: 'munger',        icon: '🧠', name: 'Charlie Munger',        philosophy: 'Quality Moat · Mental Models' },
    { key: 'soros',         icon: '🌊', name: 'George Soros',          philosophy: 'Reflexivity · Macro Momentum' },
    { key: 'druckenmiller', icon: '⚡', name: 'Stanley Druckenmiller', philosophy: 'Top-Down · High Conviction' },
    { key: 'icahn',         icon: '🦅', name: 'Carl Icahn',            philosophy: 'Activist · Undervalued Assets' },
    { key: 'dalio',         icon: '⚖️', name: 'Ray Dalio',             philosophy: 'All-Weather · Risk Parity' },
    { key: 'jhunjhunwala',  icon: '🇮🇳', name: 'Rakesh Jhunjhunwala',  philosophy: 'India Growth · Momentum' },
  ];

  const tierClass = (score) =>
    score >= 75 ? 'tier-great' : score >= 55 ? 'tier-good' : score >= 38 ? 'tier-hold' : score >= 22 ? 'tier-watch' : 'tier-avoid';

  const legendCard = ({ key, icon, name, philosophy }) => {
    const inv = scores[key];
    if (!inv) return '';
    const tier = tierClass(inv.score);
    const ratingColor = SCORE_RATING_COLOR[inv.rating] || 'var(--primary)';
    const pts = [
      ...inv.positive.slice(0, 2).map(p => `<div class="inv-point bullish"><span class="inv-dot"></span>${p}</div>`),
      ...inv.negative.slice(0, 1).map(p => `<div class="inv-point bearish"><span class="inv-dot"></span>${p}</div>`),
    ].join('');
    return `
      <div class="legend-card">
        <div class="legend-card-top">
          <div class="legend-card-icon">${icon}</div>
          <div style="flex:1;min-width:0">
            <div class="legend-card-name">${name}</div>
            <div class="legend-card-philosophy">${philosophy}</div>
          </div>
          <div class="legend-score-badge ${tier}">${inv.score}</div>
        </div>
        <div class="legend-rating-chip" style="color:${ratingColor}">${inv.rating}</div>
        <div class="legend-points">${pts}</div>
        <div class="legend-quote">"${inv.quote}"</div>
      </div>`;
  };

  // Consensus bar
  const pct = Math.round((consensus.buyCount / consensus.totalInvestors) * 100);
  const consensusRatingClass = consensus.score >= 65 ? 'buy' : consensus.score >= 38 ? 'hold' : 'sell';
  const consensusHtml = `
    <div class="legend-consensus-bar">
      <div class="consensus-left">
        <div class="consensus-icon">🏛️</div>
        <div>
          <div class="consensus-label">CONSENSUS VERDICT</div>
          <div class="consensus-rating ${consensusRatingClass}">${consensus.rating}</div>
        </div>
      </div>
      <div class="consensus-right">
        <div class="consensus-stat">
          <div class="consensus-stat-val" style="color:var(--green)">${consensus.buyCount}</div>
          <div class="consensus-stat-lab">Buy votes</div>
        </div>
        <div class="consensus-stat">
          <div class="consensus-stat-val">${consensus.totalInvestors - consensus.buyCount}</div>
          <div class="consensus-stat-lab">Hold/Avoid</div>
        </div>
        <div class="consensus-stat">
          <div class="consensus-stat-val">${consensus.score}</div>
          <div class="consensus-stat-lab">Avg Score</div>
        </div>
        <div>
          <div class="consensus-buy-bar">
            <div class="consensus-buy-fill" style="width:${pct}%"></div>
          </div>
          <div style="font-size:.68rem;color:var(--text-muted);margin-top:4px;text-align:right">${pct}% bullish</div>
        </div>
      </div>
    </div>`;

  const metricsHtml = `
    <div class="metrics-bar">
      ${[
        ['52W Position',      metrics.pricePosition + '%',                               metrics.pricePosition > 60 ? 'positive' : metrics.pricePosition < 35 ? 'cyan' : ''],
        ['Trend Consistency', metrics.trendConsistency + '%',                            metrics.trendConsistency > 60 ? 'positive' : 'negative'],
        ['30D Return',        (metrics.returnPct30d > 0 ? '+' : '') + metrics.returnPct30d + '%', metrics.returnPct30d > 0 ? 'positive' : 'negative'],
        ['Daily Volatility',  metrics.volatilityPct + '%',                               metrics.volatilityPct < 1.5 ? 'positive' : 'negative'],
        ['Upside to Res.',    metrics.upsideToResistance + '%',                          'cyan'],
        ['Above Support',     '+' + metrics.priceVsSupport + '%',                        'positive'],
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
        LEGENDARY INVESTOR INTELLIGENCE
      </h3>
      <div class="investor-count-badge">11 Masters</div>
    </div>
    ${consensusHtml}
    <div class="legend-grid">
      ${LEGENDS.map(legendCard).join('')}
    </div>
    ${metricsHtml}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
function renderAISummary(data) {
  const el = document.getElementById('aiSummarySection');
  if (!el || !data.aiSummary) return;
  const cls = getSignalClass(data.analysis.signal);
  el.innerHTML = `
    <div class="ai-summary-card">
      <div class="ai-summary-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <h3>AI ANALYSIS SUMMARY</h3>
        <div class="ai-summary-verdict ${cls}">${data.analysis.signal}</div>
      </div>
      <p class="ai-summary-text">${data.aiSummary}</p>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MULTI-TIMEFRAME ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════
function renderMultiTimeframe(data) {
  const el = document.getElementById('timeframeSection');
  if (!el) return;
  const daily  = { label: 'Daily',  signal: data.analysis.signal,           strength: data.analysis.strength };
  const weekly = data.weeklyAnalysis ? { label: 'Weekly', signal: data.weeklyAnalysis.signal, strength: data.weeklyAnalysis.strength, rsi: data.weeklyAnalysis.rsi } : null;

  const allBuy  = weekly && daily.signal.includes('BUY')  && weekly.signal.includes('BUY');
  const allSell = weekly && daily.signal.includes('SELL') && weekly.signal.includes('SELL');
  const confluenceText = !weekly ? 'Weekly data unavailable'
    : allBuy  ? '✅ Multi-timeframe confluence — Both Daily & Weekly are BULLISH'
    : allSell ? '⚠️ Multi-timeframe confluence — Both Daily & Weekly are BEARISH'
    : '⏸ Timeframes diverging — Wait for alignment before entering';
  const confluenceCls = allBuy ? 'buy' : allSell ? 'sell' : 'hold';

  const tfCard = (tf) => {
    const cls = getSignalClass(tf.signal);
    return `<div class="timeframe-card">
      <div class="timeframe-label">${tf.label}</div>
      <div class="timeframe-signal ${cls}">${tf.signal}</div>
      <div class="timeframe-strength">Strength: ${tf.strength}%</div>
      ${tf.rsi != null ? `<div class="timeframe-strength">RSI: ${tf.rsi}</div>` : ''}
    </div>`;
  };

  el.innerHTML = `
    <div class="timeframe-section">
      <div class="card-header">
        <h3 class="section-title" style="margin:0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          MULTI-TIMEFRAME ANALYSIS
        </h3>
      </div>
      <div class="timeframe-grid">
        ${tfCard(daily)}
        ${weekly ? tfCard(weekly) : ''}
      </div>
      <div class="confluence-badge ${confluenceCls}">${confluenceText}</div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CANDLESTICK PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════
function renderCandlestickPatterns(data) {
  const el = document.getElementById('patternsSection');
  if (!el) return;
  const patterns = data.patterns || [];
  if (patterns.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="patterns-section">
      <div class="card-header">
        <h3 class="section-title" style="margin:0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="17" y="5" width="4" height="16"/></svg>
          CANDLESTICK PATTERNS DETECTED
        </h3>
      </div>
      <div class="patterns-grid">
        ${patterns.map(p => `
          <div class="pattern-card ${p.type}">
            <div class="pattern-top">
              <span class="pattern-name">${p.name}</span>
              <span class="pattern-type-badge ${p.type}">${p.type.toUpperCase()}</span>
            </div>
            <div class="pattern-signal">${p.signal}</div>
            <div class="pattern-desc">${p.desc}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIBONACCI RETRACEMENT
// ═══════════════════════════════════════════════════════════════════════════════
function renderFibonacci(data) {
  const el = document.getElementById('fibonacciSection');
  if (!el || !data.fibonacci) return;
  const fib = data.fibonacci;
  const cur = data.price;

  const levels = [
    { label: '0% (High)',   price: fib.high,     key: 'high' },
    { label: '23.6%',       price: fib.level236, key: 'l236' },
    { label: '38.2%',       price: fib.level382, key: 'l382' },
    { label: '50.0%',       price: fib.level500, key: 'l500' },
    { label: '61.8% (Golden)', price: fib.level618, key: 'l618' },
    { label: '78.6%',       price: fib.level786, key: 'l786' },
    { label: '100% (Low)',  price: fib.low,      key: 'low' },
  ];

  // Find nearest level
  const nearest = levels.reduce((a, b) => Math.abs(b.price - cur) < Math.abs(a.price - cur) ? b : a);

  el.innerHTML = `
    <div class="fibonacci-section">
      <div class="card-header">
        <h3 class="section-title" style="margin:0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
          FIBONACCI RETRACEMENT <span style="font-size:.75rem;color:var(--text-muted);font-family:var(--font-body);font-weight:400">(60-day)</span>
        </h3>
        <span style="font-size:.75rem;color:var(--text-muted)">Current ₹${formatNumber(cur)} near <strong style="color:var(--primary)">${nearest.label}</strong></span>
      </div>
      <div class="fib-table">
        ${levels.map(l => {
          const isCurrent = l.key === nearest.key;
          const pct = ((l.price - fib.low) / (fib.high - fib.low) * 100).toFixed(0);
          return `<div class="fib-row ${isCurrent ? 'fib-current' : ''}">
            <span class="fib-level">${l.label}</span>
            <div class="fib-bar-wrap"><div class="fib-bar" style="width:${pct}%"></div></div>
            <span class="fib-price ${cur > l.price ? 'positive' : 'negative'}">₹${formatNumber(l.price)}</span>
            ${isCurrent ? '<span class="fib-current-marker">◄ Current</span>' : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHART
// ═══════════════════════════════════════════════════════════════════════════════
let _candleResizeObs = null;
let _candleData      = null;

function renderChart(data, type) {
  const canvas = document.getElementById('priceChart');

  // Always destroy Chart.js instance + candlestick listeners
  if (currentChart) { currentChart.destroy(); currentChart = null; }
  if (_candleResizeObs) { _candleResizeObs.disconnect(); _candleResizeObs = null; }
  canvas.onmousemove = null;
  canvas.onmouseleave = null;

  const { chartData } = data;
  _candleData = chartData;

  if (type === 'line') {
    const ctx = canvas.getContext('2d');
    // Restore canvas natural sizing for Chart.js
    canvas.removeAttribute('width');
    canvas.removeAttribute('height');
    canvas.style.width  = '';
    canvas.style.height = '';

    const labels = chartData.map(d =>
      new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
    const closes = chartData.map(d => d.close);

    const grad = ctx.createLinearGradient(0, 0, 0, 360);
    grad.addColorStop(0,   'rgba(83,103,255,.25)');
    grad.addColorStop(0.5, 'rgba(83,103,255,.06)');
    grad.addColorStop(1,   'rgba(83,103,255,0)');

    currentChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Price', data: closes, borderColor: '#5367FF', borderWidth: 2.5, backgroundColor: grad, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 7, pointHoverBackgroundColor: '#5367FF', pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2 }] },
      options: chartOptions(),
    });
  } else {
    // ── Real candlestick chart (custom canvas) ──────────────────────────
    const draw = () => drawCandlestickCanvas(canvas, chartData);
    draw();
    _candleResizeObs = new ResizeObserver(draw);
    _candleResizeObs.observe(canvas.parentElement);
    setupCandleHover(canvas, chartData);
  }
}

// ── Custom candlestick renderer ───────────────────────────────────────────────
const PAD = { top: 18, right: 72, bottom: 38, left: 8 };

function drawCandlestickCanvas(canvas, data) {
  const wrapper = canvas.parentElement;
  const W = wrapper.clientWidth  || 600;
  const H = wrapper.clientHeight || 360;
  const dpr = window.devicePixelRatio || 1;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;
  const step = cW / data.length;

  // Price range
  const allHighs = data.map(d => d.high).filter(Boolean);
  const allLows  = data.map(d => d.low).filter(Boolean);
  const yMax = Math.max(...allHighs) * 1.005;
  const yMin = Math.min(...allLows)  * 0.995;
  const yRange = yMax - yMin || 1;

  const toY = p => PAD.top + (1 - (p - yMin) / yRange) * cH;
  const toX = i => PAD.left + (i + 0.5) * step;

  // Background
  ctx.fillStyle = '#0F1120';
  ctx.fillRect(0, 0, W, H);

  // Horizontal grid + price axis
  const GRID = 6;
  for (let i = 0; i <= GRID; i++) {
    const y = PAD.top + (i / GRID) * cH;
    const price = yMax - (i / GRID) * yRange;
    ctx.strokeStyle = 'rgba(37,39,66,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    ctx.fillStyle = '#6B6D8A';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('₹' + price.toLocaleString('en-IN', { maximumFractionDigits: 0 }), W - PAD.right + 5, y + 4);
  }

  // Candles
  const candleW = Math.max(Math.floor(step * 0.6), 2);
  data.forEach((d, i) => {
    if (!d.open || !d.close || !d.high || !d.low) return;
    const x  = toX(i);
    const bull = d.close >= d.open;
    const G = '#44C27F', R = '#E65B4E';
    const col = bull ? G : R;

    const bodyTop = toY(Math.max(d.open, d.close));
    const bodyBot = toY(Math.min(d.open, d.close));
    const bodyH   = Math.max(bodyBot - bodyTop, 1);

    // Upper wick
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, toY(d.high)); ctx.lineTo(x, bodyTop); ctx.stroke();
    // Lower wick
    ctx.beginPath(); ctx.moveTo(x, bodyBot); ctx.lineTo(x, toY(d.low)); ctx.stroke();

    // Body
    if (bull) {
      ctx.fillStyle = G;
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
    } else {
      ctx.fillStyle   = R + 'bb';
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
      ctx.strokeStyle = R; ctx.lineWidth = 1;
      ctx.strokeRect(x - candleW / 2, bodyTop, candleW, bodyH);
    }
  });

  // X-axis date labels
  const labelEvery = Math.max(Math.ceil(data.length / 8), 1);
  data.forEach((d, i) => {
    if (i % labelEvery !== 0) return;
    const label = new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    ctx.fillStyle = '#6B6D8A';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, toX(i), H - 8);
  });
}

function setupCandleHover(canvas, data) {
  const step  = () => (canvas.clientWidth - PAD.left - PAD.right) / data.length;
  const toX   = i => PAD.left + (i + 0.5) * step();
  const allH  = data.map(d => d.high).filter(Boolean);
  const allL  = data.map(d => d.low).filter(Boolean);
  const yMax  = Math.max(...allH) * 1.005;
  const yMin  = Math.min(...allL) * 0.995;
  const yRng  = yMax - yMin || 1;
  const cHt   = () => canvas.clientHeight - PAD.top - PAD.bottom;
  const toY   = p => PAD.top + (1 - (p - yMin) / yRng) * cHt();

  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const i    = Math.floor((mx - PAD.left) / step());
    if (i < 0 || i >= data.length) return;
    const d = data[i];
    if (!d?.open) return;

    drawCandlestickCanvas(canvas, data); // redraw base

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    const x = toX(i);
    const W = canvas.clientWidth, H = canvas.clientHeight;

    // Crosshair
    ctx.strokeStyle = 'rgba(83,103,255,0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, H - PAD.bottom); ctx.stroke();
    ctx.setLineDash([]);

    // Tooltip
    const bull  = d.close >= d.open;
    const lines = [
      new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      `O: ₹${d.open?.toFixed(2)}`,
      `H: ₹${d.high?.toFixed(2)}`,
      `L: ₹${d.low?.toFixed(2)}`,
      `C: ₹${d.close?.toFixed(2)}`,
    ];
    const TW = 148, TH = lines.length * 19 + 14;
    let tx = x + 12;
    if (tx + TW > W - PAD.right) tx = x - TW - 12;
    const ty = PAD.top + 8;

    // Tooltip bg
    ctx.beginPath();
    const r = 8;
    ctx.moveTo(tx + r, ty); ctx.lineTo(tx + TW - r, ty);
    ctx.quadraticCurveTo(tx + TW, ty, tx + TW, ty + r);
    ctx.lineTo(tx + TW, ty + TH - r);
    ctx.quadraticCurveTo(tx + TW, ty + TH, tx + TW - r, ty + TH);
    ctx.lineTo(tx + r, ty + TH);
    ctx.quadraticCurveTo(tx, ty + TH, tx, ty + TH - r);
    ctx.lineTo(tx, ty + r);
    ctx.quadraticCurveTo(tx, ty, tx + r, ty);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(15,17,35,0.96)';
    ctx.strokeStyle = bull ? '#44C27F' : '#E65B4E';
    ctx.lineWidth   = 1;
    ctx.fill(); ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = '10px Inter, sans-serif';
    lines.forEach((line, idx) => {
      ctx.fillStyle = idx === 0 ? '#A0A3BD'
        : idx === lines.length - 1 ? (bull ? '#44C27F' : '#E65B4E')
        : '#E8EAF6';
      ctx.fillText(line, tx + 10, ty + 16 + idx * 19);
    });
  };

  canvas.onmouseleave = () => drawCandlestickCanvas(canvas, data);
}

function chartOptions() {
  return {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 1200, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: 'rgba(15,17,35,.97)', titleColor: '#5367FF', bodyColor: '#e8eaf6', borderColor: '#252742', borderWidth: 1, padding: 14, cornerRadius: 10, titleFont: { family: 'Inter', size: 11 }, bodyFont: { family: 'Inter', size: 13 }, callbacks: { label: (ctx) => `₹${ctx.parsed.y?.toFixed(2)}` } },
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
    </div>
    ${ind.stochastic ? `<div class="indicator-item">
      <div class="indicator-name">STOCHASTIC (14,3)</div>
      <div class="indicator-value" style="color:${ind.stochastic.k < 20 ? 'var(--green)' : ind.stochastic.k > 80 ? 'var(--red)' : 'var(--text-primary)'}">%K ${ind.stochastic.k}</div>
      <div class="indicator-sub">%D ${ind.stochastic.d} · ${ind.stochastic.k < 20 ? 'Oversold — Buy Zone' : ind.stochastic.k > 80 ? 'Overbought — Sell Zone' : 'Neutral'}</div>
      <div class="indicator-bar"><div class="indicator-bar-fill" style="width:${ind.stochastic.k}%;background:${ind.stochastic.k < 20 ? 'var(--green)' : ind.stochastic.k > 80 ? 'var(--red)' : 'var(--primary)'}"></div></div>
    </div>` : ''}
    ${ind.adx != null ? `<div class="indicator-item">
      <div class="indicator-name">ADX (14) — Trend Strength</div>
      <div class="indicator-value" style="color:${ind.adx > 25 ? 'var(--green)' : 'var(--orange)'}">${ind.adx}</div>
      <div class="indicator-sub">${ind.adx > 40 ? 'Very Strong Trend' : ind.adx > 25 ? 'Strong Trend — Signals Reliable' : ind.adx > 15 ? 'Weak Trend — Use Caution' : 'No Clear Trend'}</div>
      <div class="indicator-bar"><div class="indicator-bar-fill" style="width:${Math.min(ind.adx * 2, 100)}%;background:${ind.adx > 25 ? 'var(--green)' : 'var(--orange)'}"></div></div>
    </div>` : ''}`;
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
