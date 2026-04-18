// spend-lens — client-side CSV analyzer.
// Every line of logic here runs in the browser. The server never sees your file.

(function () {
    'use strict';

    const uploadZone = document.getElementById('upload-zone');
    const uploadSection = document.getElementById('upload-section');
    const uploadPrompt = document.getElementById('upload-prompt');
    const sampleLink = document.getElementById('sample-link');
    const csvInput = document.getElementById('csv-input');
    const resultsSection = document.getElementById('results');
    const resultsTitle = document.getElementById('results-title');
    const fileChips = document.getElementById('file-chips');
    const summaryCards = document.getElementById('summary-cards');
    const previewTable = document.getElementById('preview-table');
    const resetBtn = document.getElementById('reset-btn');

    // Column name variants across banks.
    // Order matters: more specific names first — 'Date' is the last-resort catchall.
    const COLUMN_ALIASES = {
        date: [
            'Transaction Date', 'Trans. Date', 'Trans Date',
            'Posting Date', 'Posted Date', 'Post Date',
            'Activity Date', 'Date'
        ],
        description: ['Description', 'Payee', 'Merchant', 'Name', 'Details'],
        amount: ['Amount', 'Debit', 'Credit'],
        category: ['Category']
    };

    // App state — array of parsed files. Single source of truth.
    const state = {
        files: [],      // [{id, name, bank, transactions: [{date, dateObj, description, amount}]}]
        nextId: 1
    };

    // --- User tags (persisted on THIS device's localStorage, never transmitted) ---
    // Normalized merchant name → category override. Acts as Level-1 (exact match)
    // rule checked before keyword rules or ML. Also fed to the ML classifier as
    // Level-2 exemplars so centroids learn from your world.
    const USER_TAGS_KEY = 'spendlens.userTags';

    function loadUserTags() {
        try {
            const raw = localStorage.getItem(USER_TAGS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function saveUserTags(tags) {
        try {
            localStorage.setItem(USER_TAGS_KEY, JSON.stringify(tags));
        } catch (e) { /* quota or disabled — ignore */ }
    }

    function clearUserTags() {
        try { localStorage.removeItem(USER_TAGS_KEY); } catch (e) {}
    }

    let userTags = loadUserTags();

    function userExemplarsByCategory() {
        const out = {};
        for (const [merchant, cat] of Object.entries(userTags)) {
            if (!out[cat]) out[cat] = [];
            out[cat].push(merchant);
        }
        return out;
    }

    // Level-1: check user tags first, fall back to keyword rules.
    function categorizeWithUserTags(description, bankCategory) {
        const normalized = normalizeMerchantName(description);
        if (normalized && userTags[normalized]) return userTags[normalized];
        if (window.SpendLensCategories) {
            return window.SpendLensCategories.categorize(description, bankCategory);
        }
        return 'Uncategorized';
    }

    // --- Parsing helpers ---

    function findColumn(headers, candidates) {
        const normalized = headers.map(h => h.trim().toLowerCase());
        for (const candidate of candidates) {
            const idx = normalized.indexOf(candidate.toLowerCase());
            if (idx !== -1) return headers[idx];
        }
        return null;
    }

    function detectBankFormat(headers) {
        const lower = headers.map(h => h.trim().toLowerCase());
        const has = (s) => lower.includes(s);
        if (has('posting date') && has('balance')) return 'Chase (checking)';
        if (has('post date') && has('category')) return 'Chase (credit card)';
        if (has('posted date') || has('payee')) return 'Bank of America';
        if (has('trans. date') || (has('transaction date') && has('card member'))) return 'Amex';
        if (has('transaction date')) return 'Generic (Wells Fargo / other)';
        return 'Generic CSV';
    }

    function parseDate(s) {
        if (!s) return null;
        const str = String(s).trim();
        // MM/DD/YYYY or M/D/YYYY
        let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
        // YYYY-MM-DD
        m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        // MM-DD-YYYY
        m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
        // Fallback to Date constructor (handles many edge cases)
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
    }

    function parseAmount(row, amountCol) {
        if (amountCol) {
            const raw = String(row[amountCol] || '').replace(/[$,]/g, '').trim();
            const num = parseFloat(raw);
            return isNaN(num) ? 0 : num;
        }
        // Some banks split into Debit / Credit columns.
        const debit = parseFloat(String(row['Debit'] || '').replace(/[$,]/g, '')) || 0;
        const credit = parseFloat(String(row['Credit'] || '').replace(/[$,]/g, '')) || 0;
        return credit - debit;
    }

    // Returns {ok, file?, error?}
    function parseFile(fileName, headers, rows) {
        const dateCol = findColumn(headers, COLUMN_ALIASES.date);
        const descCol = findColumn(headers, COLUMN_ALIASES.description);
        const amountCol = findColumn(headers, COLUMN_ALIASES.amount);
        const categoryCol = findColumn(headers, COLUMN_ALIASES.category);

        const missing = [];
        if (!dateCol) missing.push('date');
        if (!descCol) missing.push('description');
        if (missing.length) {
            return {
                ok: false,
                error: `${fileName}: couldn't find ${missing.join(' and ')} column${missing.length > 1 ? 's' : ''}. ` +
                       `Detected headers: ${headers.join(', ')}. ` +
                       `If this is from a US bank, open an issue on GitHub with a sanitized sample.`
            };
        }

        const bank = detectBankFormat(headers);

        const transactions = rows.map(row => {
            const dateStr = String(row[dateCol] || '').trim();
            const desc = String(row[descCol] || '').trim();
            const bankCat = categoryCol ? String(row[categoryCol] || '').trim() : '';
            return {
                date: dateStr,
                dateObj: parseDate(dateStr),
                description: desc,
                amount: parseAmount(row, amountCol),
                category: categorizeWithUserTags(desc, bankCat)
            };
        }).filter(t => t.date && t.description);

        if (transactions.length === 0) {
            return { ok: false, error: `${fileName}: no valid transactions found.` };
        }

        // Assign stable dedupe keys. Two identical transactions within the SAME file
        // (e.g. genuinely two $5 coffees on the same day) get sequential numbers so
        // they survive cross-file dedup. Same key matching across files == duplicate.
        const seqCounter = new Map();
        for (const t of transactions) {
            const base = `${t.date}|${t.description}|${t.amount}`;
            const seq = (seqCounter.get(base) || 0) + 1;
            seqCounter.set(base, seq);
            t.dedupeKey = `${base}|${seq}`;
        }

        return {
            ok: true,
            file: { id: state.nextId++, name: fileName, bank, transactions, skippedDupes: 0 }
        };
    }

    // --- State mutations ---

    function addFile(parsed) {
        // Dedup against transactions already loaded from other files.
        const existing = new Set();
        for (const f of state.files) {
            for (const t of f.transactions) existing.add(t.dedupeKey);
        }

        const kept = [];
        let skipped = 0;
        for (const t of parsed.transactions) {
            if (existing.has(t.dedupeKey)) {
                skipped++;
            } else {
                kept.push(t);
                existing.add(t.dedupeKey);
            }
        }

        if (kept.length === 0) {
            showError(
                `${parsed.name}: all ${parsed.transactions.length} transactions are duplicates of data already loaded. Nothing added.`
            );
            return;
        }

        parsed.transactions = kept;
        parsed.skippedDupes = skipped;
        state.files.push(parsed);
        render();
    }

    function removeFile(id) {
        state.files = state.files.filter(f => f.id !== id);
        render();
    }

    function clearAll() {
        state.files = [];
        render();
    }

    // --- Rendering ---

    function formatMoney(n) {
        const abs = Math.abs(n);
        const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (n < 0 ? '-' : '') + '$' + formatted;
    }

    function formatDate(d) {
        if (!d) return '—';
        return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function mergedTransactions() {
        const all = [];
        for (const f of state.files) {
            for (const t of f.transactions) {
                all.push({ ...t, sourceFile: f.name, sourceBank: f.bank });
            }
        }
        // Sort most recent first; transactions without a parseable date go last.
        all.sort((a, b) => {
            if (!a.dateObj && !b.dateObj) return 0;
            if (!a.dateObj) return 1;
            if (!b.dateObj) return -1;
            return b.dateObj - a.dateObj;
        });
        return all;
    }

    function renderChips() {
        fileChips.innerHTML = state.files.map(f => {
            const dupes = f.skippedDupes ? ` · +${f.skippedDupes} dupes skipped` : '';
            return `
                <div class="file-chip" data-id="${f.id}">
                    <span class="chip-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
                    <span class="chip-meta">${escapeHtml(f.bank)} · ${f.transactions.length}${dupes}</span>
                    <button class="chip-remove" data-id="${f.id}" aria-label="Remove file">×</button>
                </div>
            `;
        }).join('');
    }

    function renderPeriod(txns) {
        const el = document.getElementById('results-period');
        if (!el) return;
        const validDates = txns.map(t => t.dateObj).filter(Boolean);
        if (validDates.length === 0) { el.innerHTML = ''; return; }
        const start = new Date(Math.min(...validDates));
        const end = new Date(Math.max(...validDates));
        const days = Math.round((end - start) / 86400000) + 1;
        el.innerHTML = `
            ${formatDate(start)}<span class="period-sep">→</span>${formatDate(end)}
            <span class="period-sep">·</span><span class="period-days">${days.toLocaleString()} days</span>
        `;
    }

    function renderSummary(txns) {
        const debits = txns.filter(t => t.amount < 0);
        const credits = txns.filter(t => t.amount > 0);
        const totalSpend = debits.reduce((s, t) => s + t.amount, 0);
        const totalIncome = credits.reduce((s, t) => s + t.amount, 0);

        const validDates = txns.map(t => t.dateObj).filter(Boolean);
        const dateRange = validDates.length > 0
            ? `${formatDate(new Date(Math.min(...validDates)))} → ${formatDate(new Date(Math.max(...validDates)))}`
            : '—';

        summaryCards.innerHTML = `
            <div class="summary-card">
                <div class="label-sm">Transactions</div>
                <div class="value">${txns.length.toLocaleString()}</div>
                <div class="sub">${dateRange}</div>
            </div>
            <div class="summary-card">
                <div class="label-sm">Total spend</div>
                <div class="value neg">${formatMoney(totalSpend)}</div>
                <div class="sub">${debits.length.toLocaleString()} debits</div>
            </div>
            <div class="summary-card">
                <div class="label-sm">Total income</div>
                <div class="value pos">${formatMoney(totalIncome)}</div>
                <div class="sub">${credits.length.toLocaleString()} credits</div>
            </div>
            <div class="summary-card">
                <div class="label-sm">Net</div>
                <div class="value ${totalSpend + totalIncome < 0 ? 'neg' : 'pos'}">${formatMoney(totalSpend + totalIncome)}</div>
                <div class="sub">income − spend</div>
            </div>
        `;
    }

    // --- Top savings opportunities ---

    function periodLengthDays(txns) {
        const dates = txns.map(t => t.dateObj).filter(Boolean);
        if (dates.length === 0) return 0;
        const min = Math.min(...dates);
        const max = Math.max(...dates);
        return Math.max(1, Math.round((max - min) / 86400000) + 1);
    }

    function annualizeFromPeriod(amount, periodDays) {
        if (periodDays <= 0) return amount;
        return amount * (365 / periodDays);
    }

    function analyzeSavings(txns, recurring) {
        const opportunities = [];
        const periodDays = periodLengthDays(txns);

        // A. Subscriptions — assume 30% of recurring charges are reviewable / cuttable.
        if (recurring.length > 0) {
            const monthlyTotal = recurring.reduce((s, r) => s + r.annualized / 12, 0);
            const annualTotal = recurring.reduce((s, r) => s + r.annualized, 0);
            if (monthlyTotal >= 10) {
                const top = recurring.slice(0, 3).map(r => r.name);
                const detail = `${top.join(', ')}${recurring.length > 3 ? `, +${recurring.length - 3} more` : ''}`;
                const impact = annualTotal * 0.3;
                opportunities.push({
                    title: `${recurring.length} recurring charge${recurring.length > 1 ? 's' : ''} totaling ${formatMoney(-monthlyTotal)}/mo`,
                    detail,
                    action: 'Review each one — cancel what you forgot about',
                    impact,
                    impactLabel: formatMoney(-impact) + '/yr',
                    impactSub: 'potential savings'
                });
            }
        }

        // B. Fees — annualize whatever shows up in the Fees category.
        const fees = txns.filter(t => t.category === 'Fees' && t.amount < 0);
        const feeTotal = fees.reduce((s, t) => s + Math.abs(t.amount), 0);
        if (feeTotal >= 5) {
            const annualized = annualizeFromPeriod(feeTotal, periodDays);
            opportunities.push({
                title: `${formatMoney(-feeTotal)} in fees this period`,
                detail: `${fees.length} fee charge${fees.length > 1 ? 's' : ''} — late fees, overdrafts, foreign-transaction fees`,
                action: 'Most are avoidable with a fee-free account or autopay setup',
                impact: annualized,
                impactLabel: formatMoney(-annualized) + '/yr',
                impactSub: 'if pattern continues'
            });
        }

        // C. Food & Drink frequency — assume cutting dining-out by 25% is realistic.
        const food = txns.filter(t => t.category === 'Food & Drink' && t.amount < 0);
        const foodTotal = food.reduce((s, t) => s + Math.abs(t.amount), 0);
        if (food.length >= 5 && foodTotal >= 100) {
            const annualized = annualizeFromPeriod(foodTotal, periodDays);
            const impact = annualized * 0.25;
            opportunities.push({
                title: `${food.length} restaurant & delivery charges, ${formatMoney(-foodTotal)}`,
                detail: `Food & delivery is ${Math.round(foodTotal / Math.max(1, sumSpend(txns)) * 100)}% of your outflows this period`,
                action: 'Cooking at home 25% more often would save roughly this',
                impact,
                impactLabel: formatMoney(-impact) + '/yr',
                impactSub: '25% reduction'
            });
        }

        // D. Streaming stack overlap — 3+ entertainment subs flagged as a specific callout.
        const streamingSubs = recurring.filter(r =>
            r.category === 'Entertainment' && r.cadence === 'monthly'
        );
        if (streamingSubs.length >= 3) {
            const monthlyStreaming = streamingSubs.reduce((s, r) => s + r.avgAmount, 0);
            const impact = monthlyStreaming * 12 * 0.4; // assume 40% of streaming stack is consolidation-worthy
            opportunities.push({
                title: `${streamingSubs.length} streaming services totaling ${formatMoney(-monthlyStreaming)}/mo`,
                detail: streamingSubs.map(s => s.name).join(', '),
                action: 'Rotate instead of stacking — cancel and re-sub as you watch',
                impact,
                impactLabel: formatMoney(-impact) + '/yr',
                impactSub: 'rotation savings'
            });
        }

        return opportunities.sort((a, b) => b.impact - a.impact).slice(0, 3);
    }

    function sumSpend(txns) {
        return txns.reduce((s, t) => t.amount < 0 ? s + Math.abs(t.amount) : s, 0);
    }

    function renderSavings(opportunities) {
        const section = document.getElementById('savings-section');
        const list = document.getElementById('savings-list');
        if (!section || !list) return;

        if (opportunities.length === 0) {
            section.classList.add('hidden');
            return;
        }

        list.innerHTML = opportunities.map(o => `
            <li class="savings-item">
                <div class="savings-main">
                    <div class="savings-title">${escapeHtml(o.title)}</div>
                    <div class="savings-detail">${escapeHtml(o.detail)}</div>
                    <div class="savings-action">${escapeHtml(o.action)}</div>
                </div>
                <div class="savings-impact">
                    <div class="savings-impact-val">${o.impactLabel}</div>
                    <div class="savings-impact-sub">${escapeHtml(o.impactSub)}</div>
                </div>
            </li>
        `).join('');

        section.classList.remove('hidden');
    }

    // --- Trend chart (spend + income over time) ---

    let trendChart = null;

    function bucketKey(date, granularity) {
        if (granularity === 'week') {
            const d = new Date(date);
            const dow = d.getDay() || 7; // Sun=0 → treat as 7 so Mon is first
            d.setDate(d.getDate() - dow + 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    function bucketLabel(key, granularity) {
        if (granularity === 'week') {
            const [y, m, d] = key.split('-').map(Number);
            const date = new Date(y, m - 1, d);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        const [y, m] = key.split('-').map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    }

    function chooseGranularity(txns) {
        const dates = txns.map(t => t.dateObj).filter(Boolean);
        if (dates.length === 0) return 'week';
        const min = Math.min(...dates);
        const max = Math.max(...dates);
        const days = (max - min) / 86400000;
        return days > 60 ? 'month' : 'week';
    }

    function aggregateByPeriod(txns, granularity) {
        const buckets = new Map();
        for (const t of txns) {
            if (!t.dateObj) continue;
            const key = bucketKey(t.dateObj, granularity);
            if (!buckets.has(key)) buckets.set(key, { key, spend: 0, income: 0 });
            const b = buckets.get(key);
            if (t.amount < 0) b.spend += -t.amount;
            else b.income += t.amount;
        }
        return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
    }

    function renderTrend(txns) {
        const section = document.getElementById('trend-section');
        const canvas = document.getElementById('trend-chart');
        const sub = document.getElementById('trend-sub');
        if (!section || !canvas || typeof Chart === 'undefined') return;

        if (trendChart) { trendChart.destroy(); trendChart = null; }

        const granularity = chooseGranularity(txns);
        const buckets = aggregateByPeriod(txns, granularity);

        if (buckets.length < 2) {
            section.classList.add('hidden');
            return;
        }

        const labels = buckets.map(b => bucketLabel(b.key, granularity));
        const spendData = buckets.map(b => b.spend);
        const incomeData = buckets.map(b => b.income);
        const anyIncome = incomeData.some(v => v > 0);

        const datasets = [{
            label: 'Spend',
            data: spendData,
            borderColor: '#e67a6b',
            backgroundColor: 'rgba(230, 122, 107, 0.12)',
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5
        }];
        if (anyIncome) {
            datasets.push({
                label: 'Income',
                data: incomeData,
                borderColor: '#65bc7b',
                backgroundColor: 'rgba(101, 188, 123, 0.1)',
                fill: true,
                tension: 0.3,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 5
            });
        }

        trendChart = new Chart(canvas, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: {
                            color: '#e8e8e8',
                            font: { family: 'Figtree', size: 12 },
                            usePointStyle: true,
                            padding: 14,
                            boxWidth: 6
                        }
                    },
                    tooltip: {
                        backgroundColor: '#0f141a',
                        titleColor: '#e8e8e8',
                        bodyColor: '#e8e8e8',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}`
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: '#8b9199', font: { family: 'JetBrains Mono', size: 11 } },
                        grid: { color: 'rgba(255,255,255,0.04)' }
                    },
                    y: {
                        ticks: {
                            color: '#8b9199',
                            font: { family: 'JetBrains Mono', size: 11 },
                            callback: (v) => '$' + v.toLocaleString()
                        },
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        beginAtZero: true
                    }
                }
            }
        });

        if (sub) sub.textContent = granularity === 'week' ? 'weekly' : 'monthly';
        section.classList.remove('hidden');
    }

    // --- Month over month ---

    function monthKeyFromDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    function monthLabel(key) {
        const [y, m] = key.split('-').map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    function computeMoM(txns) {
        const byMonth = new Map();
        for (const t of txns) {
            if (!t.dateObj || t.amount >= 0) continue;
            const mk = monthKeyFromDate(t.dateObj);
            if (!byMonth.has(mk)) byMonth.set(mk, new Map());
            const cats = byMonth.get(mk);
            const cat = t.category || 'Uncategorized';
            cats.set(cat, (cats.get(cat) || 0) + Math.abs(t.amount));
        }

        const months = Array.from(byMonth.keys()).sort();
        if (months.length < 2) return null;

        const priorKey = months[months.length - 2];
        const currentKey = months[months.length - 1];
        const prior = byMonth.get(priorKey);
        const current = byMonth.get(currentKey);

        const allCats = new Set([...prior.keys(), ...current.keys()]);
        const rows = [];
        for (const cat of allCats) {
            const p = prior.get(cat) || 0;
            const c = current.get(cat) || 0;
            const delta = c - p;
            let pct = null;
            let flag = null;
            if (p > 0 && c > 0) pct = (delta / p) * 100;
            else if (p === 0 && c > 0) flag = 'new';
            else if (p > 0 && c === 0) flag = 'gone';
            rows.push({ category: cat, prior: p, current: c, delta, pct, flag });
        }
        // Rank by absolute delta so biggest movers (up or down) surface first.
        rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

        const priorTotal = Array.from(prior.values()).reduce((s, v) => s + v, 0);
        const currentTotal = Array.from(current.values()).reduce((s, v) => s + v, 0);

        return { priorKey, currentKey, prior: priorTotal, current: currentTotal, rows };
    }

    function renderMoM(txns) {
        const section = document.getElementById('mom-section');
        const title = document.getElementById('mom-title');
        const totalEl = document.getElementById('mom-total');
        const listEl = document.getElementById('mom-list');
        if (!section || !title || !totalEl || !listEl) return;

        const data = computeMoM(txns);
        if (!data) { section.classList.add('hidden'); return; }

        title.textContent = `Month over month — ${monthLabel(data.priorKey)} vs ${monthLabel(data.currentKey)}`;

        const delta = data.current - data.prior;
        const pct = data.prior > 0 ? (delta / data.prior) * 100 : null;
        const deltaCls = delta > 0 ? 'mom-delta-up' : (delta < 0 ? 'mom-delta-down' : '');
        const sign = delta > 0 ? '+' : (delta < 0 ? '−' : '');
        const pctStr = pct === null ? '' : ` (${sign}${Math.abs(pct).toFixed(0)}%)`;
        totalEl.innerHTML = `
            Total outflow
            <span class="mom-prior">${formatMoney(-data.prior)}</span>
            <span class="arrow">→</span>
            <span class="mom-current">${formatMoney(-data.current)}</span>
            <span class="${deltaCls}">${delta === 0 ? 'no change' : `${sign}${formatMoney(Math.abs(delta))}${pctStr}`.replace(/−\$/, '−$')}</span>
        `;

        // Cap the displayed list at 10 biggest movers — the rest is typically noise.
        const rows = data.rows.slice(0, 10);
        listEl.innerHTML = rows.map(r => {
            let dirCls, dirChar, pctCls, pctStr;
            if (r.flag === 'new') {
                dirCls = 'up'; dirChar = '↑'; pctCls = 'new'; pctStr = 'new';
            } else if (r.flag === 'gone') {
                dirCls = 'down'; dirChar = '↓'; pctCls = 'down'; pctStr = 'stopped';
            } else if (r.delta > 0) {
                dirCls = 'up'; dirChar = '↑'; pctCls = 'up';
                pctStr = r.pct === null ? '' : `+${r.pct.toFixed(0)}%`;
            } else if (r.delta < 0) {
                dirCls = 'down'; dirChar = '↓'; pctCls = 'down';
                pctStr = r.pct === null ? '' : `${r.pct.toFixed(0)}%`;
            } else {
                dirCls = 'flat'; dirChar = '·'; pctCls = 'flat'; pctStr = '—';
            }
            return `
                <div class="mom-row">
                    <span class="mom-dir ${dirCls}">${dirChar}</span>
                    <span class="mom-cat">${escapeHtml(r.category)}</span>
                    <span class="mom-values">${formatMoney(-r.prior)} → ${formatMoney(-r.current)}</span>
                    <span class="mom-pct ${pctCls}">${pctStr}</span>
                </div>
            `;
        }).join('');

        section.classList.remove('hidden');
    }

    // --- Category chart + breakdown ---

    const CATEGORY_CHART_TOP_N = 8;
    let categoryChart = null;

    function categoryColor(cat) {
        const colors = (window.SpendLensCategories && window.SpendLensCategories.colors) || {};
        return colors[cat] || '#64748b';
    }

    function aggregateSpendByCategory(txns) {
        const byCat = new Map();
        for (const t of txns) {
            // Only include outflows. Income + incoming transfers are excluded from the spend chart.
            if (t.amount >= 0) continue;
            const cat = t.category || 'Uncategorized';
            byCat.set(cat, (byCat.get(cat) || 0) + Math.abs(t.amount));
        }
        return Array.from(byCat.entries())
            .map(([category, total]) => ({ category, total }))
            .sort((a, b) => b.total - a.total);
    }

    function rollupTopN(cats, n) {
        if (cats.length <= n) return cats;
        const top = cats.slice(0, n);
        const rest = cats.slice(n);
        const otherTotal = rest.reduce((s, c) => s + c.total, 0);
        return [...top, { category: 'Other', total: otherTotal }];
    }

    function renderChart(agg) {
        const canvas = document.getElementById('category-chart');
        if (!canvas || typeof Chart === 'undefined') return;

        if (categoryChart) {
            categoryChart.destroy();
            categoryChart = null;
        }
        if (agg.length === 0) return;

        const total = agg.reduce((s, c) => s + c.total, 0);

        categoryChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: agg.map(c => c.category),
                datasets: [{
                    data: agg.map(c => c.total),
                    backgroundColor: agg.map(c => categoryColor(c.category)),
                    borderColor: '#1a1d1f',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '56%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#0f141a',
                        titleColor: '#e8e8e8',
                        bodyColor: '#e8e8e8',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: true,
                        callbacks: {
                            label: (ctx) => {
                                const v = ctx.parsed;
                                const pct = total > 0 ? (v / total * 100).toFixed(1) : '0';
                                return `${ctx.label}: ${formatMoney(-v)} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    function renderBreakdown(agg) {
        const container = document.getElementById('category-breakdown');
        if (!container) return;

        const total = agg.reduce((s, c) => s + c.total, 0);
        if (total === 0) {
            container.innerHTML = `<div style="color:var(--muted);padding:0.5rem 0;font-size:0.9rem;">No outflows to categorize yet.</div>`;
            return;
        }

        container.innerHTML = agg.map(c => {
            const pct = (c.total / total * 100).toFixed(1);
            return `
                <div class="category-row">
                    <span class="category-swatch" style="background:${categoryColor(c.category)}"></span>
                    <span class="category-name">${escapeHtml(c.category)}</span>
                    <span class="category-amount">${formatMoney(-c.total)}</span>
                    <span class="category-pct">${pct}%</span>
                </div>
            `;
        }).join('');
    }

    function renderPreview(txns) {
        const top = txns.slice(0, 10);
        const multiFile = state.files.length > 1;
        const tableRows = top.map(t => {
            const cls = t.amount < 0 ? 'neg' : 'pos';
            const source = multiFile ? `<td class="source">${escapeHtml(t.sourceBank)}</td>` : '';
            const cat = t.category || 'Uncategorized';
            const uncat = cat === 'Uncategorized' ? ' uncategorized' : '';
            const catCell = `<td class="category${uncat}">
                <span class="cat-swatch" style="background:${categoryColor(cat)}"></span><span class="cat-label">${escapeHtml(cat)}</span>
            </td>`;
            return `<tr>
                <td>${escapeHtml(t.date)}</td>
                <td>${escapeHtml(t.description)}</td>
                ${catCell}
                ${source}
                <td class="amount ${cls}">${formatMoney(t.amount)}</td>
            </tr>`;
        }).join('');

        const sourceHeader = multiFile ? '<th>Source</th>' : '';
        previewTable.innerHTML = `
            <table>
                <thead><tr><th>Date</th><th>Description</th><th>Category</th>${sourceHeader}<th>Amount</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        `;
    }

    // --- Recurring charge detection ---

    const CADENCE_SPECS = [
        { label: 'weekly',    min: 6,   max: 8,   periodsPerYear: 52  },
        { label: 'biweekly',  min: 13,  max: 15,  periodsPerYear: 26  },
        { label: 'monthly',   min: 25,  max: 35,  periodsPerYear: 12  },
        { label: 'quarterly', min: 85,  max: 95,  periodsPerYear: 4   },
        { label: 'annual',    min: 330, max: 400, periodsPerYear: 1   }
    ];

    function median(arr) {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    function coefficientOfVariation(arr) {
        if (arr.length === 0) return 0;
        const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
        if (mean === 0) return 0;
        const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
        return Math.sqrt(variance) / mean;
    }

    function detectCadence(medianIntervalDays) {
        return CADENCE_SPECS.find(c => medianIntervalDays >= c.min && medianIntervalDays <= c.max) || null;
    }

    function addDays(date, days) {
        const d = new Date(date);
        d.setDate(d.getDate() + days);
        return d;
    }

    function detectRecurring(txns) {
        const byMerchant = new Map();
        for (const t of txns) {
            if (t.amount >= 0) continue;
            if (!t.dateObj) continue;
            const key = normalizeMerchantName(t.description);
            if (!key) continue;
            if (!byMerchant.has(key)) byMerchant.set(key, []);
            byMerchant.get(key).push(t);
        }

        const recurring = [];
        for (const [name, txs] of byMerchant) {
            if (txs.length < 2) continue;
            txs.sort((a, b) => a.dateObj - b.dateObj);

            const intervals = [];
            for (let i = 1; i < txs.length; i++) {
                const days = (txs[i].dateObj - txs[i - 1].dateObj) / 86400000;
                intervals.push(days);
            }

            const medianInterval = median(intervals);
            const amounts = txs.map(t => Math.abs(t.amount));
            const medianAmount = median(amounts);
            const amountCoV = coefficientOfVariation(amounts);

            // Subscriptions have stable amounts. Reject highly variable merchants (coffee runs, etc.).
            if (amountCoV > 0.25) continue;

            const cadence = detectCadence(medianInterval);
            if (!cadence) continue;

            const last = txs[txs.length - 1];
            const nextExpected = addDays(last.dateObj, Math.round(medianInterval));

            recurring.push({
                name,
                cadence: cadence.label,
                periodsPerYear: cadence.periodsPerYear,
                avgAmount: medianAmount,
                count: txs.length,
                annualized: medianAmount * cadence.periodsPerYear,
                lastCharge: last.dateObj,
                nextExpected,
                category: last.category || 'Uncategorized'
            });
        }

        return recurring.sort((a, b) => b.annualized - a.annualized);
    }

    // Subscription simulator state — which subs are marked "cancelled" in the what-if.
    // In-memory only; forgotten on reload (doesn't affect categorization either).
    const cancelledSubs = new Set();
    let lastRecurring = [];

    function renderRecurring(subs) {
        const section = document.getElementById('recurring-section');
        const list = document.getElementById('recurring-list');
        const totalEl = document.getElementById('recurring-total');
        if (!section || !list || !totalEl) return;

        if (subs.length === 0) {
            section.classList.add('hidden');
            cancelledSubs.clear();
            lastRecurring = [];
            return;
        }

        // Prune cancelled set to names still present (files may have been removed)
        const validNames = new Set(subs.map(r => r.name));
        for (const n of Array.from(cancelledSubs)) {
            if (!validNames.has(n)) cancelledSubs.delete(n);
        }
        lastRecurring = subs;

        const monthlyTotal = subs.reduce((s, r) => s + (r.annualized / 12), 0);
        const annualTotal = subs.reduce((s, r) => s + r.annualized, 0);

        totalEl.innerHTML = `
            <span class="rec-total-val">${formatMoney(-monthlyTotal)}</span><span class="rec-total-sub">/mo</span>
            <span class="rec-total-sep">·</span>
            <span class="rec-total-val">${formatMoney(-annualTotal)}</span><span class="rec-total-sub">/yr</span>
        `;

        list.innerHTML = subs.map(r => {
            const checked = cancelledSubs.has(r.name) ? 'checked' : '';
            const cancelledCls = cancelledSubs.has(r.name) ? ' cancelled' : '';
            return `
                <div class="rec-row${cancelledCls}" data-name="${escapeHtml(r.name)}">
                    <label class="rec-check" title="Simulate canceling this subscription">
                        <input type="checkbox" class="rec-cancel-check" data-name="${escapeHtml(r.name)}" ${checked}>
                    </label>
                    <div class="rec-main">
                        <span class="rec-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
                        <span class="rec-meta">
                            <span class="rec-cadence">${r.cadence}</span>
                            ${escapeHtml(r.category)} · ${r.count} charges · last ${formatDate(r.lastCharge)} · next ≈ ${formatDate(r.nextExpected)}
                        </span>
                    </div>
                    <div class="rec-money">
                        <div class="rec-amount">${formatMoney(-r.avgAmount)}</div>
                        <div class="rec-annual">${formatMoney(-r.annualized)}/yr</div>
                    </div>
                </div>
            `;
        }).join('');

        section.classList.remove('hidden');
        updateSimulation();
    }

    function updateSimulation() {
        const sim = document.getElementById('rec-simulation');
        if (!sim) return;
        if (lastRecurring.length === 0 || cancelledSubs.size === 0) {
            sim.classList.add('hidden');
            return;
        }

        let savedMonthly = 0, savedAnnual = 0;
        let keptMonthly = 0;
        let nCancelled = 0, nKept = 0;
        for (const r of lastRecurring) {
            const monthly = r.annualized / 12;
            if (cancelledSubs.has(r.name)) {
                savedMonthly += monthly;
                savedAnnual += r.annualized;
                nCancelled++;
            } else {
                keptMonthly += monthly;
                nKept++;
            }
        }

        sim.innerHTML = `
            <div>
                <div class="sim-label">If you cancel ${nCancelled} subscription${nCancelled === 1 ? '' : 's'}</div>
                <div>
                    <span class="sim-save-big">Save ${formatMoney(-savedMonthly)}/mo</span>
                    <span class="sim-save-sub">· ${formatMoney(-savedAnnual)}/yr</span>
                </div>
            </div>
            <div class="sim-keep">
                Keep ${nKept}<br>
                <span class="sim-val">${formatMoney(-keptMonthly)}/mo</span>
            </div>
        `;
        sim.classList.remove('hidden');
    }

    // Delegated checkbox handler — toggles simulation state without re-rendering
    // the whole recurring list. O(1) per toggle.
    const recListEl = document.getElementById('recurring-list');
    if (recListEl) {
        recListEl.addEventListener('change', (e) => {
            const cb = e.target;
            if (!cb || !cb.classList || !cb.classList.contains('rec-cancel-check')) return;
            const name = cb.dataset.name;
            if (!name) return;
            if (cb.checked) cancelledSubs.add(name);
            else cancelledSubs.delete(name);
            const row = cb.closest('.rec-row');
            if (row) row.classList.toggle('cancelled', cb.checked);
            updateSimulation();
        });
    }

    // --- Uncategorized merchants ---

    function normalizeMerchantName(desc) {
        // Strip long numeric IDs, * / # noise, and trailing city codes to group
        // "STARBUCKS STORE 12847 ANYTOWN FL" and "STARBUCKS STORE 99999 ANYCITY FL"
        // as the same merchant for the uncategorized roll-up.
        let s = String(desc || '').toUpperCase();
        s = s.replace(/[*#].*$/, '');            // everything after * or #
        s = s.replace(/\s+\d{3,}.*$/, '');       // trailing "1234 LOCATION"
        s = s.replace(/\s+\d+$/, '');            // trailing lone numbers
        s = s.replace(/\s+[A-Z]{2}$/, '');       // trailing state code
        s = s.trim();
        // Keep first 4 tokens — most bank descriptions front-load the merchant name.
        const parts = s.split(/\s+/).slice(0, 4);
        return parts.join(' ') || desc;
    }

    function aggregateUncategorized(txns) {
        const byName = new Map();
        for (const t of txns) {
            if (t.category !== 'Uncategorized') continue;
            if (t.amount >= 0) continue; // focus on outflows worth categorizing
            const key = normalizeMerchantName(t.description);
            if (!key) continue;
            const entry = byName.get(key) || { name: key, count: 0, total: 0 };
            entry.count += 1;
            entry.total += Math.abs(t.amount);
            byName.set(key, entry);
        }
        return Array.from(byName.values()).sort((a, b) => b.total - a.total);
    }

    function categoryOptions(selected) {
        const cats = (window.SpendLensCategories && window.SpendLensCategories.list) || [];
        return cats.map(c => `<option value="${escapeHtml(c)}"${c === selected ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
    }

    function renderUncategorized(txns) {
        const section = document.getElementById('uncategorized-section');
        const list = document.getElementById('uncategorized-list');
        if (!section || !list) return;

        const rows = aggregateUncategorized(txns).slice(0, 10);
        if (rows.length === 0) {
            section.classList.add('hidden');
            return;
        }

        list.innerHTML = rows.map(r => `
            <div class="uncat-row">
                <span class="uncat-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
                <span class="uncat-count">${r.count}×</span>
                <span class="uncat-amount">${formatMoney(-r.total)}</span>
                <select class="tag-select" data-merchant="${escapeHtml(r.name)}" aria-label="Tag ${escapeHtml(r.name)} as category">
                    <option value="">Tag as…</option>
                    ${categoryOptions(null)}
                </select>
            </div>
        `).join('');
        section.classList.remove('hidden');
    }

    function renderTagSummary() {
        const el = document.getElementById('tag-summary');
        if (!el) return;
        const count = Object.keys(userTags).length;
        if (count === 0) {
            el.innerHTML = '';
            return;
        }
        el.innerHTML = `
            <span class="tag-count">${count} custom tag${count === 1 ? '' : 's'} saved on this device</span>
            <button class="tag-clear-btn" id="tag-clear-btn" type="button">Clear all</button>
        `;
    }

    function render() {
        clearError();
        if (state.files.length === 0) {
            // Back to initial state.
            if (categoryChart) { categoryChart.destroy(); categoryChart = null; }
            if (trendChart) { trendChart.destroy(); trendChart = null; }
            resultsSection.classList.add('hidden');
            uploadSection.classList.remove('hidden');
            uploadPrompt.textContent = 'Drop your CSV here, or click to select';
            if (sampleLink) sampleLink.style.display = '';
            renderTagSummary();
            return;
        }

        const txns = mergedTransactions();
        const n = state.files.length;
        resultsTitle.textContent = n === 1
            ? `${state.files[0].name} · ${state.files[0].bank}`
            : `Combined view · ${n} files · ${txns.length.toLocaleString()} transactions`;

        renderPeriod(txns);
        renderChips();
        const recurring = detectRecurring(txns);
        renderSavings(analyzeSavings(txns, recurring));
        renderSummary(txns);
        renderTrend(txns);
        renderMoM(txns);
        const agg = rollupTopN(aggregateSpendByCategory(txns), CATEGORY_CHART_TOP_N);
        renderChart(agg);
        renderBreakdown(agg);
        renderRecurring(recurring);
        renderUncategorized(txns);
        renderTagSummary();
        renderPreview(txns);

        resultsSection.classList.remove('hidden');
        // Keep upload zone visible for adding more files, but change its copy.
        uploadPrompt.textContent = 'Add another CSV';
        if (sampleLink) sampleLink.style.display = 'none';
    }

    // --- Error handling ---

    function showError(msg) {
        const existing = document.querySelector('.error');
        if (existing) existing.remove();
        const div = document.createElement('div');
        div.className = 'error';
        div.textContent = msg;
        uploadSection.prepend(div);
    }

    function clearError() {
        const existing = document.querySelector('.error');
        if (existing) existing.remove();
    }

    // --- File ingest ---

    function ingestFile(file) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showError(`${file.name}: not a .csv file. Skipped.`);
            return;
        }

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (result) => {
                if (result.errors && result.errors.length > 0) {
                    const fatal = result.errors.filter(e => e.type === 'Delimiter' || e.type === 'Header');
                    if (fatal.length > 0) {
                        showError(`${file.name}: CSV parse error: ${fatal[0].message}`);
                        return;
                    }
                }
                if (!result.data || result.data.length === 0) {
                    showError(`${file.name}: empty CSV.`);
                    return;
                }
                const headers = result.meta.fields || Object.keys(result.data[0]);
                const parsed = parseFile(file.name, headers, result.data);
                if (!parsed.ok) {
                    showError(parsed.error);
                    return;
                }
                addFile(parsed.file);
            },
            error: (err) => {
                showError(`${file.name}: failed to parse — ${err.message}`);
            }
        });
    }

    function ingestFileList(fileList) {
        if (!fileList) return;
        // FileList isn't iterable via for-of in older specs — use Array.from.
        Array.from(fileList).forEach(ingestFile);
        // Reset input so uploading the same filename again fires change.
        csvInput.value = '';
    }

    // --- AI classifier integration ---

    const aiBtn = document.getElementById('ai-btn');
    const aiStatus = document.getElementById('ai-status');
    let aiClassifyInFlight = false;

    function setAiStatus(text, variant) {
        if (!aiStatus) return;
        aiStatus.classList.remove('hidden', 'success', 'error');
        if (variant) aiStatus.classList.add(variant);
        aiStatus.textContent = text;
    }

    async function handleAiClick() {
        if (aiClassifyInFlight) return;
        if (!window.SpendLensClassifier) {
            setAiStatus('Classifier script did not load.', 'error');
            return;
        }
        aiClassifyInFlight = true;
        aiBtn.disabled = true;
        setAiStatus('Loading ML model (first time: ~22MB download, then cached in your browser)...');

        try {
            await window.SpendLensClassifier.load((progress) => {
                if (progress && progress.status === 'progress' && typeof progress.progress === 'number') {
                    const pct = Math.round(progress.progress);
                    const file = progress.file || progress.name || 'model';
                    setAiStatus(`Downloading ${file} — ${pct}%`);
                }
            }, userExemplarsByCategory());
        } catch (e) {
            setAiStatus('Failed to load model: ' + e.message, 'error');
            aiBtn.disabled = false;
            aiClassifyInFlight = false;
            return;
        }

        const targets = [];
        for (const f of state.files) {
            for (const t of f.transactions) {
                if (t.category === 'Uncategorized' && t.amount < 0) targets.push(t);
            }
        }

        if (targets.length === 0) {
            setAiStatus('No uncategorized outflows to classify.', 'success');
            aiBtn.disabled = false;
            aiClassifyInFlight = false;
            return;
        }

        setAiStatus(`Classifying ${targets.length} transactions...`);

        let assigned = 0;
        let processed = 0;
        for (const t of targets) {
            try {
                const key = normalizeMerchantName(t.description) || t.description;
                const result = await window.SpendLensClassifier.classify(key);
                if (result && result.category) {
                    t.category = result.category;
                    t.aiClassified = true;
                    t.aiScore = result.score;
                    assigned++;
                }
            } catch (e) {
                // Skip individual failures; keep going.
            }
            processed++;
            if (processed % 10 === 0 || processed === targets.length) {
                setAiStatus(`Classifying... ${processed} / ${targets.length}`);
            }
        }

        render();
        const btnLabel = document.querySelector('#ai-btn .ai-btn-label');
        if (btnLabel) btnLabel.textContent = 'Re-run AI classification';
        setAiStatus(
            `${assigned} of ${targets.length} classified by the model · threshold ≥ ${window.SpendLensClassifier.threshold}`,
            'success'
        );
        aiBtn.disabled = false;
        aiClassifyInFlight = false;
    }

    if (aiBtn) aiBtn.addEventListener('click', handleAiClick);

    // --- User tag application ---

    function showToast(message) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = message;
        el.classList.remove('hidden');
        // force reflow so transition runs
        void el.offsetWidth;
        el.classList.add('visible');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => {
            el.classList.remove('visible');
            setTimeout(() => el.classList.add('hidden'), 300);
        }, 2400);
    }

    function applyUserTag(merchantName, category) {
        if (!merchantName || !category) {
            console.warn('[spend-lens] applyUserTag called with empty value', { merchantName, category });
            return;
        }

        userTags[merchantName] = category;
        saveUserTags(userTags);

        // Re-categorize every transaction whose normalized name matches.
        let matched = 0;
        for (const f of state.files) {
            for (const t of f.transactions) {
                if (normalizeMerchantName(t.description) === merchantName) {
                    t.category = category;
                    t.userTagged = true;
                    matched++;
                }
            }
        }

        console.log(`[spend-lens] tagged "${merchantName}" → "${category}" — ${matched} transaction${matched === 1 ? '' : 's'} updated`);

        // Level-2: if the ML model is loaded, teach it by adding this merchant
        // as an exemplar and re-averaging the centroid.
        if (window.SpendLensClassifier && window.SpendLensClassifier.isReady()) {
            window.SpendLensClassifier.addUserExemplar(category, merchantName)
                .catch(() => { /* non-fatal */ });
        }

        render();
        showToast(`Tagged "${merchantName}" as ${category} · ${matched} transaction${matched === 1 ? '' : 's'}`);
    }

    function applyClearUserTags() {
        if (!confirm('Clear all your saved category tags? This will revert those merchants back to the default rules/ML.')) return;
        clearUserTags();
        userTags = {};
        // Re-categorize all existing transactions from scratch (user overrides gone).
        for (const f of state.files) {
            for (const t of f.transactions) {
                t.category = categorizeWithUserTags(t.description, null);
                t.userTagged = false;
            }
        }
        render();
    }

    // Delegated change handler for the tag-select dropdowns in the uncategorized list.
    const uncatList = document.getElementById('uncategorized-list');
    if (uncatList) {
        uncatList.addEventListener('change', (e) => {
            const sel = e.target;
            if (!sel || !sel.classList || !sel.classList.contains('tag-select')) return;
            const merchant = sel.dataset.merchant;
            const category = sel.value;
            if (!merchant || !category) return;
            applyUserTag(merchant, category);
        });
    }

    // Clear-all button (inside the tag-summary block which re-renders).
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'tag-clear-btn') applyClearUserTags();
    });

    // --- CSV export ---

    function csvEscape(v) {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function buildExportCsv() {
        const rows = mergedTransactions();
        const header = [
            'Date', 'Description', 'NormalizedMerchant', 'Amount',
            'Category', 'UserTagged', 'AiClassified', 'AiScore',
            'SourceFile', 'SourceBank'
        ];
        const lines = [header.join(',')];
        for (const t of rows) {
            lines.push([
                t.date,
                t.description,
                normalizeMerchantName(t.description),
                t.amount.toFixed(2),
                t.category || 'Uncategorized',
                t.userTagged ? 'yes' : '',
                t.aiClassified ? 'yes' : '',
                t.aiScore !== undefined ? t.aiScore.toFixed(3) : '',
                t.sourceFile || '',
                t.sourceBank || ''
            ].map(csvEscape).join(','));
        }
        return lines.join('\n') + '\n';
    }

    function triggerCsvDownload() {
        if (state.files.length === 0) return;
        const csv = buildExportCsv();
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `spend-lens_export_${ts}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Free the Blob URL after the browser has had a chance to use it.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.addEventListener('click', triggerCsvDownload);

    // --- Wire up events ---

    csvInput.addEventListener('change', (e) => ingestFileList(e.target.files));

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        ingestFileList(e.dataTransfer.files);
    });

    // Chip remove — delegated to the container since chips are re-rendered.
    fileChips.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-remove');
        if (!btn) return;
        const id = parseInt(btn.dataset.id, 10);
        removeFile(id);
    });

    resetBtn.addEventListener('click', clearAll);
})();
