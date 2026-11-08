export { TextEffect } from './text-effect.js'
export {
  createDecryptEffect,
  createEffect,
  createLaserEtchEffect,
  createWipeEffect,
  effectCatalog,
  effectNames,
  registerEffect,
} from './effects.js'
export {
  clamp,
  colorAt,
  hashSeed,
  mixColors,
  normalizeColor,
  parseText,
  seededRandom,
} from './core.js'

import { TextEffect } from './text-effect.js'

export function createTextEffect(target, options) {
  return new TextEffect(target, options)
}

export function defineTextEffectElement(tagName = 'text-effect') {
  if (typeof customElements === 'undefined' || typeof HTMLElement === 'undefined') {
    return null
  }

  const existing = customElements.get(tagName)
  if (existing) {
    return existing
  }

  class TextEffectElement extends HTMLElement {
    static observedAttributes = ['colors', 'duration', 'effect', 'loop', 'seed']

    connectedCallback() {
      if (this.controller) {
        return
      }

      const text = cleanElementText(this.getAttribute('text') ?? this.textContent)
      const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
      shadow.innerHTML = `
        <style>
          :host {
            display: block;
          }

          pre {
            font: inherit;
            line-height: inherit;
            margin: 0;
            white-space: pre;
          }
        </style>
        <pre></pre>
      `

      const pre = shadow.querySelector('pre')
      pre.textContent = text
      this.controller = new TextEffect(pre, {
        ...this.readOptions(),
        text,
      })
    }

    disconnectedCallback() {
      this.controller?.destroy()
      this.controller = null
    }

    attributeChangedCallback() {
      if (!this.controller) {
        return
      }

      this.controller.options = {
        ...this.controller.options,
        ...this.readOptions(),
      }
      void this.controller.restart()
    }

    play() {
      return this.controller?.play()
    }

    restart() {
      return this.controller?.restart()
    }

    stop() {
      this.controller?.stop()
    }

    readOptions() {
      const colors = this.getAttribute('colors')

      return {
        colors: colors ? colors.split(',').map((color) => color.trim()) : undefined,
        duration: numberAttribute(this, 'duration', 2400),
        effect: this.getAttribute('effect') ?? 'laseretch',
        loop: this.hasAttribute('loop'),
        seed: this.getAttribute('seed') ?? 1,
      }
    }
  }

  customElements.define(tagName, TextEffectElement)
  return TextEffectElement
}

function cleanElementText(text) {
  return String(text).replace(/^\n/, '').replace(/\n\s*$/, '')
}

function numberAttribute(element, name, fallback) {
  const value = Number(element.getAttribute(name))
  return Number.isFinite(value) && value > 0 ? value : fallback
}
