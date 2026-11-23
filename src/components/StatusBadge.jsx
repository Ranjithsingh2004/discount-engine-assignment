import { C } from './theme.js'

const STYLES = {
  max_discount: [C.green, '#dff3e4'],
  stacked: [C.blue, C.blueBg],
  applied: [C.green, '#dff3e4'],
  none: ['#5f5f68', '#ececf0'],
  cart: [C.green, '#dff3e4'],
}

export default function StatusBadge({ status, label }) {
  const [color, bg] = STYLES[status] ?? STYLES.none
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 700,
        padding: '2px 8px',
        borderRadius: 20,
        background: bg,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}
