import {
  BUILTIN_EFFECTS,
  createDecryptEffect,
  createLaserEtchEffect,
  createWipeEffect,
} from './builtin-effects.js'

const effects = new Map()
const catalog = new Map()

export { createDecryptEffect, createLaserEtchEffect, createWipeEffect }

export function registerEffect(name, factory, metadata = {}) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('Effect name must be a non-empty string')
  }

  if (typeof factory !== 'function') {
    throw new TypeError('Effect factory must be a function')
  }

  const normalizedName = normalizeEffectName(name)
  effects.set(normalizedName, factory)
  catalog.set(normalizedName, {
    description: metadata.description ?? 'Custom text effect.',
    name: normalizedName,
  })
}

export function createEffect(name, context) {
  const normalizedName = normalizeEffectName(name)
  const factory = effects.get(normalizedName)

  if (!factory) {
    throw new RangeError(`Unknown effect "${name}". Try: ${effectNames().join(', ')}`)
  }

  return factory(context)
}

export function effectNames() {
  return Array.from(effects.keys())
}

export function effectCatalog() {
  return Array.from(catalog.values(), (entry) => ({ ...entry }))
}

function normalizeEffectName(name) {
  return String(name).trim().toLowerCase().replace(/[\s_-]+/g, '')
}

for (const builtin of BUILTIN_EFFECTS) {
  registerEffect(builtin.name, builtin.factory, {
    description: builtin.description,
  })
}
