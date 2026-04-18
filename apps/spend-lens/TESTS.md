# spend-lens — manual test checklist

Walk-through test plan for the lab. Run these before shipping a change, and keep this file updated as features are added.

All tests are manual (no test framework). Checkboxes are where a human verifies behavior against expectation.

---

## 1. CSV ingest

- [ ] Drop the included `sample_transactions.csv` → results appear; 25 rows; detected as Chase (credit card)
- [ ] Drop a real Chase checking CSV → detected as Chase (checking); no errors in DevTools console
- [ ] Drop a Chase credit card CSV → detected as Chase (credit card)
- [ ] Drop a Bank of America CSV → detected and parsed
- [ ] Drop an Amex CSV → detected and parsed
- [ ] Drop a Wells Fargo CSV → falls back to Generic but parses
- [ ] Drop a non-CSV file (e.g. `.txt` or `.pdf`) → friendly error, nothing added
- [ ] Drop an empty CSV (0 rows) → "empty CSV" error
- [ ] Drop a CSV missing required columns → "couldn't find date/description" error with header list
- [ ] Start/end date and day count shown correctly in the period line under the title

## 2. Multi-file merge

- [ ] Drop two different CSVs in sequence → both appear as chips above results
- [ ] Drop three files at once (select all in file picker) → all three appear
- [ ] Drag-and-drop multiple files at once → all appear
- [ ] Drop the same file twice → "all N transactions are duplicates — nothing added" message
- [ ] Drop partially-overlapping files → chip shows `+N dupes skipped`; totals do not double-count
- [ ] Same-day same-amount same-merchant within one file (two real $5 coffees) → both preserved, not deduped
- [ ] Remove a file via `×` → summary, charts, subscriptions, and MoM all recompute
- [ ] Click **Clear all** → returns to the upload view; file input reset

## 3. Summary cards + period

- [ ] Transaction count matches what the CSV contained (minus duplicates)
- [ ] Total spend = sum of all outflows (negative amounts)
- [ ] Total income = sum of all inflows (positive amounts)
- [ ] Net = income − spend, with correct sign and color
- [ ] Period shows earliest-to-latest date across all loaded files
- [ ] Day count in green matches the span

## 4. Trend chart (spend over time)

- [ ] Hidden when only 1 time bucket of data
- [ ] Shown when ≥2 buckets
- [ ] Auto-selects **weekly** when date range ≤ 60 days
- [ ] Auto-selects **monthly** when date range > 60 days
- [ ] Granularity label matches ("weekly" / "monthly")
- [ ] Income line (green) hidden when no income in data; visible otherwise
- [ ] Hovering a point shows tooltip with period + spend + income

## 5. Month-over-month

- [ ] Hidden when data spans < 2 calendar months
- [ ] Title reads `Month over month — <Prior> vs <Current>` with month names
- [ ] Total outflow line: prior → current, delta, % — red up-arrow if increased, green down-arrow if decreased
- [ ] Category rows ranked by absolute delta (biggest movers first)
- [ ] Categories with prior = 0 and current > 0 labeled **new**
- [ ] Categories with prior > 0 and current = 0 labeled **stopped**
- [ ] Capped at top 10 rows

## 6. Category pie + breakdown

- [ ] Pie colors match breakdown list swatches
- [ ] Top 8 categories shown separately, remainder rolled into **Other**
- [ ] Tooltip on hover shows `$amount (pct%)`
- [ ] Breakdown totals to 100%
- [ ] Hidden when there are no outflows

## 7. Recurring charges + simulator

- [ ] Section hidden when data span is too short to detect any cadence
- [ ] Detects monthly subscriptions (intervals 25–35 days)
- [ ] Detects biweekly (13–15), weekly (6–8), quarterly (85–95), annual (330–400)
- [ ] Amount-variance filter rejects merchants with unstable amounts (coffee, grocery)
- [ ] Per-row: cadence badge, category, charge count, last + next-expected dates, avg + annualized
- [ ] Header total: `$X/mo · $Y/yr` aggregates across all detected subs
- [ ] Check a row's cancel-checkbox → row gets line-through + dimmed
- [ ] Simulation bar appears above the list: `If you cancel N: Save $X/mo · $Y/yr / Keep M: $Z/mo`
- [ ] Check multiple rows → totals update live
- [ ] Uncheck a row → savings recompute; bar hides when zero cancelled
- [ ] Remove a file → cancelled names that no longer exist drop from simulation state

## 8. Top 3 savings opportunities

- [ ] Shown at top of results when ≥1 opportunity triggers
- [ ] Hidden when none
- [ ] Ranked by annualized impact (biggest first)
- [ ] Each card: title, detail, action, annualized amount
- [ ] Subscriptions opportunity triggers when monthly recurring ≥ $10
- [ ] Fees opportunity triggers when period fees ≥ $5
- [ ] Food & Drink opportunity triggers at ≥5 charges AND ≥$100
- [ ] Streaming-stack opportunity triggers at 3+ Entertainment monthly subs

## 9. Preview table

- [ ] Shows 10 most-recent transactions across all files
- [ ] Date / Description / Category / (Source if multi-file) / Amount columns
- [ ] Category swatch color matches pie / breakdown
- [ ] Uncategorized rows have a distinct warning color on the label
- [ ] Amount signs correct: negative red for outflows, green for inflows

## 10. Top uncategorized merchants + tagging

- [ ] Shown when any outflow-side transactions remain Uncategorized
- [ ] Merchant names are normalized (e.g. `STARBUCKS STORE 12847` → `STARBUCKS STORE`)
- [ ] Count `N×` = number of transactions grouped under that normalized name
- [ ] Total amount is the sum of all grouped transactions
- [ ] Hidden when no outflows are uncategorized

### Tagging (Level 1 — exact match)
- [ ] Pick a category from the dropdown → **toast** appears (`Tagged "X" as Y · N transactions`)
- [ ] DevTools Console logs `[spend-lens] calling applyUserTag(...)` then `tagged ... N transaction(s) updated`
- [ ] Row disappears from the uncategorized list
- [ ] Matching transactions get the new category in preview + pie + MoM
- [ ] Refresh the page → tag persists (same browser / same device)

### Custom categories
- [ ] "+ New category…" is the last option in every Tag dropdown
- [ ] Picking it prompts for a name
- [ ] Empty name → skipped, nothing happens
- [ ] Name > 40 chars → alert, rejected
- [ ] Case-insensitive duplicate of existing category → reuses existing
- [ ] New category gets a hash-assigned color (consistent across reloads)
- [ ] Appears in every future dropdown
- [ ] Appears in pie, breakdown, MoM once any transaction uses it

## 11. AI classifier (Transformers.js)

- [ ] Button "Smart-categorize with AI" visible only when uncategorized section is shown
- [ ] First click: status updates through download stages (`Downloading model.onnx — 47%`)
- [ ] First click cost: ~22MB download; reflected in DevTools Network tab
- [ ] Second click (same session): instant; model already in memory
- [ ] Second click after page reload: fast (model pulled from browser HTTP cache, not re-downloaded)
- [ ] Final status: `N of M classified by the model · threshold ≥ 0.4`
- [ ] Uncategorized list shrinks by N
- [ ] Below-threshold merchants stay Uncategorized (no confident-wrong assignments)

### Level-2 centroid update
- [ ] After AI run, tag an uncategorized merchant manually
- [ ] Console logs the merchant embedding added to that category's exemplars
- [ ] Re-run AI → other similar-sounding merchants now fall into that category (centroid shifted)

## 12. Export / Import

### CSV export
- [ ] Click **Export CSV** (top right of results header)
- [ ] Downloads `spend-lens_export_YYYY-MM-DD.csv`
- [ ] Open in a spreadsheet: contains every merged transaction
- [ ] Columns: Date, Description, NormalizedMerchant, Amount, Category, UserTagged, AiClassified, AiScore, SourceFile, SourceBank
- [ ] No data beyond what was loaded; no transmit to any server
- [ ] Import that same CSV back into spend-lens — should parse (Generic format); dedupe would trigger against the original

### Tag rules export
- [ ] Click **Export** in tag-summary bar
- [ ] Downloads `spend-lens-tags_YYYY-MM-DD.json`
- [ ] File contents: `{version, exportedAt, userTags, userCategories}` only — no transactions, no amounts
- [ ] DevTools console logs the exported payload

### Tag rules import
- [ ] On a different browser / different device / incognito + fresh session
- [ ] Click **Import** in tag-summary → pick the JSON
- [ ] Console logs `importing: {...}`, per-category adds, and final `localStorage after import`
- [ ] `__spendLens.dump()` in console shows populated `userTags` and `userCategories`
- [ ] Re-upload the same CSV → previously-tagged merchants now auto-categorized via imported rules
- [ ] Custom categories from the import appear in every Tag dropdown

## 13. Clear all

- [ ] Click **Clear all** in tag-summary → confirmation prompt
- [ ] Confirm → userTags + userCategories wiped from localStorage
- [ ] All loaded transactions re-categorized from scratch (rules + ML)
- [ ] Tag-summary bar disappears

## 14. Privacy verification

- [ ] DevTools Network tab → clear log → drop a CSV
  - [ ] Zero requests contain the CSV content
  - [ ] Zero requests to any domain other than the page itself and (cached) CDNs
- [ ] Click **Smart-categorize with AI** on a fresh browser
  - [ ] Requests go to `huggingface.co` (model weights) — expected and labeled clearly
  - [ ] No request contains merchant names or amounts
- [ ] `localStorage` → inspect contents
  - [ ] Only keys `spendlens.userTags` and `spendlens.userCategories`
  - [ ] Values contain only merchant names and category labels — no amounts, dates, balances
- [ ] Close the tab, reopen → transaction data is gone (only tag metadata persists)

## 15. Cross-browser

- [ ] Chrome (latest) — all features work
- [ ] Firefox (latest) — all features work
- [ ] Safari (latest) — all features work
- [ ] Safari private window / Chrome incognito — app works but localStorage may not persist (expected browser behavior; note it in the UI or README)

## 16. Mobile (after deploy to labs.kargin-utkin.com/spend-lens/)

- [ ] Page loads without horizontal scroll on iPhone SE width (375px)
- [ ] Tap the upload zone → file picker opens
- [ ] Summary cards stack in 2 columns on narrow screens
- [ ] Pie chart and breakdown stack vertically
- [ ] Category breakdown values readable
- [ ] Recurring list checkbox easily tappable (not too small)
- [ ] Tag dropdown readable + operable
- [ ] Toast visible when triggered
- [ ] Trend chart labels legible
- [ ] MoM section rows don't wrap ugly

## 17. Edge cases and known limitations

- [ ] Very large CSV (10,000+ rows) → app doesn't freeze, but categorization may take a few seconds
- [ ] Dates in non-US formats (e.g. DD/MM/YYYY) → will misparse; document this; ask user to reformat
- [ ] Non-ASCII merchant names (accents, non-Latin) → should still categorize; verify
- [ ] Amount column formatted with parentheses `($10.00)` → currently not handled; treat as zero. Enhancement.

---

## Definition of "passes"

A test passes if the stated expected behavior happens without surprise, and DevTools console shows no uncaught exceptions.

Failures should be filed as GitHub issues with:
- Which section + checkbox
- Browser + OS
- Sanitized sample CSV (or at least the header row) if the failure is data-specific
- Console output and Network-tab screenshot if relevant
