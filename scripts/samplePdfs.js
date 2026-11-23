/**
 * Builds cart PDFs in the format described in the brief (title line, then a
 * Product / Brand / Platform / Base Price table). Used by
 * scripts/make-sample-pdfs.mjs to write the demo files in sample-data/, and by
 * the tests to create edge cases in memory.
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export const SAMPLE_ROWS = [
  ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'],
  ['Bed Sheet Set', 'Natura Casa', 'Flipkart', 'Rs.849'],
  ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'Rs.599'],
  ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'Rs.2,499'],
  ['Cutting Board', 'Nordic Basics', 'Amazon India', 'Rs.449'],
  ['Desk Organiser', 'Nordic Basics', 'Flipkart', 'Rs.899'],
]

const HEADER = ['Product', 'Brand', 'Platform', 'Base Price']
const COLUMN_X = [50, 190, 320, 440]

/**
 * @param {object} opts
 * @param {string[][]} opts.rows            table rows (strings; '' for an empty cell)
 * @param {string}    [opts.title]          line printed above the table
 * @param {string[]}  [opts.footer]         lines printed after the table
 * @param {'cells'|'monospace'} [opts.layout]  'cells' draws each cell separately (typical invoice PDF);
 *                                          'monospace' prints each row as one padded Courier string
 * @param {boolean}   [opts.rightAlignPrices]
 * @param {number}    [opts.rowsPerPage]    split the table across pages, repeating the header
 * @param {boolean}   [opts.noHeader]
 */
export async function buildCartPdf({
  rows,
  title = 'Order #OP-9921  |  Date: 15 Jan 2025',
  footer = [],
  layout = 'cells',
  rightAlignPrices = false,
  rowsPerPage = 40,
  noHeader = false,
}) {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(layout === 'monospace' ? StandardFonts.Courier : StandardFonts.Helvetica)
  const bold = await doc.embedFont(layout === 'monospace' ? StandardFonts.CourierBold : StandardFonts.HelveticaBold)
  const size = 10
  const ink = rgb(0.07, 0.1, 0.28)

  const pad = (cells) => cells.map((c, i) => (i < cells.length - 1 ? c.padEnd(18) : c)).join('')

  const drawRow = (page, cells, y, font) => {
    if (layout === 'monospace') {
      page.drawText(pad(cells), { x: COLUMN_X[0], y, size, font, color: ink })
      return
    }
    cells.forEach((text, i) => {
      if (!text) return
      let x = COLUMN_X[i]
      if (rightAlignPrices && i === 3) x = 530 - font.widthOfTextAtSize(text, size)
      page.drawText(text, { x, y, size, font, color: ink })
    })
  }

  const chunks = []
  for (let i = 0; i < rows.length; i += rowsPerPage) chunks.push(rows.slice(i, i + rowsPerPage))
  if (chunks.length === 0) chunks.push([])

  chunks.forEach((chunk, pageIndex) => {
    const page = doc.addPage([595, 842])
    let y = 780
    if (pageIndex === 0 && title) {
      page.drawText(title, { x: COLUMN_X[0], y, size: 11, font: bold, color: ink })
      y -= 40
    }
    if (!noHeader) {
      drawRow(page, HEADER, y, bold)
      y -= 10
      if (layout === 'monospace') {
        page.drawText('-'.repeat(66), { x: COLUMN_X[0], y, size, font: regular, color: ink })
      } else {
        page.drawLine({ start: { x: COLUMN_X[0], y }, end: { x: 530, y }, thickness: 0.8, color: ink })
      }
      y -= 16
    }
    for (const cells of chunk) {
      drawRow(page, cells, y, regular)
      y -= 18
    }
    if (pageIndex === chunks.length - 1) {
      y -= 8
      for (const line of footer) {
        page.drawText(line, { x: COLUMN_X[0], y, size, font: bold, color: ink })
        y -= 18
      }
    }
  })

  return doc.save()
}

/** The demo files shipped in sample-data/. */
export const SAMPLE_FILES = {
  'cart.pdf': { rows: SAMPLE_ROWS },
  'cart-plain-text.pdf': { rows: SAMPLE_ROWS, layout: 'monospace' },
  'cart-below-threshold.pdf': {
    title: 'Order #OP-9934  |  Date: 18 Jan 2025',
    rows: SAMPLE_ROWS.filter(([product]) => product !== 'Ceramic Vase'),
    rightAlignPrices: true,
    footer: ['Total: Rs.3,433'],
  },
  'cart-with-bad-rows.pdf': {
    title: 'Order #OP-9940  |  Date: 21 Jan 2025',
    rows: [
      ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'],
      ['Bed Sheet Set', 'Natura Casa', 'Flipkart', ''],
      ['Wall Shelf', '', 'Amazon India', 'Rs.599'],
      ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'On request'],
      ['Cutting Board', 'Nordic Basics', 'Amazon India', 'Rs.449'],
      ['Desk Organiser', 'Nordic Basics', 'Flipkart', 'Rs.899'],
    ],
    footer: ['Total: Rs.2,647'],
  },
}
