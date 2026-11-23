import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument } from 'pdf-lib'
import { parseCartPdf } from '../src/inputs/pdf/index.js'
import { buildSegments, findHeader, itemsToLines } from '../src/inputs/pdf/cartTable.js'
import { buildCartPdf, SAMPLE_ROWS } from '../scripts/samplePdfs.js'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csv.js'
import { calculateCart } from '../src/engine/discountEngine.js'

const parse = (bytes) => parseCartPdf(bytes, { pdfjs })
const sample = (name) => readFileSync(new URL(`../sample-data/${name}`, import.meta.url))
const csvCart = parseCartCSV(readFileSync(new URL('../sample-data/cart.csv', import.meta.url), 'utf8')).data
const rules = parseRulesCSV(readFileSync(new URL('../sample-data/rules.csv', import.meta.url), 'utf8')).data

describe('sample cart PDFs', () => {
  it('cart.pdf produces exactly the same cart as cart.csv', async () => {
    const out = await parse(sample('cart.pdf'))
    expect(out.errors).toEqual([])
    expect(out.title).toBe('Order #OP-9921 | Date: 15 Jan 2025')
    expect(out.data).toEqual(csvCart)
  })

  it('reads a plain-text (monospace, single string per row) layout', async () => {
    const out = await parse(sample('cart-plain-text.pdf'))
    expect(out.errors).toEqual([])
    expect(out.data).toEqual(csvCart)
  })

  it('handles right-aligned prices and ignores the total line', async () => {
    const out = await parse(sample('cart-below-threshold.pdf'))
    expect(out.errors).toEqual([])
    expect(out.notes).toEqual(['Ignored summary line "Total: Rs.3,433"'])
    expect(out.data.map((i) => i.basePrice)).toEqual([1299, 849, 599, 449, 899])
    // and the engine re-runs: 3,433 is under the Rs.4,000 cart threshold
    const result = calculateCart(out.data, rules)
    expect(result.subtotal).toBe(3433)
    expect(result.cartOffer).toBeNull()
    expect(result.nextCartOffer.shortfall).toBe(567)
  })

  it('skips malformed rows, says why, and keeps the valid ones', async () => {
    const out = await parse(sample('cart-with-bad-rows.pdf'))
    expect(out.data.map((i) => [i.itemId, i.product])).toEqual([
      ['ITEM-01', 'Cushion Cover'],
      ['ITEM-02', 'Cutting Board'],
      ['ITEM-03', 'Desk Organiser'],
    ])
    expect(out.errors).toEqual([
      'Row 2 ("Bed Sheet Set | Natura Casa | Flipkart"): missing base price — skipped',
      'Row 3 ("Wall Shelf | Amazon India | Rs.599"): missing brand — skipped',
      'Row 4 ("Ceramic Vase | LivSpace Pro | Noon | On request"): base price must be a positive amount (got "On request") — skipped',
    ])
  })
})

describe('PDF edge cases', () => {
  it('reads a table split across pages with the header repeated', async () => {
    const rows = [...SAMPLE_ROWS, ...SAMPLE_ROWS]
    const out = await parse(await buildCartPdf({ rows, rowsPerPage: 5 }))
    expect(out.errors).toEqual([])
    expect(out.data).toHaveLength(12)
    expect(out.data[11]).toMatchObject({ itemId: 'ITEM-12', product: 'Desk Organiser' })
  })

  it('explains a PDF without the expected header', async () => {
    const out = await parse(await buildCartPdf({ rows: SAMPLE_ROWS, noHeader: true }))
    expect(out.data).toEqual([])
    expect(out.errors[0]).toMatch(/Product, Brand, Platform and Base Price/)
  })

  it('explains a PDF with no text layer (e.g. a scan)', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const out = await parse(await doc.save())
    expect(out.errors[0]).toMatch(/no selectable text/)
  })

  it('does not crash on a file that is not a PDF', async () => {
    const out = await parse(new TextEncoder().encode('item_id,product\nI1,Vase'))
    expect(out.data).toEqual([])
    expect(out.errors[0]).toMatch(/not a valid PDF|Could not read/)
  })

  it('reports a header with no rows', async () => {
    const out = await parse(await buildCartPdf({ rows: [] }))
    expect(out.errors[0]).toMatch(/no item rows/)
  })
})

describe('table reconstruction', () => {
  const item = (str, x, y = 700, size = 10, width = str.length * 5) => ({ str, x, y, width, size })

  it('joins words of one cell and splits columns on wide gaps', () => {
    const segs = buildSegments([item('Natura', 190, 700, 10, 30), item('Casa', 223, 700, 10, 20), item('Flipkart', 320)])
    expect(segs.map((s) => s.text)).toEqual(['Natura Casa', 'Flipkart'])
  })

  it('splits a single string on runs of 2+ spaces', () => {
    const segs = buildSegments([item('Cushion Cover    Natura Casa    Rs.1,299', 50)])
    expect(segs.map((s) => s.text)).toEqual(['Cushion Cover', 'Natura Casa', 'Rs.1,299'])
  })

  it('finds header anchors even when header words arrive as one string', () => {
    const [line] = itemsToLines([item('Product   Brand   Platform   Base Price', 50)])
    const anchors = findHeader(line)
    expect(anchors).toHaveLength(4)
    expect(anchors[0]).toBe(50)
  })
})
