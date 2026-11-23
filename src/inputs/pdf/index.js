/**
 * PDF cart input adapter.
 *
 * parseCartPdf(bytes) → { data: CartItem[], errors: string[], notes: string[], title: string }
 *
 * Text extraction uses pdf.js; table reconstruction is in cartTable.js; every
 * row is validated by normalizeCartItem() exactly like a CSV row. Malformed
 * rows are skipped and reported individually, never guessed.
 */

import { parseCartTable } from './cartTable.js'
import { normalizeCartItem, itemIdFor } from '../../engine/models.js'

async function loadBrowserPdfjs() {
  const [lib, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  lib.GlobalWorkerOptions.workerSrc = worker.default
  return lib
}

/** Returns the text items of every page: Array<Array<{ str, x, y, width, size }>>. */
export async function extractPageItems(bytes, pdfjs) {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 }).promise
  try {
    const pages = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
          .map((it) => ({
            str: it.str,
            x: it.transform[4],
            y: it.transform[5],
            width: it.width,
            size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10,
          }))
      )
    }
    return pages
  } finally {
    await doc.destroy()
  }
}

function readableError(error) {
  if (error?.name === 'PasswordException') return 'This PDF is password-protected. Remove the password and upload it again.'
  if (error?.name === 'InvalidPDFException') return 'This file is not a valid PDF (it may be damaged).'
  return `Could not read this PDF${error?.message ? `: ${error.message}` : '.'}`
}

/**
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {{ pdfjs?: object }} [options]  pass a pdf.js module (e.g. the legacy build in Node); defaults to the browser build
 */
export async function parseCartPdf(bytes, { pdfjs } = {}) {
  const empty = (message) => ({ data: [], errors: [message], notes: [], title: '' })

  let pages
  try {
    const lib = pdfjs ?? (await loadBrowserPdfjs())
    // pdf.js takes ownership of the buffer, so hand it a copy.
    pages = await extractPageItems(new Uint8Array(bytes).slice(), lib)
  } catch (error) {
    return empty(readableError(error))
  }

  if (pages.every((items) => items.length === 0)) {
    return empty('This PDF has no selectable text. It may be a scanned image: upload a text-based PDF or a CSV instead.')
  }

  const table = parseCartTable(pages)
  if (!table.headerFound) {
    return empty('Could not find the cart table. The PDF needs a header row with the columns Product, Brand, Platform and Base Price.')
  }
  if (table.rows.length === 0) {
    return empty('The cart table in this PDF has a header but no item rows.')
  }

  const data = []
  const errors = []
  for (const row of table.rows) {
    const { item, errors: rowErrors } = normalizeCartItem({ itemId: itemIdFor(data.length), ...row.cells })
    if (item) data.push(item)
    else errors.push(`Row ${row.rowNumber} ("${row.text.replace(/\s{2,}/g, ' | ')}"): ${rowErrors.join('; ')} — skipped`)
  }

  return { data, errors, notes: table.notes, title: table.title }
}
