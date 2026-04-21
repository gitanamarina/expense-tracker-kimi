// ==================== CONFIG ====================
// REPLACE THESE WITH YOUR REAL SUPABASE CREDENTIALS
// If you leave the placeholders, the app works fine in offline/localStorage mode
const SUPABASE_URL = 'https://xmbzdeizupztebxsvgic.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtYnpkZWl6dXB6dGVieHN2Z2ljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MDc4NzIsImV4cCI6MjA5MjM4Mzg3Mn0.RQVYC88Ou1O8X0mVLwfn3uj91M2p0hhhsWORXwbQEzE';

let supabase = null;
let useSupabase = false;

try {
  if (!SUPABASE_URL.includes('your-project') && !SUPABASE_KEY.includes('your-anon') && window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    useSupabase = true;
  }
} catch (e) {
  console.error('Supabase init failed:', e);
}

// ==================== STORAGE ====================
const storage = {
  get(key, def) {
    try {
      const raw = localStorage.getItem('et_' + key);
      return raw ? JSON.parse(raw) : (typeof def === 'undefined' ? null : def);
    } catch (e) { return def; }
  },
  set(key, val) {
    try { localStorage.setItem('et_' + key, JSON.stringify(val)); } catch (e) {}
  }
};

// ==================== DATA ====================
const CURRENCIES = ['USD','EUR','GBP','MXN','RUB','AED','AUD','CAD','CHF','CNY','JPY','KRW','VND','THB','BRL','ARS','COP','PEN','CLP','BTC','ETH'];
const ICONS = ['💳','💵','🏦','📱','🚗','🏠','🍔','🛒','👗','✈️','🎮','💊','🎓','🐶','🎁','💼','🚕','🚌','🚲','⛽','🍺','☕','🍕','🥑','🏥','🦷','💇','🧴','🛍️','📚','🎬','🏋️','🎵','🌱','🔧','💡','🌐','📊','🏖️','🛏️','🧹','👶','🎄','🎂','❤️','⭐','🔥','⚡','🌙','🌞'];

const state = {
  accounts: storage.get('accounts', []),
  categories: storage.get('categories', []),
  transactions: storage.get('transactions', []),
  settings: storage.get('settings', { period_start_day: 1, default_currency: 'USD', exchange_rates: {} }),
  rates: storage.get('rates', {}),
  calc: {
    accountId: null,
    categoryId: null,
    amount: '0',
    currency: 'USD',
    type: 'expense',
    tags: [],
    date: new Date().toISOString().split('T')[0],
    note: '',
    editingId: null
  },
  filters: { accountId: null, categoryId: null, tag: null, from: null, to: null },
  reportFilters: { accounts: [], categories: [], tags: [], from: '', to: '' }
};

// ==================== HELPERS ====================
function formatMoney(amount, currency) {
  if (typeof amount !== 'number') amount = parseFloat(amount) || 0;
  const symbols = { USD:'$', EUR:'€', GBP:'£', MXN:'$', JPY:'¥', CNY:'¥', KRW:'₩', RUB:'₽', VND:'₫', THB:'฿', BRL:'R$', AED:'dh', CAD:'C$', AUD:'A$', CHF:'Fr', ARS:'$', COP:'$', PEN:'S/', CLP:'$', BTC:'₿', ETH:'Ξ' };
  const sym = symbols[currency] || (currency + ' ');
  return sym + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function convertAmount(amount, from, to) {
  if (from === to) return amount;
  const r = state.rates || {};
  if (!r[from] || !r[to]) return amount;
  return (amount / r[from]) * r[to];
}

function getPeriodRange() {
  const startDay = state.settings?.period_start_day || 1;
  const today = new Date();
  const day = today.getDate();
  let start, end;
  if (day >= startDay) {
    start = new Date(today.getFullYear(), today.getMonth(), startDay);
    end = new Date(today.getFullYear(), today.getMonth() + 1, startDay - 1);
  } else {
    start = new Date(today.getFullYear(), today.getMonth() - 1, startDay);
    end = new Date(today.getFullYear(), today.getMonth(), startDay - 1);
  }
  start.setHours(0,0,0,0);
  end.setHours(23,59,59,999);
  return { start, end };
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

function saveState() {
  storage.set('accounts', state.accounts);
  storage.set('categories', state.categories);
  storage.set('transactions', state.transactions);
  storage.set('settings', state.settings);
  storage.set('rates', state.rates);
}

async function syncToSupabase(table, data, id) {
  if (!useSupabase || !supabase) return;
  try {
    if (id) await supabase.from(table).update(data).eq('id', id);
    else await supabase.from(table).insert([data]);
  } catch (e) { console.log('Supabase sync skipped:', e.message); }
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  populateCurrencySelects();
  refreshRates(false).then(() => {
    renderDashboard();
  });
  setupServiceWorker();
  setupIconPicker();

  // Show offline banner if Supabase not connected
  if (!useSupabase) {
    const banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.innerHTML = '⚠️ Offline Mode — Add your Supabase credentials in app.js to enable cloud sync';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#f59e0b;color:#000;text-align:center;padding:8px;font-size:13px;font-weight:600;z-index:9999;';
    document.body.appendChild(banner);
    setTimeout(() => { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 6000);
  }
});

function populateCurrencySelects() {
  document.querySelectorAll('select').forEach(sel => {
    if (sel.id && sel.id.includes('currency')) {
      sel.innerHTML = CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
    }
  });
}

async function refreshRates(force) {
  if (!force && state.rates && Object.keys(state.rates).length > 0) return;
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data.rates) {
      state.rates = data.rates;
      storage.set('rates', state.rates);
    }
  } catch (e) { console.log('Rates fetch failed'); }
}

function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function setupIconPicker() {
  const picker = document.getElementById('form-icon');
  if (!picker) return;
  picker.addEventListener('click', () => {
    const html = ICONS.map(ic => `<div class="picker-item" onclick="document.getElementById('form-icon').textContent='${ic}';app.closeModal()"><span style="font-size:28px">${ic}</span></div>`).join('');
    document.getElementById('picker-title').textContent = 'Choose Icon';
    document.getElementById('picker-list').innerHTML = html;
    document.getElementById('picker-modal').classList.add('active');
  });
}

// ==================== DASHBOARD ====================
function renderDashboard() {
  const period = getPeriodRange();
  const periodTx = state.transactions.filter(t => {
    const d = new Date(t.date + 'T00:00:00');
    return d >= period.start && d <= period.end;
  });

  const income = periodTx.filter(t => t.type === 'income').reduce((s, t) => s + (t.converted_amount || t.amount), 0);
  const expenses = periodTx.filter(t => t.type === 'expense').reduce((s, t) => s + (t.converted_amount || t.amount), 0);
  const balance = state.accounts.reduce((s, a) => s + convertAmount(a.balance || 0, a.currency || 'USD', state.settings?.default_currency || 'USD'), 0);

  const balEl = document.getElementById('dash-balance');
  const expEl = document.getElementById('dash-expenses');
  const incEl = document.getElementById('dash-income');
  if (balEl) balEl.textContent = formatMoney(balance, state.settings?.default_currency || 'USD');
  if (expEl) expEl.textContent = formatMoney(expenses, state.settings?.default_currency || 'USD');
  if (incEl) incEl.textContent = formatMoney(income, state.settings?.default_currency || 'USD');

  // Accounts grid
  const accGrid = document.getElementById('accounts-grid');
  if (accGrid) {
    accGrid.innerHTML = state.accounts.map(a => `
      <div class="icon-item account-item" onclick="app.openList('account','${a.id}')">
        <div class="icon-circle">${a.icon || '💳'}</div>
        <span class="icon-label">${escapeHtml(a.name)}</span>
        <span class="icon-amount">${formatMoney(a.balance || 0, a.currency || 'USD')}</span>
      </div>
    `).join('') + `
      <div class="icon-item add-btn" onclick="app.openForm('account')">
        <div class="icon-circle">＋</div>
        <span class="icon-label">Add</span>
      </div>
    `;
  }

  // Categories grid
  const catGrid = document.getElementById('categories-grid');
  if (catGrid) {
    const catTotals = {};
    periodTx.filter(t => t.type === 'expense').forEach(t => {
      catTotals[t.category_id] = (catTotals[t.category_id] || 0) + (t.converted_amount || t.amount);
    });
    catGrid.innerHTML = state.categories.map(c => `
      <div class="icon-item category-item" onclick="app.openList('category','${c.id}')">
        <div class="icon-circle">${c.icon || '📁'}</div>
        <span class="icon-label">${escapeHtml(c.name)}</span>
        <span class="icon-amount">${formatMoney(catTotals[c.id] || 0, state.settings?.default_currency || 'USD')}</span>
      </div>
    `).join('') + `
      <div class="icon-item add-btn" onclick="app.openForm('category')">
        <div class="icon-circle">＋</div>
        <span class="icon-label">Add</span>
      </div>
    `;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== CALCULATOR ====================
function openCalculator(typeOrIncome, preselectId) {
  const defCurrency = state.settings?.default_currency || 'USD';
  state.calc = {
    accountId: state.accounts[0]?.id || null,
    categoryId: state.categories[0]?.id || null,
    amount: '0',
    currency: defCurrency,
    type: 'expense',
    tags: [],
    date: new Date().toISOString().split('T')[0],
    note: '',
    editingId: null
  };

  if (typeOrIncome === 'income') state.calc.type = 'income';
  if (preselectId && typeOrIncome === 'account') {
    state.calc.accountId = preselectId;
    const acc = state.accounts.find(a => a.id === preselectId);
    if (acc) state.calc.currency = acc.currency || defCurrency;
  }
  if (preselectId && typeOrIncome === 'category') {
    state.calc.categoryId = preselectId;
    const cat = state.categories.find(c => c.id === preselectId);
    if (cat) state.calc.currency = cat.currency || defCurrency;
  }

  updateCalcUI();
  showScreen('calculator');
}

function editTransaction(id) {
  const t = state.transactions.find(x => x.id === id);
  if (!t) return;
  state.calc = {
    accountId: t.account_id,
    categoryId: t.category_id,
    amount: t.amount.toString(),
    currency: t.currency,
    type: t.type,
    tags: Array.isArray(t.tags) ? [...t.tags] : [],
    date: t.date,
    note: t.note || '',
    editingId: t.id
  };
  updateCalcUI();
  showScreen('calculator');
}

function updateCalcUI() {
  const acc = state.accounts.find(a => a.id === state.calc.accountId);
  const cat = state.categories.find(c => c.id === state.calc.categoryId);
  const accBtn = document.getElementById('calc-account-btn');
  const catBtn = document.getElementById('calc-category-btn');
  if (accBtn) accBtn.textContent = acc?.name || 'Account';
  if (catBtn) catBtn.textContent = cat?.name || 'Category';

  const amtEl = document.getElementById('calc-amount');
  const curEl = document.getElementById('calc-currency');
  if (amtEl) amtEl.textContent = state.calc.amount;
  if (curEl) curEl.textContent = state.calc.currency;

  const dateLabel = document.getElementById('calc-date-label');
  if (dateLabel) dateLabel.textContent = state.calc.date;

  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === state.calc.type);
  });

  const converted = convertAmount(parseFloat(state.calc.amount) || 0, state.calc.currency, state.settings?.default_currency || 'USD');
  const convEl = document.getElementById('calc-converted');
  if (convEl) {
    convEl.textContent = (state.calc.currency !== (state.settings?.default_currency || 'USD'))
      ? `≈ ${formatMoney(converted, state.settings?.default_currency || 'USD')}` : '';
  }

  const tagContainer = document.getElementById('calc-tags');
  if (tagContainer) {
    const allTags = getAllTags();
    tagContainer.innerHTML = allTags.map(tag => `
      <span class="tag-pill ${state.calc.tags.includes(tag) ? 'active' : ''}" onclick="app.toggleTag('${tag}')">${escapeHtml(tag)}</span>
    `).join('');
  }
}

function getAllTags() {
  const tags = new Set();
  state.transactions.forEach(t => {
    if (Array.isArray(t.tags)) t.tags.forEach(tag => tags.add(tag));
  });
  return Array.from(tags).sort();
}

function toggleTag(tag) {
  if (state.calc.tags.includes(tag)) state.calc.tags = state.calc.tags.filter(t => t !== tag);
  else state.calc.tags.push(tag);
  updateCalcUI();
}

function addTagPrompt() {
  const tag = prompt('Enter tag name:');
  if (tag && tag.trim()) {
    const clean = tag.trim().toLowerCase().replace(/\s+/g, '-');
    if (!state.calc.tags.includes(clean)) state.calc.tags.push(clean);
    updateCalcUI();
  }
}

function setType(type) {
  state.calc.type = type;
  updateCalcUI();
}

function calcDigit(d) {
  if (state.calc.amount === '0') state.calc.amount = d.toString();
  else state.calc.amount += d;
  updateCalcUI();
}

function calcDecimal() {
  if (!state.calc.amount.includes('.')) state.calc.amount += '.';
  updateCalcUI();
}

function calcBackspace() {
  state.calc.amount = state.calc.amount.slice(0, -1) || '0';
  updateCalcUI();
}

function calcClear() {
  state.calc.amount = '0';
  state.calcOpBuffer = null;
  updateCalcUI();
}

let calcOpBuffer = null;
function calcOp(op) {
  calcOpBuffer = { amount: parseFloat(state.calc.amount) || 0, op };
  state.calc.amount = '0';
}

function calcPercent() {
  state.calc.amount = ((parseFloat(state.calc.amount) || 0) * 0.01).toString();
  updateCalcUI();
}

function calcEquals() {
  if (!calcOpBuffer) return;
  const current = parseFloat(state.calc.amount) || 0;
  let result = 0;
  switch (calcOpBuffer.op) {
    case '+': result = calcOpBuffer.amount + current; break;
    case '-': result = calcOpBuffer.amount - current; break;
    case '×': result = calcOpBuffer.amount * current; break;
    case '÷': result = calcOpBuffer.amount / current; break;
  }
  state.calc.amount = parseFloat(result.toFixed(2)).toString();
  calcOpBuffer = null;
  updateCalcUI();
}

function calcNote() {
  const note = prompt('Note:', state.calc.note);
  if (note !== null) state.calc.note = note;
}

function setDate(when) {
  const d = new Date();
  if (when === 'yesterday') d.setDate(d.getDate() - 1);
  state.calc.date = d.toISOString().split('T')[0];
  updateCalcUI();
}

function showDatePicker() {
  const input = document.getElementById('modal-date-input');
  if (input) input.value = state.calc.date;
  const modal = document.getElementById('date-modal');
  if (modal) modal.classList.add('active');
}

function confirmDate() {
  const input = document.getElementById('modal-date-input');
  if (input) state.calc.date = input.value;
  closeModal();
  updateCalcUI();
}

async function saveTransaction() {
  const amount = parseFloat(state.calc.amount);
  if (!amount || amount <= 0) { alert('Enter amount'); return; }
  if (!state.calc.accountId) { alert('Select account'); return; }
  if (!state.calc.categoryId) { alert('Select category'); return; }

  const converted = convertAmount(amount, state.calc.currency, state.settings?.default_currency || 'USD');
  const id = state.calc.editingId || crypto.randomUUID();

  const data = {
    id: id,
    account_id: state.calc.accountId,
    category_id: state.calc.categoryId,
    amount: amount,
    currency: state.calc.currency,
    converted_amount: converted,
    type: state.calc.type,
    tags: state.calc.tags,
    date: state.calc.date,
    note: state.calc.note,
    created_at: new Date().toISOString()
  };

  if (state.calc.editingId) {
    const idx = state.transactions.findIndex(t => t.id === state.calc.editingId);
    if (idx >= 0) state.transactions[idx] = data;
  } else {
    state.transactions.unshift(data);
  }

  // Update account balance
  const acc = state.accounts.find(a => a.id === state.calc.accountId);
  if (acc) {
    const oldTx = state.calc.editingId ? state.transactions.find(t => t.id === state.calc.editingId) : null;
    let change = state.calc.type === 'income' ? amount : -amount;
    if (oldTx && oldTx.account_id === acc.id) {
      const oldChange = oldTx.type === 'income' ? oldTx.amount : -oldTx.amount;
      acc.balance = (acc.balance || 0) - oldChange + change;
    } else {
      acc.balance = (acc.balance || 0) + change;
    }
  }

  saveState();
  if (useSupabase) await syncToSupabase('transactions', data, state.calc.editingId);
  renderDashboard();
  showScreen('dashboard');
}

// ==================== LISTS ====================
function openList(filterType, id) {
  state.filters = { accountId: null, categoryId: null, tag: null, from: null, to: null };
  if (filterType === 'account') state.filters.accountId = id;
  if (filterType === 'category') state.filters.categoryId = id;
  renderList();
  showScreen('list');
}

function renderList() {
  let txs = [...state.transactions];

  if (state.filters.accountId) txs = txs.filter(t => t.account_id === state.filters.accountId);
  if (state.filters.categoryId) txs = txs.filter(t => t.category_id === state.filters.categoryId);
  if (state.filters.tag) txs = txs.filter(t => (t.tags || []).includes(state.filters.tag));
  if (state.filters.from) txs = txs.filter(t => t.date >= state.filters.from);
  if (state.filters.to) txs = txs.filter(t => t.date <= state.filters.to);

  const chips = document.getElementById('filter-chips');
  if (chips) {
    const html = [];
    if (state.filters.accountId) {
      const a = state.accounts.find(x => x.id === state.filters.accountId);
      html.push(`<span class="chip">${escapeHtml(a?.name || '')} <button onclick="app.clearFilter('account')">×</button></span>`);
    }
    if (state.filters.categoryId) {
      const c = state.categories.find(x => x.id === state.filters.categoryId);
      html.push(`<span class="chip">${escapeHtml(c?.name || '')} <button onclick="app.clearFilter('category')">×</button></span>`);
    }
    chips.innerHTML = html.join('') || '<span style="color:var(--text-secondary);font-size:13px;">All transactions</span>';
  }

  const total = txs.reduce((s, t) => s + (t.type === 'income' ? 1 : -1) * (t.converted_amount || t.amount), 0);
  const totalEl = document.getElementById('list-total');
  if (totalEl) {
    totalEl.innerHTML = `<span>TOTAL</span><span class="amount" style="color:${total >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${formatMoney(Math.abs(total), state.settings?.default_currency || 'USD')}</span>`;
  }

  const groups = {};
  txs.forEach(t => { if (!groups[t.date]) groups[t.date] = []; groups[t.date].push(t); });
  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  const container = document.getElementById('transaction-list');
  if (!container) return;
  if (sortedDates.length === 0) {
    container.innerHTML = '<div class="empty-state">No transactions</div>';
    return;
  }

  container.innerHTML = sortedDates.map(date => {
    const dayTxs = groups[date];
    const dayTotal = dayTxs.reduce((s, t) => s + (t.type === 'income' ? 1 : -1) * (t.converted_amount || t.amount), 0);
    return `
      <div class="date-group">
        <div class="date-header">${formatDate(date)}</div>
        ${dayTxs.map(t => renderTxItem(t)).join('')}
        <div class="daily-total">Total: ${formatMoney(Math.abs(dayTotal), state.settings?.default_currency || 'USD')}</div>
      </div>
    `;
  }).join('');
}

function renderTxItem(t) {
  const acc = state.accounts.find(a => a.id === t.account_id);
  const cat = state.categories.find(c => c.id === t.category_id);
  const isExp = t.type === 'expense';
  return `
    <div class="transaction-item" onclick="app.editTransaction('${t.id}')">
      <div class="tx-left">
        <span class="tx-account">${escapeHtml(acc?.name || 'Unknown')}</span>
        <span class="tx-category">${escapeHtml(cat?.name || 'Unknown')}</span>
        ${(t.tags && t.tags.length) ? `<span class="tx-tags">${t.tags.map(tag => '#' + escapeHtml(tag)).join(' ')}</span>` : ''}
      </div>
      <div class="tx-right">
        <div class="tx-amount ${isExp ? 'expense' : 'income'}">${isExp ? '-' : '+'}${formatMoney(t.amount, t.currency)}</div>
        ${t.converted_amount && t.currency !== (state.settings?.default_currency || 'USD') ? `<div class="tx-converted">≈ ${formatMoney(t.converted_amount, state.settings?.default_currency || 'USD')}</div>` : ''}
      </div>
    </div>
  `;
}

function clearFilter(type) {
  if (type === 'account') state.filters.accountId = null;
  if (type === 'category') state.filters.categoryId = null;
  renderList();
}

function showDateRangePicker() {
  const from = prompt('From date (YYYY-MM-DD):', state.filters.from || '');
  if (from === null) return;
  const to = prompt('To date (YYYY-MM-DD):', state.filters.to || '');
  if (to === null) return;
  state.filters.from = from || null;
  state.filters.to = to || null;
  renderList();
}

// ==================== REPORTS ====================
function openReports() {
  const accContainer = document.getElementById('report-accounts');
  if (accContainer) accContainer.innerHTML = state.accounts.map(a => `<span class="select-pill" onclick="app.toggleReportFilter('accounts','${a.id}',this)">${escapeHtml(a.name)}</span>`).join('');

  const catContainer = document.getElementById('report-categories');
  if (catContainer) catContainer.innerHTML = state.categories.map(c => `<span class="select-pill" onclick="app.toggleReportFilter('categories','${c.id}',this)">${escapeHtml(c.name)}</span>`).join('');

  const allTags = getAllTags();
  const tagContainer = document.getElementById('report-tags');
  if (tagContainer) tagContainer.innerHTML = allTags.map(tag => `<span class="select-pill" onclick="app.toggleReportFilter('tags','${tag}',this)">#${escapeHtml(tag)}</span>`).join('');

  const period = getPeriodRange();
  const fromInput = document.getElementById('report-from');
  const toInput = document.getElementById('report-to');
  if (fromInput) fromInput.value = period.start.toISOString().split('T')[0];
  if (toInput) toInput.value = period.end.toISOString().split('T')[0];

  const results = document.getElementById('report-results');
  if (results) results.innerHTML = '';
  showScreen('reports');
}

function toggleReportFilter(type, value, el) {
  const arr = state.reportFilters[type];
  if (arr.includes(value)) {
    arr.splice(arr.indexOf(value), 1);
    el.classList.remove('selected');
  } else {
    arr.push(value);
    el.classList.add('selected');
  }
}

function runReport() {
  const from = document.getElementById('report-from')?.value;
  const to = document.getElementById('report-to')?.value;
  if (!from || !to) return;

  let txs = state.transactions.filter(t => t.date >= from && t.date <= to);
  if (state.reportFilters.accounts.length) txs = txs.filter(t => state.reportFilters.accounts.includes(t.account_id));
  if (state.reportFilters.categories.length) txs = txs.filter(t => state.reportFilters.categories.includes(t.category_id));
  if (state.reportFilters.tags.length) txs = txs.filter(t => state.reportFilters.tags.some(tag => (t.tags || []).includes(tag)));

  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + (t.converted_amount || t.amount), 0);
  const expenses = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (t.converted_amount || t.amount), 0);

  const results = document.getElementById('report-results');
  if (!results) return;
  results.innerHTML = `
    <div class="report-summary">
      <div class="report-summary-row"><span>Transactions</span><span>${txs.length}</span></div>
      <div class="report-summary-row"><span>Income</span><span style="color:var(--accent-green)">${formatMoney(income, state.settings?.default_currency || 'USD')}</span></div>
      <div class="report-summary-row"><span>Expenses</span><span style="color:var(--accent-red)">${formatMoney(expenses, state.settings?.default_currency || 'USD')}</span></div>
      <div class="report-summary-row"><span>Net</span><span style="color:${income >= expenses ? 'var(--accent-green)' : 'var(--accent-red)'}">${formatMoney(income - expenses, state.settings?.default_currency || 'USD')}</span></div>
    </div>
    ${txs.length ? txs.map(t => renderTxItem(t)).join('') : '<div class="empty-state">No results</div>'}
  `;
}

// ==================== SETTINGS ====================
function openSettings() {
  const dayInput = document.getElementById('setting-period-day');
  const curInput = document.getElementById('setting-currency');
  if (dayInput) dayInput.value = state.settings?.period_start_day || 1;
  if (curInput) curInput.value = state.settings?.default_currency || 'USD';
  showScreen('settings');
}

function saveSettings() {
  const day = parseInt(document.getElementById('setting-period-day')?.value) || 1;
  const currency = document.getElementById('setting-currency')?.value || 'USD';
  state.settings = { ...(state.settings || {}), period_start_day: day, default_currency: currency };
  saveState();
  if (useSupabase) syncToSupabase('settings', state.settings, state.settings?.id);
  renderDashboard();
  showScreen('dashboard');
}

// ==================== FORMS ====================
function openForm(type, id) {
  document.getElementById('form-type').value = type;
  document.getElementById('form-id').value = id || '';
  document.getElementById('form-title').textContent = id ? 'Edit' : 'Add ' + type;
  document.getElementById('form-name').value = '';
  document.getElementById('form-balance').value = '';
  document.getElementById('form-icon').textContent = type === 'account' ? '💳' : '📁';
  document.getElementById('form-currency').value = state.settings?.default_currency || 'USD';
  document.getElementById('form-balance-group').style.display = type === 'category' ? 'none' : 'block';

  if (id) {
    const item = type === 'account' ? state.accounts.find(a => a.id === id) : state.categories.find(c => c.id === id);
    if (item) {
      document.getElementById('form-name').value = item.name;
      document.getElementById('form-icon').textContent = item.icon || (type === 'account' ? '💳' : '📁');
      document.getElementById('form-currency').value = item.currency || state.settings?.default_currency || 'USD';
      if (type === 'account') document.getElementById('form-balance').value = item.balance || 0;
    }
  }
  showScreen('form');
}

function saveForm() {
  const type = document.getElementById('form-type').value;
  const id = document.getElementById('form-id').value;
  const name = document.getElementById('form-name').value.trim();
  const icon = document.getElementById('form-icon').textContent;
  const currency = document.getElementById('form-currency').value;

  if (!name) { alert('Enter name'); return; }

  const isEdit = !!id;
  const itemId = id || crypto.randomUUID();
  const data = { id: itemId, name, icon, currency, created_at: new Date().toISOString() };

  if (type === 'account') {
    data.balance = parseFloat(document.getElementById('form-balance').value) || 0;
    if (isEdit) {
      const idx = state.accounts.findIndex(a => a.id === id);
      if (idx >= 0) state.accounts[idx] = { ...state.accounts[idx], ...data };
    } else {
      state.accounts.push(data);
    }
  } else {
    if (isEdit) {
      const idx = state.categories.findIndex(c => c.id === id);
      if (idx >= 0) state.categories[idx] = { ...state.categories[idx], ...data };
    } else {
      state.categories.push(data);
    }
  }

  saveState();
  if (useSupabase) syncToSupabase(type + 's', data, isEdit ? id : null);
  renderDashboard();
  showScreen('dashboard');
}

// ==================== PICKERS ====================
function showAccountPicker() {
  const items = state.accounts.map(a => ({
    icon: a.icon || '💳',
    label: a.name,
    action: () => { state.calc.accountId = a.id; state.calc.currency = a.currency || state.settings?.default_currency || 'USD'; updateCalcUI(); }
  }));
  showPicker('Select Account', items);
}

function showCategoryPicker() {
  const items = state.categories.map(c => ({
    icon: c.icon || '📁',
    label: c.name,
    action: () => { state.calc.categoryId = c.id; updateCalcUI(); }
  }));
  showPicker('Select Category', items);
}

function showPicker(title, items) {
  document.getElementById('picker-title').textContent = title;
  document.getElementById('picker-list').innerHTML = items.map(item => `
    <div class="picker-item" onclick="app.pickerAction(${items.indexOf(item)})">
      <span style="font-size:24px">${item.icon}</span>
      <span>${escapeHtml(item.label)}</span>
    </div>
  `).join('');
  window._pickerActions = items.map(i => i.action);
  document.getElementById('picker-modal').classList.add('active');
}

function pickerAction(index) {
  if (window._pickerActions && window._pickerActions[index]) window._pickerActions[index]();
  closeModal();
}

function closeModal() {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

// ==================== GLOBAL APP ====================
window.app = {
  showDashboard: () => { renderDashboard(); showScreen('dashboard'); },
  openCalculator, editTransaction, setType, toggleTag, addTagPrompt,
  calcDigit, calcDecimal, calcBackspace, calcClear, calcOp, calcPercent, calcEquals, calcNote,
  setDate, showDatePicker, confirmDate, saveTransaction,
  openList, clearFilter, showDateRangePicker,
  openReports, toggleReportFilter, runReport,
  openSettings, saveSettings, refreshRates,
  openForm, saveForm,
  showAccountPicker, showCategoryPicker, closeModal, pickerAction
};
