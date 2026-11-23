/**
 * cartTable.js — turns positioned PDF text into cart table rows.
 *
 * Pure functions, no pdf.js dependency, so they are easy to test.
 *
 * Approach (deterministic on purpose: prices must never be guessed):
 *   1. Group text items into lines by their y position.
 *   2. Split each line into segments: text separated by a column-sized gap
 *      (or by 2+ spaces inside one string, as in plain-text printouts).
 *   3. Find the header line (Product, Brand, Platform, Base Price) and use the
 *      x position of each header word as that column's left edge.
 *   4. Assign every segment of every following line to a column by its x.
 *
 * Item:    { str, x, y, width, size }  (one pdf.js text item)
 * Segment: { text, x, endX, size }
 * Line:    { y, segments }
 */

export const COLUMNS = ['product', 'brand', 'platform', 'basePrice']

const COLUMN_GAP_EM = 0.9 // gaps wider than this (in font-size units) separate columns
const SEPARATOR_LINE = /^[\s\-–—_=─━.·•*|]+$/
const SUMMARY_LINE = /^(sub\s*-?\s*total|grand\s+total|total|amount\s+payable)\b/i
const PRICE_LIKE = /^(rs\.?|₹|inr)?\s*\d[\d,]*(\.\d+)?$/i

/** Splits one text item into pieces wherever it contains 2+ spaces or a tab. */
function splitItem(item) {
  const charWidth = item.str.length ? item.width / item.str.length : 0
  const pieces = []
  for (const m of item.str.matchAll(/\S+(?: \S+)*/g)) {
    pieces.push({
      text: m[0],
      x: item.x + m.index * charWidth,
      endX: item.x + (m.index + m[0].length) * charWidth,
      size: item.size,
    })
  }
  return pieces
}

/** Merges the pieces of one line into column segments. */
export function buildSegments(lineItems) {
  const pieces = [...lineItems].sort((a, b) => a.x - b.x).flatMap(splitItem)
  const segments = []
  for (const piece of pieces) {
    const last = segments[segments.length - 1]
    const gap = last ? piece.x - last.endX : Infinity
    if (last && gap < piece.size * COLUMN_GAP_EM) {
      last.text += gap > piece.size * 0.1 ? ` ${piece.text}` : piece.text
      last.endX = piece.endX
    } else {
      segments.push({ ...piece })
    }
  }
  return segments
}

/** Groups the text items of one page into lines, top to bottom. */
export function itemsToLines(items) {
  const sorted = items.filter((it) => it.str && it.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)
  const groups = []
  for (const item of sorted) {
    const group = groups[groups.length - 1]
    if (group && Math.abs(group.y - item.y) <= Math.max(2, item.size * 0.4)) group.items.push(item)
    else groups.push({ y: item.y, items: [item] })
  }
  return groups.map((g) => ({ y: g.y, segments: buildSegments(g.items) }))
}

const lineText = (line) => line.segments.map((s) => s.text).join('  ')

/** Words of a line with their estimated x positions. */
function words(line) {
  return line.segments.flatMap((seg) => {
    const charWidth = seg.text.length ? (seg.endX - seg.x) / seg.text.length : 0
    return [...seg.text.matchAll(/\S+/g)].map((m) => ({ word: m[0].toLowerCase(), x: seg.x + m.index * charWidth }))
  })
}

/**
 * If this line is the table header, returns the left edge of each column
 * ([product, brand, platform, basePrice] x positions); otherwise null.
 */
export function findHeader(line) {
  const ws = words(line)
  const at = (test) => ws.findIndex(test)
  const product = at((w) => /^product/.test(w.word))
  const brand = at((w) => /^brand/.test(w.word))
  const platform = at((w) => /^(platform|marketplace)/.test(w.word))
  let price = ws.findIndex((w, i) => w.word === 'base' && /^price/.test(ws[i + 1]?.word ?? ''))
  if (price === -1) price = at((w) => /^(price|mrp)/.test(w.word))

  const idx = [product, brand, platform, price]
  if (idx.some((i) => i === -1)) return null
  const anchors = idx.map((i) => ws[i].x)
  const ascending = anchors.every((x, i) => i === 0 || x > anchors[i - 1])
  return ascending ? anchors : null
}

/** Puts each segment under the column whose left edge it starts at or after. */
export function assignCells(segments, anchors) {
  const buckets = COLUMNS.map(() => [])
  for (const seg of segments) {
    const tolerance = seg.size * 0.5
    let col = 0
    anchors.forEach((x, i) => {
      if (seg.x + tolerance >= x) col = i
    })
    buckets[col].push(seg)
  }

  // A right-aligned price can start left of its header. If the price column is
  // empty and the line ends in something that looks like a price, move it over.
  const priceCol = COLUMNS.length - 1
  if (buckets[priceCol].length === 0) {
    const last = segments[segments.length - 1]
    if (last && PRICE_LIKE.test(last.text.trim())) {
      const from = buckets.findIndex((b) => b.includes(last))
      if (from !== -1 && from !== priceCol) {
        buckets[from] = buckets[from].filter((s) => s !== last)
        buckets[priceCol].push(last)
      }
    }
  }

  return Object.fromEntries(COLUMNS.map((key, i) => [key, buckets[i].map((s) => s.text).join(' ').trim()]))
}

/**
 * @param pages  Array (one entry per page) of pdf.js-style text items
 * @returns {{ headerFound: boolean, title: string, rows: {rowNumber, cells, text}[], notes: string[] }}
 */
export function parseCartTable(pages) {
  const rows = []
  const notes = []
  let anchors = null
  let title = ''

  for (const items of pages) {
    for (const line of itemsToLines(items)) {
      const header = findHeader(line)
      if (header) {
        anchors = header // a repeated header on a later page re-anchors the columns
        continue
      }
      const text = lineText(line)
      if (!anchors) {
        if (!title) title = text
        continue
      }
      if (SEPARATOR_LINE.test(text)) continue
      if (SUMMARY_LINE.test(text)) {
        notes.push(`Ignored summary line "${text}"`)
        continue
      }
      rows.push({ rowNumber: rows.length + 1, cells: assignCells(line.segments, anchors), text })
    }
  }

  return { headerFound: anchors !== null, title, rows, notes }
}
