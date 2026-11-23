/**
 * FileUploader.jsx
 *
 * Click-or-drop area for a single file. Hands the File object to onFile;
 * the caller decides how to read it (text for CSV, bytes for PDF).
 */

import { useRef, useState } from 'react'
import { C } from './theme.js'

export default function FileUploader({ label, description, accept, onFile, hasData, fileName, busy = false }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  function take(file) {
    if (file && !busy) onFile(file)
  }

  const border = dragging ? C.orange : hasData ? C.green : C.line
  const background = dragging ? '#fff4ec' : hasData ? C.greenBg : '#fafafa'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Upload ${label}`}
      style={{
        border: `2px dashed ${border}`,
        borderRadius: 6,
        padding: '0.9rem 1.1rem',
        background,
        cursor: busy ? 'progress' : 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), inputRef.current?.click())}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        take(e.dataTransfer.files[0])
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          take(e.target.files[0])
          e.target.value = '' // allow re-uploading the same file
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: 20 }} aria-hidden>
          {busy ? '⏳' : hasData ? '✅' : '📄'}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.navy }}>{label}</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 2, overflowWrap: 'anywhere' }}>
            {busy ? 'Reading file…' : hasData && fileName ? fileName : description}
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: hasData ? C.green : C.orange,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {hasData ? 'Replace' : 'Upload'}
          </span>
        </div>
      </div>
    </div>
  )
}
