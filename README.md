# Opptra Discount Engine

A customer-facing cart pricing engine: final price per item, a plain-language reason for every price, a cart-level offer, natural-language rule input (Claude) and PDF cart upload.

**Live demo:** _LIVE_URL_ — click **Load sample data** to see the expected results instantly.

---

## Run locally (3 steps)

```bash
npm install
cp .env.example .env      # then paste your ANTHROPIC_API_KEY (only needed for plain-English rules)
npm run dev               # http://localhost:5173
```

`npm run dev` also serves the `/api/parse-rule` endpoint, so there is nothing else to start. Without a key, everything works except plain-English rules, which show a clear "not configured" message.

| Command | What it does |
|---|---|
| `npm test` | 76 unit tests: engine, validation, CSV, PDF parsing, LLM output handling |
| `npm run eval:rules` | Live check of the rule parser against Claude (11 phrasings, needs a key, costs cents) |
| `npm run samples` | Regenerates the sample PDFs in `sample-data/` |
| `npm run build` | Production build to `dist/` |

## Deploying (Vercel)

1. Import this repo in Vercel (framework preset: Vite, already set in `vercel.json`).
2. Add the environment variable `ANTHROPIC_API_KEY`.
3. Deploy. The static app is served from `dist/`, and `api/parse-rule.js` becomes a serverless function.

---

## What was built

| | What | Where to see it |
|---|---|---|
| **Foundation** | Base engine verified against the expected table: Rs.1,104 / 629 / 509 / 2,499 / 382 / 809, cart total Rs.5,932, final Rs.5,339 | *Load sample data* |
| **Task 1: Cart offer** | Cart-scope rules with a minimum cart value, evaluated after item offers. A separate offer row ("Cart offer: 10% off — Rs.593 saved") appears only when triggered. | Results panel |
| **Task 2: Plain-English rules** | Text goes to Claude (structured output), then validation, then a confirmation card, then the rule list. The engine re-runs immediately. | "Add a rule in plain English" |
| **Task 3: PDF cart** | Upload a PDF; the table is extracted, rows are validated and the cart is replaced. The engine re-runs automatically. | Cart upload accepts `.csv` and `.pdf`; sample PDFs are linked under it |

### Customer-facing output

Every item gets one offer label and the arithmetic behind it:

| Item | Shown to the customer |
|---|---|
| ITEM-01 | **Amazon India offer: 15% off — better than Natura Casa offer: Rs.150 off** · Rs.1,299 − Rs.195 = Rs.1,104 · `Max discount` |
| ITEM-02 | **Natura Casa offer: Rs.150 off + Flipkart offer: 10% off (stacked)** · Rs.849 − Rs.150 − Rs.70 = Rs.629 · `Stacked` |
| ITEM-04 | **No offers available — no current offers on LivSpace Pro or Noon** · `No offer` |
| Cart | **Cart offer: 10% off — Rs.593 saved** (RULE-04 · cart total Rs.5,932 ≥ Rs.4,000), then **Final Cart Total Rs.5,339**, then "You save Rs.1,255 on this order" |

The reasoning is generated from what the engine actually applied, so it stays accurate when a rule is added or removed or the cart is replaced. Results are derived state (`useMemo` over rules and cart), never stored, so they cannot go stale.

---

## Architecture

```
  rules.csv ─┐                                    ┌─ cart.csv
  plain English ─► Claude ─┐                      ├─ cart.pdf ─► pdf.js ─► column parser
                           ▼                      ▼
                 ┌──────────────────────────────────────────┐
                 │ engine/models.js  normalizeRule()        │  ← the ONLY way in:
                 │                   normalizeCartItem()    │    every source goes through
                 └──────────────────────────────────────────┘    the same validation
                                    ▼
                 ┌──────────────────────────────────────────┐
                 │ engine/discountEngine.js  calculateCart()│  ← pure, knows nothing
                 └──────────────────────────────────────────┘    about inputs
                                    ▼
                         CheckoutSummary (UI)
```

```
src/
  engine/
    discountEngine.js   pure calculator: item offers, stacking, cart offers
    models.js           DiscountRule / CartItem contract + validators (the input gate)
    copy.js             customer-facing wording (offer labels, readback)
  inputs/
    csv.js              CSV adapter (rules + cart)
    cartSources.js      registry of cart sources, picked by file extension
    pdf/index.js        PDF adapter: pdf.js text extraction → rows → validation
    pdf/cartTable.js    pure table reconstruction from positioned text
    naturalLanguage.js  calls /api/parse-rule, validates the LLM output, adds warnings
  components/           FileUploader, NaturalLanguageRule, CheckoutSummary, DataTable, …
  App.jsx               session state + wiring
server/parseRule.js     Claude call (structured outputs), shared by Vercel and the Vite dev server
api/parse-rule.js       Vercel function (thin HTTP wrapper)
scripts/                sample PDF builder, live parser eval
tests/                  vitest suites
```

**Adding a third input mode without touching the calculator.** A new cart format is one entry in `src/inputs/cartSources.js`:

```js
{ id: 'xlsx', label: 'Excel', extensions: ['.xlsx'], read: async (file) => parseCartXlsx(await file.arrayBuffer()) }
```

`parseCartXlsx` maps its rows to raw fields and calls `normalizeCartItem()`. The upload area, error reporting, cart replacement and re-run all work unchanged. Nothing in `engine/` changes: the inputs adapt to the engine, not the other way round. Task 1 is the only change to the engine itself, as the brief asks.

---

## Decisions and trade-offs

### Engine
- **Exactly at the threshold qualifies; one rupee below does not.** The condition is `cart total ≥ min_cart_value`, checked against the sum of final item prices, not base prices (tested at Rs.4,000 and Rs.3,999). Below the threshold no cart offer row is shown. Instead a separate nudge appears: "Add Rs.68 more to unlock Cart offer: 10% off". It only shows when reaching the next threshold would actually save the customer more than they save now.
- **Flat discounts are capped at the price.** In the base code a Rs.100 offer on an Rs.80 item produced −Rs.20. It now produces Rs.0.
- **Ties are deterministic**: equal savings go to the rule listed first.
- **Several stackable rules**: percentage stackables are applied before flat ones. Both orders are "correct", but percentage-first always leaves the customer the lower price, which matches "always give the biggest saving". The winning non-stackable rule still goes first, as the brief specifies (ITEM-02 = Rs.629).
- **Cart rules go through the same selection logic as item rules.** If several qualify, the best non-stackable one wins and stackable ones add on top. Flat cart rules work too.
- **Rounding**: each discount is rounded to whole rupees when applied. That is what makes ITEM-01 Rs.1,104 (Rs.194.85 → Rs.195), as in the brief.

### Validation (one gate for every source)
- The base CSV parser read `stackable: "maybe"` as `false` and `"12abc"` as `12` (via `parseFloat`). Both are now errors. Money parsing accepts `1299`, `1,299`, `Rs.1,299`, `₹1,299` and `Rs 1,299.00`, and nothing else.
- **A brand/platform rule with a cart condition** ("Rs.100 off Flipkart if the cart is over Rs.2,000") is **rejected, not simplified**. Dropping the condition silently would give discounts the merchant never offered.
- An import that yields zero valid rows **never wipes out** the current rules or cart.

### Plain-English rules (Task 2)
- **The LLM output is untrusted input.** Claude returns a schema-constrained object (structured outputs). The browser then runs it through the same `normalizeRule()` as a CSV row, so a 150% discount or a brand rule with no brand is shown as "failed validation, nothing added", with the reason.
- **Three non-happy outcomes are first-class, not crashes**: `needs_clarification` ("Give a discount for big orders" asks for the amount and threshold), `unsupported` (buy-X-get-Y, date-based or capped offers), and transport errors (missing key, timeout, rate limit, refusal), each with a message and a retry.
- **The confirmation step shows what the engine will do, not what the LLM said**:
  - the parsed fields;
  - a readback generated deterministically from those fields ("20% off every Natura Casa item. Stacks on top of the best non-stackable offer.");
  - the model's assumptions ("Stackable not mentioned, so set to No");
  - a dry run on the current cart ("Cushion Cover: Rs.1,104 → Rs.883 · Final cart total: Rs.5,339 → Rs.5,026").
- **Hallucination guard**: if a number in the parsed rule (the value or the threshold) does not appear in the user's text, the card warns about it. It also warns when no cart item matches the brand or platform, or when the rule duplicates an active one.
- **"more than Rs.5,000"** is mapped to the engine's single semantic (≥ Rs.5,000). The model records this as an assumption, so the user sees it before confirming.
- Known brands and platforms from the cart and rules are sent with the request, so "natura kasa" becomes "Natura Casa", and the model notes that it did this.

### PDF upload (Task 3)
- **Deterministic parsing, no LLM on prices.** Columns are found from the x-position of each header word, and every text segment is placed by position. This handles:
  - multi-word cells ("Natura Casa", "Amazon India");
  - right-aligned prices;
  - plain-text monospace printouts (columns separated by runs of spaces);
  - tables split across pages with the header repeated;
  - "Total: …" footer lines (ignored, with a note).
- **A malformed row is skipped and reported individually.** For example: `Row 2 ("Bed Sheet Set | Natura Casa | Flipkart"): missing base price — skipped`. The valid rows still load, with a warning to check the cart before relying on the total. A partial cart understates the total, so the warning is deliberately prominent rather than silent.
- Clear messages for a scanned PDF with no text layer, a password-protected file, a non-PDF file, a missing header and a header with no rows.
- pdf.js loads lazily (about 120 KB gzipped) only when a PDF is uploaded.

### Why there is a (tiny) server
The brief allows everything client-side. But an Anthropic API key in a static bundle is readable by anyone who opens DevTools. So the one LLM call goes through a serverless function (`api/parse-rule.js`), with input-length limits and a 25-second timeout. The same handler runs inside `npm run dev`, so local setup stays at three steps. PDF parsing stays in the browser.

---

## Where I'd push back on the brief

1. **Evaluating item offers before cart offers can make the customer pay more.** Take a Rs.4,100 item with a Rs.150 brand offer, a Rs.100 platform offer, and 10% off carts of Rs.4,000+.
   - As specified, the larger item saving wins. The cart lands at Rs.3,950, misses the threshold, and the customer pays **Rs.3,950**.
   - Taking the smaller item offer keeps the cart at Rs.4,000, unlocks 10%, and the customer pays **Rs.3,600**.

   That contradicts "always apply the rule that gives the customer the biggest saving". I implemented the brief as written (there's a test documenting this case). The fix I'd propose: when the greedy subtotal falls within reach of a cart threshold, also evaluate the item-offer combination that keeps it above the threshold, and pick the lower final total. The search is small because only items with competing offers matter.
2. **Confirmation step**: I agree it is needed, since the output changes prices customers see. Its value comes from the impact preview, though, not from echoing fields back. Next step: make the parsed fields editable in the card, so a near-miss ("Flipkrt") is fixed in one click instead of by re-prompting.
3. **PDF format assumption**: positional parsing is the right default for money, because it is predictable and never invents a price. For messy real-world invoices I'd add an LLM-assisted extraction **fallback** whose rows always land in a review table before replacing the cart, plus OCR for scans. I would not let either touch prices without that review step.

## Known limitations
- PDF cells that wrap onto two lines, or columns separated by a single space in a plain-text printout, can't be split reliably. They are reported as malformed rows rather than guessed.
- The public `/api/parse-rule` endpoint has input-size limits but no per-IP rate limiting (serverless instances share no memory). In production I'd put it behind the platform's rate limiting or auth.
- State is in memory for the session, as the brief asks.

## File formats

**rules.csv**: `rule_id, scope, applies_to, type, value, stackable, min_cart_value`

| Column | Values |
|---|---|
| scope | `brand` \| `platform` \| `cart` |
| applies_to | brand or platform name; empty for `cart` |
| type | `percentage` \| `flat` |
| value | percentage (0–100) or rupees |
| stackable | `true` / `false` (also `yes` / `no`) |
| min_cart_value | rupees, `cart` rules only (column optional, so the original 6-column file still loads) |

**cart.csv**: `item_id, product, brand, platform, base_price`

**cart.pdf**: a table with the header `Product | Brand | Platform | Base Price` (prices like `Rs.1,299`). Item ids are assigned in order. See `sample-data/*.pdf`:

| File | Shows |
|---|---|
| `cart.pdf` | Same cart as `cart.csv` |
| `cart-below-threshold.pdf` | Ceramic Vase removed, total Rs.3,433: no cart offer row, "Add Rs.567 more" |
| `cart-with-bad-rows.pdf` | 3 malformed rows, each reported; 3 valid rows load |
| `cart-plain-text.pdf` | Monospace printout layout |
