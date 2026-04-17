# spend-lens

**Private personal finance analyzer. Your bank CSV stays in your browser tab.**

Drop a transaction export from Chase, Bank of America, Amex, or Wells Fargo. See where your money goes. No account, no login, no upload — every byte of logic runs in your browser.

## Why this is different

Every budgeting app (Mint, Copilot, YNAB, Monarch) sends your transaction data to their servers. That data is valuable, and you're usually paying with it.

**spend-lens can't do that, because there is no server.** The entire app is static HTML + JavaScript. Your CSV is read by the browser's File API and processed in-memory inside the tab. Nothing leaves your device.

### Verify the privacy claim yourself

1. Open DevTools → Network tab before uploading.
2. Drop a sample CSV.
3. Confirm: zero requests contain your file data. The only network traffic is loading the app itself.
4. Close the tab. Your data is gone. Nothing was saved.

This isn't a trust claim. It's an architectural property.

## Run it locally (offline, air-gapped if you want)

```bash
git clone https://github.com/alexnews/labs.git
cd labs/apps/spend-lens
# open index.html directly in your browser, or:
python3 -m http.server 8000
# visit http://localhost:8000
```

That's it. No build step, no dependencies to install, no API keys. The only external library is [PapaParse](https://www.papaparse.com/) loaded from a CDN — or fetch it locally and swap the `<script src>` for a relative path if you want full offline.

## Supported formats

Auto-detects column layouts from:

- **Chase** — Transaction Date, Post Date, Description, Category, Type, Amount, Memo
- **Bank of America** — Posted Date, Payee, Amount, ...
- **American Express** — Date, Description, Amount, ...
- **Wells Fargo** — generic handling via column-name matching

If your bank uses different headers, spend-lens falls back to heuristic matching on Date + Description + Amount. If it misdetects, open an issue with a sanitized sample.

## What it does (and when)

### Day 1 (scaffold)
- Drop CSV → read via File API
- Auto-detect bank format from headers
- Summary cards: transaction count, total spend, total income, net
- Preview of first 10 transactions

### Week 1 roadmap
- Rule-based merchant categorizer (top ~200 merchants)
- Embedding-based categorizer for unknowns ([Transformers.js](https://huggingface.co/docs/transformers.js), runs locally)
- Charts: spend-by-category, monthly trend, top merchants
- **Savings insights** — the actual value:
  - Subscription creep detector (recurring charges, duplicate streaming)
  - Bank-fee finder
  - Lifestyle-inflation trend (same-merchant spend over time)
  - Weekend vs weekday splurge breakdown
  - Top 3 ranked savings opportunities

### V2 (maybe)
- Forecast: "at this pace you'll end the month $X over budget in Dining"
- Bill predictor + cash-flow calendar
- Month-over-month comparison
- Export insights as PDF (client-side, via [jsPDF](https://github.com/parallax/jsPDF))

## Sample data

`sample_transactions.csv` is a synthetic Chase-format file with 25 rows of fake transactions. Use it to try the app without exposing your real statement.

## Architecture

Just three files:

```
spend-lens/
├── index.html            ← UI, loads papaparse from CDN
├── style.css             ← dark theme (matches labs.kargin-utkin.com)
├── script.js             ← all logic (<300 lines)
├── sample_transactions.csv
└── README.md
```

No build system. No frameworks. Open the file, read the code.

## Related

- Part of [labs.kargin-utkin.com](https://labs.kargin-utkin.com) — hands-on ML experiments.
- Same privacy-architecture pattern (compute where the data lives) is how [InnovaTek](https://innovateksolutionsinc.com) deploys AI inside regulated companies that can't cloud-ship their data.

## License

MIT — see root [LICENSE](../../LICENSE). Fork it, run it, make it yours.
