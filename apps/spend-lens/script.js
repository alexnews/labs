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
            return {
                date: dateStr,
                dateObj: parseDate(dateStr),
                description: String(row[descCol] || '').trim(),
                amount: parseAmount(row, amountCol)
            };
        }).filter(t => t.date && t.description);

        if (transactions.length === 0) {
            return { ok: false, error: `${fileName}: no valid transactions found.` };
        }

        return {
            ok: true,
            file: { id: state.nextId++, name: fileName, bank, transactions }
        };
    }

    // --- State mutations ---

    function addFile(parsed) {
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
        fileChips.innerHTML = state.files.map(f => `
            <div class="file-chip" data-id="${f.id}">
                <span class="chip-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
                <span class="chip-meta">${escapeHtml(f.bank)} · ${f.transactions.length}</span>
                <button class="chip-remove" data-id="${f.id}" aria-label="Remove file">×</button>
            </div>
        `).join('');
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

    function renderPreview(txns) {
        const top = txns.slice(0, 10);
        const multiFile = state.files.length > 1;
        const tableRows = top.map(t => {
            const cls = t.amount < 0 ? 'neg' : 'pos';
            const source = multiFile ? `<td class="source">${escapeHtml(t.sourceBank)}</td>` : '';
            return `<tr>
                <td>${escapeHtml(t.date)}</td>
                <td>${escapeHtml(t.description)}</td>
                ${source}
                <td class="amount ${cls}">${formatMoney(t.amount)}</td>
            </tr>`;
        }).join('');

        const sourceHeader = multiFile ? '<th>Source</th>' : '';
        previewTable.innerHTML = `
            <table>
                <thead><tr><th>Date</th><th>Description</th>${sourceHeader}<th>Amount</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        `;
    }

    function render() {
        clearError();
        if (state.files.length === 0) {
            // Back to initial state.
            resultsSection.classList.add('hidden');
            uploadSection.classList.remove('hidden');
            uploadPrompt.textContent = 'Drop your CSV here, or click to select';
            if (sampleLink) sampleLink.style.display = '';
            return;
        }

        const txns = mergedTransactions();
        const n = state.files.length;
        resultsTitle.textContent = n === 1
            ? `${state.files[0].name} · ${state.files[0].bank}`
            : `Combined view · ${n} files · ${txns.length.toLocaleString()} transactions`;

        renderChips();
        renderSummary(txns);
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
