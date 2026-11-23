/**
 * cartSources.js — registry of cart input adapters.
 *
 * Each source turns a File into { data: CartItem[], errors: string[], notes?, title? }.
 * The UI picks the source by file extension; the engine never knows which one
 * was used. To support a new format (Excel, JSON, an order API...), add one
 * entry here. Nothing in engine/ changes.
 */

import { parseCartCSV } from './csv.js'
import { parseCartPdf } from './pdf/index.js'

export const CART_SOURCES = [
  {
    id: 'csv',
    label: 'CSV',
    extensions: ['.csv'],
    read: async (file) => parseCartCSV(await file.text()),
  },
  {
    id: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    read: async (file) => parseCartPdf(await file.arrayBuffer()),
  },
]

export const CART_ACCEPT = CART_SOURCES.flatMap((s) => s.extensions).join(',')

export function findCartSource(fileName) {
  const name = fileName.toLowerCase()
  return CART_SOURCES.find((s) => s.extensions.some((ext) => name.endsWith(ext))) ?? null
}

/** Reads a cart file with the matching source. Always resolves; problems come back in errors. */
export async function importCartFile(file) {
  const source = findCartSource(file.name)
  if (!source) {
    return { data: [], errors: [`"${file.name}" isn't a supported cart file. Upload ${CART_SOURCES.map((s) => s.label).join(' or ')}.`], source: null }
  }
  try {
    return { notes: [], title: '', ...(await source.read(file)), source }
  } catch (error) {
    return { data: [], errors: [`Could not read "${file.name}": ${error.message}`], source }
  }
}
