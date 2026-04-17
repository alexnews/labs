// spend-lens — client-side CSV analyzer.
// Every line of logic here runs in the browser. The server never sees your file.

(function () {
    'use strict';

    const uploadZone = document.getElementById('upload-zone');
    const csvInput = document.getElementById('csv-input');
    const uploadSection = document.getElementById('upload-section');
    const resultsSection = document.getElementById('results');
    const resultsTitle = document.getElementById('results-title');
    const summaryCards = document.getElementById('summary-cards');
    const previewTable = document.getElementById('preview-table');
    const resetBtn = document.getElementById('reset-btn');

    // Column name variants across banks.
    const COLUMN_ALIASES = {
        date: ['Transaction Date', 'Trans. Date', 'Date', 'Posted Date', 'Post Date'],
        description: ['Description', 'Payee', 'Merchant', 'Details'],
        amount: ['Amount', 'Debit', 'Credit'],
        category: ['Category', 'Type']
    };

    function findColumn(headers, candidates) {
        const normalized = headers.map(h => h.trim().toLowerCase());
        for (const candidate of candidates) {
            const idx = normalized.indexOf(candidate.toLowerCase());
            if (idx !== -1) return headers[idx];
        }
        return null;
    }

    function detectBankFormat(headers) {
        const lower = headers.map(h => h.toLowerCase());
        if (lower.includes('post date') && lower.includes('category')) return 'Chase';
        if (lower.includes('posted date') || lower.includes('payee')) return 'Bank of America';
        if (lower.includes('trans. date') || lower.includes('transaction date')) return 'Amex';
        return 'Generic CSV';
    }

    function formatMoney(n) {
        const abs = Math.abs(n);
        const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return (n < 0 ? '-' : '') + '$' + formatted;
    }

    function parseAmount(row, amountCol) {
        // Some banks split into Debit / Credit columns.
        if (amountCol) {
            const raw = String(row[amountCol] || '').replace(/[$,]/g, '').trim();
            const num = parseFloat(raw);
            return isNaN(num) ? 0 : num;
        }
        const debit = parseFloat(String(row['Debit'] || '').replace(/[$,]/g, '')) || 0;
        const credit = parseFloat(String(row['Credit'] || '').replace(/[$,]/g, '')) || 0;
        return credit - debit;
    }

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

    function showResults(fileName, rows, headers) {
        const dateCol = findColumn(headers, COLUMN_ALIASES.date);
        const descCol = findColumn(headers, COLUMN_ALIASES.description);
        const amountCol = findColumn(headers, COLUMN_ALIASES.amount);

        if (!dateCol || !descCol) {
            showError(`Couldn't find date + description columns in this CSV. Detected headers: ${headers.join(', ')}`);
            return;
        }

        const format = detectBankFormat(headers);
        const parsed = rows.map(row => ({
            date: String(row[dateCol] || '').trim(),
            description: String(row[descCol] || '').trim(),
            amount: parseAmount(row, amountCol),
            raw: row
        })).filter(r => r.date && r.description);

        if (parsed.length === 0) {
            showError('No valid transactions found in this CSV.');
            return;
        }

        const debits = parsed.filter(r => r.amount < 0);
        const credits = parsed.filter(r => r.amount > 0);
        const totalSpend = debits.reduce((s, r) => s + r.amount, 0);
        const totalIncome = credits.reduce((s, r) => s + r.amount, 0);

        const dates = parsed.map(r => r.date).filter(Boolean);
        const dateRange = dates.length > 0 ? `${dates[dates.length - 1]} → ${dates[0]}` : '—';

        resultsTitle.textContent = `${fileName} · detected as ${format}`;

        summaryCards.innerHTML = `
            <div class="summary-card">
                <div class="label-sm">Transactions</div>
                <div class="value">${parsed.length.toLocaleString()}</div>
                <div class="sub">${dateRange}</div>
            </div>
            <div class="summary-card">
                <div class="label-sm">Total spend</div>
                <div class="value neg">${formatMoney(totalSpend)}</div>
                <div class="sub">${debits.length} debits</div>
            </div>
            <div class="summary-card">
                <div class="label-sm">Total income</div>
                <div class="value pos">${formatMoney(totalIncome)}</div>
                <div class="sub">${credits.length} credits</div>
            </div>
            <div class="summary-card">
                <div class="label-sm">Net</div>
                <div class="value ${totalSpend + totalIncome < 0 ? 'neg' : 'pos'}">${formatMoney(totalSpend + totalIncome)}</div>
                <div class="sub">income − spend</div>
            </div>
        `;

        const tableRows = parsed.slice(0, 10).map(r => {
            const cls = r.amount < 0 ? 'neg' : 'pos';
            return `<tr>
                <td>${escapeHtml(r.date)}</td>
                <td>${escapeHtml(r.description)}</td>
                <td class="amount ${cls}">${formatMoney(r.amount)}</td>
            </tr>`;
        }).join('');

        previewTable.innerHTML = `
            <table>
                <thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        `;

        uploadSection.classList.add('hidden');
        resultsSection.classList.remove('hidden');
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function handleFile(file) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showError('Please select a .csv file.');
            return;
        }
        clearError();

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (result) => {
                if (result.errors && result.errors.length > 0) {
                    // Soft-fail on row-level warnings; only block on fatal parse errors.
                    const fatal = result.errors.filter(e => e.type === 'Delimiter' || e.type === 'Header');
                    if (fatal.length > 0) {
                        showError(`CSV parse error: ${fatal[0].message}`);
                        return;
                    }
                }
                if (!result.data || result.data.length === 0) {
                    showError('This CSV appears to be empty.');
                    return;
                }
                showResults(file.name, result.data, result.meta.fields || Object.keys(result.data[0]));
            },
            error: (err) => {
                showError('Failed to parse CSV: ' + err.message);
            }
        });
    }

    csvInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        handleFile(e.dataTransfer.files[0]);
    });

    resetBtn.addEventListener('click', () => {
        csvInput.value = '';
        summaryCards.innerHTML = '';
        previewTable.innerHTML = '';
        resultsSection.classList.add('hidden');
        uploadSection.classList.remove('hidden');
        clearError();
    });
})();
