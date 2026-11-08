const HEX_COLOR = /^#?([\da-f]{3}|[\da-f]{6})$/i

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

export function parseText(text) {
  const normalized = String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '')
  const lines = normalized.split('\n')
  const rows = Math.max(1, lines.length)
  const columns = Math.max(1, ...lines.map((line) => Array.from(line).length))
  const cells = []

  for (let row = 0; row < rows; row += 1) {
    const characters = Array.from(lines[row] ?? '')

    for (let column = 0; column < columns; column += 1) {
      const character = characters[column] ?? ' '

      cells.push({
        character,
        column,
        row,
        index: row * columns + column,
        visible: character !== ' ',
      })
    }
  }

  return {
    cells,
    columns,
    rows,
    text: normalized,
    visibleCells: cells.filter((cell) => cell.visible),
  }
}

export function hashSeed(value) {
  const text = String(value)
  let hash = 2166136261

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

export function seededRandom(seed) {
  let state = hashSeed(seed)

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function normalizeColor(color) {
  const match = String(color).trim().match(HEX_COLOR)

  if (!match) {
    throw new TypeError(`Invalid color: ${color}`)
  }

  let hex = match[1].toLowerCase()
  if (hex.length === 3) {
    hex = Array.from(hex, (digit) => digit + digit).join('')
  }

  return `#${hex}`
}

export function mixColors(from, to, amount) {
  const start = colorChannels(normalizeColor(from))
  const end = colorChannels(normalizeColor(to))
  const progress = clamp(amount)
  const channels = start.map((channel, index) =>
    Math.round(channel + (end[index] - channel) * progress),
  )

  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function colorAt(stops, progress) {
  if (!Array.isArray(stops) || stops.length === 0) {
    return '#ffffff'
  }

  const colors = stops.map(normalizeColor)
  if (colors.length === 1) {
    return colors[0]
  }

  const position = clamp(progress) * (colors.length - 1)
  const index = Math.min(colors.length - 2, Math.floor(position))

  return mixColors(colors[index], colors[index + 1], position - index)
}

function colorChannels(color) {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ]
}
