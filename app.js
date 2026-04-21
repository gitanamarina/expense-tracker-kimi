// ==================== CONFIG ====================
// REPLACE THESE WITH YOUR SUPABASE CREDENTIALS
const SUPABASE_URL = 'https://xmbzdeizupztebxsvgic.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtYnpkZWl6dXB6dGVieHN2Z2ljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MDc4NzIsImV4cCI6MjA5MjM4Mzg3Mn0.RQVYC88Ou1O8X0mVLwfn3uj91M2p0hhhsWORXwbQEzE';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CURRENCIES = ['USD','EUR','GBP','MXN','RUB','AED','AUD','CAD','CHF','CNY','JPY','KRW','VND','THB','BRL','ARS','COP','PEN','CLP','BTC','ETH'];

const ICONS = ['💳','💵','🏦','📱','🚗','🏠','🍔','🛒','👗','✈️','🎮','💊','🎓','🐶','🎁','💼','🚕','🚌','🚲','⛽','🍺','☕','🍕','🥑','🏥','🦷','💇','🧴','🛍️','📚','🎬','🏋️','🎵','🌱','🔧','💡','🌐','📊','🏖️','🛏️','🧹','👶','🎄','🎂','❤️','⭐','🔥','⚡','🌙','🌞'];

// ==================== STATE ====================
const state = {
  accounts: [],
  categories: [],
  transactions: [],
  settings: { period_start_day: 1, default_currency: 'USD', exchange_rates: {} },
  rates: {},
  screen: 'dashboard',
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
  filters: {
    accountId: null,
    categoryId: null,
    tag: null,
    from: null,
    to: null
  },
  reportFilters: {
    accounts: [],
    categories: [],
    tags: [],
    from: '',
    to: ''
  }
};

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function init() {
  populateCurrencySelects();
  await loadData();
  renderDashboard();
  setupServiceWorker();
}

function populateCurrencySelects() {
  document.querySelectorAll('select').forEach(sel => {
    if (sel.id.includes('currency')) {
      sel.innerHTML = CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('');
    }
  });
}

async function loadData() {
  const [{ data: accounts }, { data: categories }, { data: transactions }, { data: settings }] = await Promise.all([
    supabase.from('accounts').select('*').order('created_at'),
    supabase.from('categories').select('*').order('created_at'),
    supabase.from('transactions').select('*').order('date', { ascending: false }),
    supabase.from('settings').select('*').single()
  ]);

  state.accounts = accounts || [];
  state.categories = categories || [];
  state.transactions = transactions || [];
  if (settings) state.settings = settings;

  // Fetch exchange rates
  await refreshRates(false);
}

async function refreshRates(force = true) {
  if (!force && state.settings.exchange_rates && Object.keys(state.settings.exchange_rates).length > 0) {
    state.rates = state.settings.exchange_rates;
    return;
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    state.rates = data.rates || {};
    await supabase.from('settings').update({ exchange_rates: state.rates, updated_at: new Date().toISOString() }).eq('id', state.settings.id);
    document.getElementById('rates-status').textContent = 'Last updated: ' + new Date().toLocaleString();
  } catch (e) {
    console.error('Rates fetch failed', e);
  }
}

function setupServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ==================== NAVIGATION ====================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  state.screen = name;
  window.scrollTo(0, 0);
}

// ==================== DASHBOARD ====================
function renderDashboard() {
  const period = getPeriodRange();
  const periodTx = state.transactions.filter(t => {
    const d = new Date(t.date);
    return d >= period.start && d <= period.end;
  });

  const income = periodTx.filter(t => t.type === 'income').reduce((s, t) => s + (t.converted_amount || t.amount), 0);
  const expenses = periodTx.filter(t => t.type === 'expense').reduce((s, t) => s + (t.converted_amount || t.amount), 0);
  const balance = state.accounts.reduce((s, a) => s + convertAmount(a.balance, a.currency, state.settings.default_currency), 0);

  document.getElementById('dash-balance').textContent = formatMoney(balance, state.settings.default_currency);
  document.getElementById('dash-expenses').textContent = formatMoney(expenses, state.settings.default_currency);
  document.getElementById('dash-income').textContent = formatMoney(income, state.settings.default_currency);

  // Accounts grid
  const accGrid = document.getElementById('accounts-grid');
  accGrid.innerHTML = state.accounts.map(a => `
    <div class="icon-item account-item" onclick="app.openList('account','${a.id}')">
      <div class="icon-circle">${a.icon || '💳'}</div>
      <span class="icon-label">${a.name}</span>
      <span class="icon-amount">${formatMoney(a.balance, a.currency)}</span>
    </div>
  `).join('') + `
    <div class="icon-item add-btn" onclick="app.openForm('account')">
      <div class="icon-circle">＋</div>
      <span class="icon-label">Add</span>
    </div>
  `;

  // Categories grid
  const catGrid = document.getElementById('categories-grid');
  const catTotals = {};
  periodTx.filter(t => t.type === 'expense').forEach(t => {
    catTotals[t.category_id] = (catTotals[t.category_id] || 0) + (t.converted_amount || t.amount);
  });

  catGrid.innerHTML = state.categories.map(c => `
    <div class="icon-item category-item" onclick="app.openList('category','${c.id}')">
      <div class="icon-circle">${c.icon || '📁'}</div>
      <span class="icon-label">${c.name}</span>
      <span class="icon-amount">${formatMoney(catTotals[c.id] || 0, state.settings.default_currency)}</span>
    </div>
  `).join('') + `
    <div class="icon-item add-btn" onclick="app.openForm('category')">
      <div class="icon-circle">＋</div>
      <span class="icon-label">Add</span>
    </div>
  `;
}

function getPeriodRange() {
  const startDay = state.settings.period_start_day || 1;
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

// ==================== CALCULATOR ====================
function openCalculator(typeOrIncome, preselectId) {
  state.calc = {
    accountId: state.accounts[0]?.id || null,
    categoryId: state.categories[0]?.id || null,
    amount: '0',
    currency: state.settings.default_currency,
    type: 'expense',
    tags: [],
    date: new Date().toISOString().split('T')[0],
    note: '',
    editingId: null
  };

  if (typeOrIncome === 'income') {
    state.calc.type = 'income';
  }
  if (preselectId && typeOrIncome === 'account') {
    state.calc.accountId = preselectId;
  }
  if (preselectId && typeOrIncome === 'category') {
    state.calc.categoryId = preselectId;
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
    tags: t.tags || [],
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
  document.getElementById('calc-account-btn').textContent = acc?.name || 'Account';
  document.getElementById('calc-category-btn').textContent = cat?.name || 'Category';
  document.getElementById('calc-amount').textContent = state.calc.amount;
  document.getElementById('calc-currency').textContent = state.calc.currency;
  document.getElementById('calc-date-label').textContent = state.calc.date;

  // Update type buttons
  document.querySelectorAll('.type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === state.calc.type);
  });

  // Update currency based on account/category preference
  if (acc && !state.calc.editingId) state.calc.currency = acc.currency;

  // Show conversion
  const converted = convertAmount(parseFloat(state.calc.amount) || 0, state.calc.currency, state.settings.default_currency);
  if (state.calc.currency !== state.settings.default_currency) {
    document.getElementById('calc-converted').textContent = `≈ ${formatMoney(converted, state.settings.default_currency)}`;
  } else {
    document.getElementById('calc-converted').textContent = '';
  }

  // Tags
  const tagContainer = document.getElementById('calc-tags');
  const allTags = getAllTags();
  tagContainer.innerHTML = allTags.map(tag => `
    <span class="tag-pill ${state.calc.tags.includes(tag) ? 'active' : ''}" onclick="app.toggleTag('${tag}')">${tag}</span>
  `).join('');
}

function getAllTags() {
  const tags = new Set();
  state.transactions.forEach(t => (t.tags || []).forEach(tag => tags.add(tag)));
  return Array.from(tags).sort();
}

function toggleTag(tag) {
  if (state.calc.tags.includes(tag)) {
    state.calc.tags = state.calc.tags.filter(t => t !== tag);
  } else {
    state.calc.tags.push(tag);
  }
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

// Calculator input
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
  updateCalcUI();
}

let calcOpBuffer = null;
function calcOp(op) {
  calcOpBuffer = { amount: parseFloat(state.calc.amount), op };
  state.calc.amount = '0';
}

function calcPercent() {
  state.calc.amount = (parseFloat(state.calc.amount) * 0.01).toString();
  updateCalcUI();
}

function calcEquals() {
  if (!calcOpBuffer) return;
  const current = parseFloat(state.calc.amount);
  let result = 0;
  switch (calcOpBuffer.op) {
    case '+': result = calcOpBuffer.amount + current; break;
    case '-': result = calcOpBuffer.amount - current; break;
    case '×': result = calcOpBuffer.amount * current; break;
    case '÷': result = calcOpBuffer.amount / current; break;
  }
  state.calc.amount = result.toFixed(2).replace(/\.00$/, '');
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
  document.getElementById('modal-date-input').value = state.calc.date;
  document.getElementById('date-modal').classList.add('active');
}

function confirmDate() {
  state.calc.date = document.getElementById('modal-date-input').value;
  document.getElementById('date-modal').classList.remove('active');
  updateCalcUI();
}

async function saveTransaction() {
  const amount = parseFloat(state.calc.amount);
  if (!amount || amount <= 0) return alert('Enter amount');
  if (!state.calc.accountId) return alert('Select account');
  if (!state.calc.categoryId) return alert('Select category');

  const converted = convertAmount(amount, state.calc.currency, state.settings.default_currency);

  const data = {
    account_id: state.calc.accountId,
    category_id: state.calc.categoryId,
    amount: amount,
    currency: state.calc.currency,
    converted_amount: converted,
    type: state.calc.type,
    tags: state.calc.tags,
    date: state.calc.date,
    note: state.calc.note
  };

  if (state.calc.editingId) {
    await supabase.from('transactions').update(data).eq('id', state.calc.editingId);
  } else {
    await supabase.from('transactions').insert([data]);
  }

  // Update account balance
  const acc = state.accounts.find(a => a.id === state.calc.accountId);
  if (acc) {
    const change = state.calc.type === 'income' ? amount : -amount;
    const newBalance = (acc.balance || 0) + change;
    await supabase.from('accounts').update({ balance: newBalance }).eq('id', acc.id);
  }

  await loadData();
  showDashboard();
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

  // Header chips
  const chips = document.getElementById('filter-chips');
  const chipsHtml = [];
  if (state.filters.accountId) {
    const a = state.accounts.find(x => x.id === state.filters.accountId);
    chipsHtml.push(`<span class="chip">${a?.name} <button onclick="app.clearFilter('account')">×</button></span>`);
  }
  if (state.filters.categoryId) {
    const c = state.categories.find(x => x.id === state.filters.categoryId);
    chipsHtml.push(`<span class="chip">${c?.name} <button onclick="app.clearFilter('category')">×</button></span>`);
  }
  chips.innerHTML = chipsHtml.join('') || '<span style="color:var(--text-secondary);font-size:13px;">All transactions</span>';

  // Total
  const total = txs.reduce((s, t) => s + (t.type === 'income' ? 1 : -1) * (t.converted_amount || t.amount), 0);
  document.getElementById('list-total').innerHTML = `
    <span>TOTAL</span>
    <span class="amount" style="color:${total >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${formatMoney(Math.abs(total), state.settings.default_currency)}</span>
  `;

  // Group by date
  const groups = {};
  txs.forEach(t => {
    if (!groups[t.date]) groups[t.date] = [];
    groups[t.date].push(t);
  });

  const container = document.getElementById('transaction-list');
  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

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
        <div class="daily-total">Total: ${formatMoney(Math.abs(dayTotal), state.settings.default_currency)}</div>
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
        <span class="tx-account">${acc?.name || 'Unknown'}</span>
        <span class="tx-category">${cat?.name || 'Unknown'}</span>
        ${t.tags?.length ? `<span class="tx-tags">${t.tags.map(tag => '#' + tag).join(' ')}</span>` : ''}
      </div>
      <div class="tx-right">
        <div class="tx-amount ${isExp ? 'expense' : 'income'}">${isExp ? '-' : '+'}${formatMoney(t.amount, t.currency)}</div>
        ${t.converted_amount && t.currency !== state.settings.default_currency ? `<div class="tx-converted">≈ ${formatMoney(t.converted_amount, state.settings.default_currency)}</div>` : ''}
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
  // Populate multi-selects
  const accContainer = document.getElementById('report-accounts');
  accContainer.innerHTML = state.accounts.map(a => `
    <span class="select-pill" onclick="app.toggleReportFilter('accounts','${a.id}',this)">${a.name}</span>
  `).join('');

  const catContainer = document.getElementById('report-categories');
  catContainer.innerHTML = state.categories.map(c => `
    <span class="select-pill" onclick="app.toggleReportFilter('categories','${c.id}',this)">${c.name}</span>
  `).join('');

  const allTags = getAllTags();
  const tagContainer = document.getElementById('report-tags');
  tagContainer.innerHTML = allTags.map(tag => `
    <span class="select-pill" onclick="app.toggleReportFilter('tags','${tag}',this)">#${tag}</span>
  `).join('');

  // Default date range: current period
  const period = getPeriodRange();
  document.getElementById('report-from').value = period.start.toISOString().split('T')[0];
  document.getElementById('report-to').value = period.end.toISOString().split('T')[0];

  document.getElementById('report-results').innerHTML = '';
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
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;

  let txs = state.transactions.filter(t => t.date >= from && t.date <= to);

  if (state.reportFilters.accounts.length) {
    txs = txs.filter(t => state.reportFilters.accounts.includes(t.account_id));
  }
  if (state.reportFilters.categories.length) {
    txs = txs.filter(t => state.reportFilters.categories.includes(t.category_id));
  }
  if (state.reportFilters.tags.length) {
    txs = txs.filter(t => state.reportFilters.tags.some(tag => (t.tags || []).includes(tag)));
  }

  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + (t.converted_amount || t.amount), 0);
  const expenses = txs.filter(t => t.type === 'expense').reduce((s, t) => s + (t.converted_amount || t.amount), 0);

  const results = document.getElementById('report-results');
  results.innerHTML = `
    <div class="report-summary">
      <div class="report-summary-row"><span>Transactions</span><span>${txs.length}</span></div>
      <div class="report-summary-row"><span>Income</span><span style="color:var(--accent-green)">${formatMoney(income, state.settings.default_currency)}</span></div>
      <div class="report-summary-row"><span>Expenses</span><span style="color:var(--accent-red)">${formatMoney(expenses, state.settings.default_currency)}</span></div>
      <div class="report-summary-row"><span>Net</span><span style="color:${income >= expenses ? 'var(--accent-green)' : 'var(--accent-red)'}">${formatMoney(income - expenses, state.settings.default_currency)}</span></div>
    </div>
    ${txs.length ? txs.map(t => renderTxItem(t)).join('') : '<div class="empty-state">No results</div>'}
  `;
}

// ==================== SETTINGS ====================
function openSettings() {
  document.getElementById('setting-period-day').value = state.settings.period_start_day || 1;
  document.getElementById('setting-currency').value = state.settings.default_currency || 'USD';
  showScreen('settings');
}

async function saveSettings() {
  const day = parseInt(document.getElementById('setting-period-day').value) || 1;
  const currency = document.getElementById('setting-currency').value;

  await supabase.from('settings').update({
    period_start_day: day,
    default_currency: currency
  }).eq('id', state.settings.id);

  state.settings.period_start_day = day;
  state.settings.default_currency = currency;
  await loadData();
  showDashboard();
}

// ==================== FORMS ====================
function openForm(type, id) {
  document.getElementById('form-type').value = type;
  document.getElementById('form-id').value = id || '';
  document.getElementById('form-title').textContent = id ? 'Edit' : 'Add ' + type;
  document.getElementById('form-name').value = '';
  document.getElementById('form-balance').value = '';
  document.getElementById('form-icon').textContent = type === 'account' ? '💳' : '📁';
  document.getElementById('form-currency').value = state.settings.default_currency;

  if (type === 'category') {
    document.getElementById('form-balance-group').style.display = 'none';
  } else {
    document.getElementById('form-balance-group').style.display = 'block';
  }

  if (id) {
    const item = type === 'account'
      ? state.accounts.find(a => a.id === id)
      : state.categories.find(c => c.id === id);
    if (item) {
      document.getElementById('form-name').value = item.name;
      document.getElementById('form-icon').textContent = item.icon || (type === 'account' ? '💳' : '📁');
      document.getElementById('form-currency').value = item.currency || state.settings.default_currency;
      if (type === 'account') document.getElementById('form-balance').value = item.balance || 0;
    }
  }

  showScreen('form');
}

async function saveForm() {
  const type = document.getElementById('form-type').value;
  const id = document.getElementById('form-id').value;
  const name = document.getElementById('form-name').value.trim();
  const icon = document.getElementById('form-icon').textContent;
  const currency = document.getElementById('form-currency').value;

  if (!name) return alert('Enter name');

  const data = { name, icon, currency };
  if (type === 'account') data.balance = parseFloat(document.getElementById('form-balance').value) || 0;

  if (id) {
    await supabase.from(type + 's').update(data).eq('id', id);
  } else {
    await supabase.from(type + 's').insert([data]);
  }

  await loadData();
  showDashboard();
}

// ==================== PICKERS ====================
function showAccountPicker() {
  showPicker('Select Account', state.accounts.map(a => ({
    icon: a.icon || '💳',
    label: a.name,
    action: () => { state.calc.accountId = a.id; state.calc.currency = a.currency; updateCalcUI(); }
  })));
}

function showCategoryPicker() {
  showPicker('Select Category', state.categories.map(c => ({
    icon: c.icon || '📁',
    label: c.name,
    action: () => { state.calc.categoryId = c.id; updateCalcUI(); }
  })));
}

function showPicker(title, items) {
  document.getElementById('picker-title').textContent = title;
  document.getElementById('picker-list').innerHTML = items.map(item => `
    <div class="picker-item" onclick="(${item.action})(); app.closeModal()">
      <span style="font-size:24px">${item.icon}</span>
      <span>${item.label}</span>
    </div>
  `).join('');
  document.getElementById('picker-modal').classList.add('active');
}

function closeModal() {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

// ==================== UTILS ====================
function formatMoney(amount, currency) {
  if (typeof amount !== 'number') amount = parseFloat(amount) || 0;
  const symbol = { USD: '$', EUR: '€', GBP: '£', MXN: '$', JPY: '¥', CNY: '¥', KRW: '₩', RUB: '₽', VND: '₫', THB: '฿', BRL: 'R$', AED: 'dh', CAD: 'C$', AUD: 'A$', CHF: 'Fr', ARS: '$', COP: '$', PEN: 'S/', CLP: '$', BTC: '₿', ETH: 'Ξ' }[currency] || currency + ' ';
  return symbol + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const rates = state.rates || {};
  if (!rates[from] || !rates[to]) return amount; // fallback
  const inUSD = amount / rates[from];
  return inUSD * rates[to];
}

// Icon picker click
document.getElementById('form-icon').addEventListener('click', () => {
  const icons = ICONS.map(ic => `<div class="picker-item" onclick="document.getElementById('form-icon').textContent='${ic}';app.closeModal()"><span style="font-size:28px">${ic}</span></div>`).join('');
  document.getElementById('picker-title').textContent = 'Choose Icon';
  document.getElementById('picker-list').innerHTML = icons;
  document.getElementById('picker-modal').classList.add('active');
});

// Global app object for inline handlers
window.app = {
  showDashboard: () => { renderDashboard(); showScreen('dashboard'); },
  openCalculator, editTransaction, setType, toggleTag, addTagPrompt,
  calcDigit, calcDecimal, calcBackspace, calcClear, calcOp, calcPercent, calcEquals, calcNote,
  setDate, showDatePicker, confirmDate, saveTransaction,
  openList, clearFilter, showDateRangePicker,
  openReports, toggleReportFilter, runReport,
  openSettings, saveSettings, refreshRates,
  openForm, saveForm,
  showAccountPicker, showCategoryPicker, closeModal
};