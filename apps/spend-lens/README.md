# spend-lens

**Private personal finance analyzer. Your bank CSV stays in your browser tab.**

Drop a transaction export from Chase, Bank of America, Amex, or Wells Fargo. See where your money goes. No account, no login, no upload — every byte of logic runs in your browser.

## Why this is different

Every budgeting app (Mint, Copilot, YNAB, Monarch) sends your transaction data to their servers. That data is valuable, and you're usually paying with it.

**spend-lens can't do that, because there is no server.** The entire app is static HTML + JavaScript. Your CSV is read by the browser's File API and processed in-memory inside the tab. Nothing leaves your device.

### Verify the privacy claim yourself

1. Open DevTools → Network tab before uploading.
2. Drop a sample CSV.
3. Confirm: zero requests contain your file data. The only network traffic is loading the app itself and (if you opt into the AI classifier) the model weights from HuggingFace.
4. Close the tab. Your transaction data is gone.

This isn't a trust claim. It's an architectural property.

### What actually persists (and where)

| Data | Where | Who can see |
|---|---|---|
| Your CSV content (amounts, dates, descriptions) | Browser tab memory only | Only you, only while the tab is open |
| ML model weights (~22MB, if you use the AI button) | Browser HTTP cache | Only you |
| Your category tags (e.g. "PENNYMAC CASH → Mortgage") | `localStorage` on **your** device | Only you. Clearable via the app's "Clear all" button or your browser's data-clear setting |

Only the tiny `merchant → category` metadata persists, and only on your device. The transaction stream itself is always ephemeral.

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

## What it does

### Ingest
- Drop one or many CSVs — Chase checking, Chase credit card, BofA, Amex, Wells Fargo, generic
- Auto-detect bank format from headers
- **Cross-file dedup** — dropping overlapping statements (e.g. April + April-May combined) detects and skips duplicate rows; fully-duplicate file is rejected with a clear message

### Categorization (two-layer)
- **Layer 1 — rule-based** (`categories.js`): ~200 US merchants mapped to 11 categories via keyword rules. Deterministic, fast, no ML required.
- **Layer 2 — ML embedding fallback** (`classifier.js`): opt-in button loads [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) via [Transformers.js](https://huggingface.co/docs/transformers.js). Embeds each uncategorized merchant, compares to category centroids built from exemplar phrases, assigns the best match above a cosine-similarity threshold. Runs entirely in your browser. Weights fetched from HuggingFace once (~22MB), cached forever.
- **User-taught overrides** — click any uncategorized merchant, pick a category from the dropdown. Saved to your device's `localStorage` and applied to every future session. When the AI model is loaded, your correction also becomes an **exemplar** — the category's centroid vector updates, and similar unknown merchants you haven't tagged yet start classifying correctly. That's few-shot learning happening on-device.

### Analysis
- **Top 3 savings opportunities** (synthesizer card): ranks subscriptions, fees, dining frequency, streaming-stack overlap by annualized impact
- **Spending over time** (line chart): auto weekly / monthly buckets, spend + income
- **Month-over-month comparison**: when data spans ≥2 months, shows per-category delta + % change, flags new / stopped categories, ranked by biggest movers
- **Category pie + breakdown** with top-8 + Other rollup
- **Subscription creep detector**: median-interval + amount-variance detection of weekly / biweekly / monthly / quarterly / annual recurring charges, with annualized totals
- **Top uncategorized merchants**: normalized-name rollup of what rules and ML missed — so you can either tag them or add keywords to `categories.js`

### V2 (maybe)
- Forecast: "at this pace you'll end the month $X over budget in Dining"
- Bill predictor + cash-flow calendar
- Category drill-down (click pie slice → see transactions)
- Export insights as PDF (client-side, via [jsPDF](https://github.com/parallax/jsPDF))
- Optional IndexedDB for cross-session memory (opt-in; same privacy as localStorage — your device, not mine)

## Sample data

`sample_transactions.csv` is a synthetic Chase-format file with 25 rows of fake transactions. Use it to try the app without exposing your real statement.

## Architecture

Just three files:

```
spend-lens/
├── index.html            ← UI, loads deps from CDN
├── style.css             ← dark theme (matches labs.kargin-utkin.com)
├── script.js             ← state, rendering, savings analysis
├── categories.js         ← rule-based categorizer (forkable merchant list)
├── classifier.js         ← Transformers.js embedding fallback (in-browser ML)
├── sample_transactions.csv
└── README.md
```

### Dependencies (all loaded from CDN, no build step)

- [PapaParse](https://www.papaparse.com/) — CSV parsing
- [Chart.js](https://www.chartjs.org/) — pie + line charts
- [Transformers.js](https://huggingface.co/docs/transformers.js) — in-browser sentence-transformers (loaded lazily, only if you click the AI button)

No build system. No frameworks. Open the file, read the code.

## Related

- Part of [labs.kargin-utkin.com](https://labs.kargin-utkin.com) — hands-on ML experiments.
- Same privacy-architecture pattern (compute where the data lives) is how [InnovaTek](https://innovateksolutionsinc.com) deploys AI inside regulated companies that can't cloud-ship their data.

## License

MIT — see root [LICENSE](../../LICENSE). Fork it, run it, make it yours.
