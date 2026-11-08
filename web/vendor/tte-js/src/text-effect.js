import { parseText, seededRandom } from './core.js'
import { createEffect } from './effects.js'

const DEFAULT_OPTIONS = {
  autoplay: true,
  background: null,
  duration: 2400,
  effect: 'laseretch',
  fps: 60,
  loop: false,
  respectReducedMotion: true,
  seed: 1,
}

export class TextEffect {
  constructor(target, options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.target = resolveTarget(target)
    this.source = this.target instanceof HTMLCanvasElement ? null : this.target
    this.canvas = this.source ? document.createElement('canvas') : this.target
    this.text = options.text ?? this.source?.textContent ?? ''
    this.grid = parseText(this.text)
    this.frame = 0
    this.running = false
    this.destroyed = false
    this.animationFrame = 0
    this.resizeObserver = null
    this.resolveRun = null
    this.wrapper = null
    this.originalStyle = null

    if (this.grid.visibleCells.length === 0) {
      throw new TypeError('TextEffect needs at least one visible character')
    }

    this.mount()
    this.rebuild()
    this.resize()
    this.render(0, 0)

    if (this.options.autoplay) {
      queueMicrotask(() => {
        if (!this.destroyed) {
          void this.play()
        }
      })
    }
  }

  play() {
    this.assertLive()
    this.stop()
    this.rebuild()

    if (this.prefersReducedMotion()) {
      this.render(1, this.options.duration)
      this.options.onFinish?.()
      return Promise.resolve({ cancelled: false })
    }

    this.running = true
    this.startedAt = 0
    this.lastPaintAt = 0

    const finished = new Promise((resolve) => {
      this.resolveRun = resolve
    })

    const tick = (timestamp) => {
      if (!this.running) {
        return
      }

      if (this.startedAt === 0) {
        this.startedAt = timestamp
      }

      const elapsed = timestamp - this.startedAt
      const frameInterval = 1000 / Math.max(1, Number(this.options.fps))
      const shouldPaint =
        this.lastPaintAt === 0 ||
        timestamp - this.lastPaintAt >= frameInterval ||
        elapsed >= this.options.duration

      if (shouldPaint) {
        this.render(elapsed / this.options.duration, elapsed)
        this.lastPaintAt = timestamp
      }

      if (elapsed >= this.options.duration) {
        this.options.onFinish?.()

        if (this.options.loop) {
          this.rebuild()
          this.startedAt = timestamp
          this.lastPaintAt = 0
        } else {
          this.running = false
          this.animationFrame = 0
          this.finishRun(false)
          return
        }
      }

      this.animationFrame = requestAnimationFrame(tick)
    }

    this.animationFrame = requestAnimationFrame(tick)
    return finished
  }

  restart() {
    return this.play()
  }

  stop() {
    if (this.animationFrame !== 0) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = 0
    }

    if (this.running) {
      this.running = false
      this.finishRun(true)
    }
  }

  setEffect(name, options = {}) {
    this.assertLive()
    this.options = { ...this.options, ...options, effect: name }
    return this.restart()
  }

  render(progress, elapsed = 0) {
    this.assertLive()
    this.frame = Math.min(1, Math.max(0, progress))
    const state = this.effect.render(this.frame, elapsed)
    this.renderer.draw(state)
    return state
  }

  resize() {
    this.renderer.resize()
    this.render(this.frame, 0)
  }

  destroy() {
    if (this.destroyed) {
      return
    }

    this.stop()
    this.resizeObserver?.disconnect()

    if (this.source && this.wrapper) {
      restoreInlineStyle(this.source, this.originalStyle)
      this.wrapper.parentNode?.insertBefore(this.source, this.wrapper)
      this.wrapper.remove()
    }

    this.destroyed = true
  }

  rebuild() {
    const random = seededRandom(`${this.options.seed}:${this.text}:${this.options.effect}`)
    this.effect = createEffect(this.options.effect, {
      grid: this.grid,
      options: this.options,
      random,
    })
  }

  mount() {
    this.canvas.setAttribute('aria-hidden', 'true')

    if (this.source) {
      const display = getComputedStyle(this.source).display
      this.originalStyle = captureInlineStyle(this.source)
      this.wrapper = document.createElement(display === 'inline' ? 'span' : 'div')
      this.wrapper.dataset.textEffect = ''
      Object.assign(this.wrapper.style, {
        display: display === 'inline' ? 'inline-grid' : 'grid',
        maxWidth: '100%',
        position: 'relative',
        width: 'fit-content',
      })
      Object.assign(this.source.style, {
        caretColor: 'transparent',
        color: 'transparent',
        textShadow: 'none',
      })
      Object.assign(this.canvas.style, {
        display: 'block',
        height: '100%',
        inset: '0',
        pointerEvents: 'none',
        position: 'absolute',
        width: '100%',
      })

      this.source.parentNode?.insertBefore(this.wrapper, this.source)
      this.wrapper.append(this.source, this.canvas)
    }

    this.renderer = new CanvasRenderer(this.canvas, this.grid, this.source, this.options)

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.renderer.resize()
        if (this.effect && !this.destroyed) {
          this.render(this.frame, 0)
        }
      })
      this.resizeObserver.observe(this.source ?? this.canvas)
    }
  }

  prefersReducedMotion() {
    return (
      this.options.respectReducedMotion &&
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  }

  finishRun(cancelled) {
    const resolve = this.resolveRun
    this.resolveRun = null
    resolve?.({ cancelled })
  }

  assertLive() {
    if (this.destroyed) {
      throw new Error('This TextEffect was destroyed')
    }
  }
}

class CanvasRenderer {
  constructor(canvas, grid, source, options) {
    this.canvas = canvas
    this.context = canvas.getContext('2d')
    this.grid = grid
    this.source = source
    this.options = options
    this.width = 1
    this.height = 1
    this.cellWidth = 1
    this.cellHeight = 1

    if (!this.context) {
      throw new Error('A 2D canvas context is required')
    }
  }

  resize() {
    const box = (this.source ?? this.canvas).getBoundingClientRect()
    const fallbackCell = Number(this.options.cellSize ?? 16)
    const width = Math.max(1, box.width || this.grid.columns * fallbackCell)
    const height = Math.max(1, box.height || this.grid.rows * fallbackCell * 1.8)
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1)

    this.canvas.width = Math.round(width * pixelRatio)
    this.canvas.height = Math.round(height * pixelRatio)
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)

    this.width = width
    this.height = height
    this.cellWidth = width / this.grid.columns
    this.cellHeight = height / this.grid.rows
  }

  draw(state) {
    const context = this.context
    context.clearRect(0, 0, this.width, this.height)

    if (this.options.background) {
      context.fillStyle = this.options.background
      context.fillRect(0, 0, this.width, this.height)
    }

    if (state.beam) {
      this.drawBeam(state.beam)
    }

    const fontFamily = this.source
      ? getComputedStyle(this.source).fontFamily
      : this.options.fontFamily ?? 'ui-monospace, monospace'
    const fontSize = Math.max(1, this.cellHeight * Number(this.options.fontScale ?? 0.78))

    context.font = `${this.options.fontWeight ?? 400} ${fontSize}px ${fontFamily}`
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    for (const cell of state.cells) {
      this.drawCharacter(cell)
    }

    for (const particle of state.particles ?? []) {
      this.drawCharacter({
        ...particle,
        glow: 8,
      })
    }

    context.globalAlpha = 1
    context.shadowBlur = 0
  }

  drawCharacter(cell) {
    const context = this.context
    const x = (cell.column + 0.5) * this.cellWidth
    const y = (cell.row + 0.52) * this.cellHeight

    context.globalAlpha = cell.alpha ?? 1
    context.fillStyle = cell.color ?? '#ffffff'
    context.shadowColor = cell.color ?? '#ffffff'
    context.shadowBlur = cell.glow ?? 0
    context.fillText(cell.character, x, y)
  }

  drawBeam(beam) {
    const context = this.context
    const x = (beam.column + 0.5) * this.cellWidth
    const y = (beam.row + 0.5) * this.cellHeight
    const length = Math.min(this.width, this.height) * 0.32
    const gradient = context.createLinearGradient(x, y, x + length, y - length)
    gradient.addColorStop(0, beam.color)
    gradient.addColorStop(1, 'rgba(55, 108, 255, 0)')

    context.save()
    context.strokeStyle = gradient
    context.lineWidth = Math.max(1, this.cellWidth * 0.18)
    context.shadowColor = beam.color
    context.shadowBlur = 14
    context.beginPath()
    context.moveTo(x, y)
    context.lineTo(x + length, y - length)
    context.stroke()
    context.restore()
  }
}

function resolveTarget(target) {
  const element = typeof target === 'string' ? document.querySelector(target) : target

  if (!(element instanceof HTMLElement)) {
    throw new TypeError('TextEffect target must be an HTML element or selector')
  }

  return element
}

function captureInlineStyle(element) {
  return {
    caretColor: element.style.caretColor,
    color: element.style.color,
    textShadow: element.style.textShadow,
  }
}

function restoreInlineStyle(element, style) {
  Object.assign(element.style, style)
}
