import { clamp, colorAt, mixColors } from './core.js'

const DEFAULT_COLORS = ['#8a5cff', '#00d1ff', '#ffffff']
const FIRE_COLORS = ['#fff4b0', '#ff9d2e', '#ff3d1f']
const MATRIX_COLORS = ['#0b3d20', '#00c853', '#b9ffcb']
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*<>[]{}'
const PARTICLES = '.,*+'

export const BUILTIN_EFFECTS = [
  effect('beams', 'Light beams scan across the text.', createBeamsEffect),
  effect('binarypath', 'Binary characters travel toward their final positions.', createBinaryPathEffect),
  effect('blackhole', 'A black hole pulls characters inward and releases them.', createBlackholeEffect),
  effect('bouncyballs', 'Characters bounce down from above.', createBouncyBallsEffect),
  effect('bubbles', 'Character bubbles drift, pop, and reveal the text.', createBubblesEffect),
  effect('burn', 'Fire climbs through the text.', createBurnEffect),
  effect('colorshift', 'A moving color gradient crosses the text.', createColorShiftEffect),
  effect('crumble', 'The text crumbles and rebuilds itself.', createCrumbleEffect),
  effect('decrypt', 'Random glyphs resolve into the final message.', createDecryptEffect),
  effect('errorcorrect', 'Incorrect characters get corrected in sequence.', createErrorCorrectEffect),
  effect('expand', 'Characters expand outward from the center.', createExpandEffect),
  effect('fireworks', 'Characters launch and burst into position.', createFireworksEffect),
  effect('highlight', 'A bright highlight runs across the text.', createHighlightEffect),
  effect('laseretch', 'A moving laser burns each character into place.', createLaserEtchEffect),
  effect('matrix', 'Digital rain resolves into the final text.', createMatrixEffect),
  effect('middleout', 'The text opens from its middle row.', createMiddleOutEffect),
  effect('orbittingvolley', 'Orbiting characters fire inward and settle.', createOrbittingVolleyEffect),
  effect('overflow', 'Scrambled rows scroll until they align.', createOverflowEffect),
  effect('pour', 'Characters pour down into position.', createPourEffect),
  effect('print', 'A print head writes one line at a time.', createPrintEffect),
  effect('rain', 'Characters rain down from the top.', createRainEffect),
  effect('randomsequence', 'Characters appear in a seeded random order.', createRandomSequenceEffect),
  effect('rings', 'Spinning character rings collapse into the text.', createRingsEffect),
  effect('scattered', 'Scattered characters move home.', createScatteredEffect),
  effect('slice', 'Two sliced halves slide together.', createSliceEffect),
  effect('slide', 'The complete text slides into view.', createSlideEffect),
  effect('smoke', 'A smoke cloud uncovers the text.', createSmokeEffect),
  effect('spotlights', 'Moving spotlights search before revealing everything.', createSpotlightsEffect),
  effect('spray', 'Characters spray outward from one point.', createSprayEffect),
  effect('swarm', 'Small character swarms circle and settle.', createSwarmEffect),
  effect('sweep', 'Two passes reveal and color the text.', createSweepEffect),
  effect('synthgrid', 'A synthetic grid dissolves into the text.', createSynthGridEffect),
  effect('thunderstorm', 'Rain and lightning reveal the text.', createThunderstormEffect),
  effect('unstable', 'The text breaks apart and reassembles.', createUnstableEffect),
  effect('vhstape', 'Horizontal glitches distort the text.', createVhsTapeEffect),
  effect('waves', 'A traveling wave leaves the text behind.', createWavesEffect),
  effect('wipe', 'A diagonal wave reveals the original text.', createWipeEffect),
]

export function createLaserEtchEffect({ grid, random, options }) {
  const order = nearestOrder(grid.visibleCells, random)
  const ranks = rankMap(order)
  const plans = createPlans(order, random)
  const count = Math.max(1, order.length)

  return renderer(grid, options, (progress) => {
    const position = progress * count
    const cells = revealByRank(grid, options, ranks, position, (cell, age) => {
      const finalColor = cellColor(cell, grid, options)
      const cooling = clamp(age / Math.max(8, count * 0.055))
      const hot = colorAt(options.hotColors ?? FIRE_COLORS, clamp(age / 7))

      return {
        alpha: clamp(age * 1.8),
        character: age < 0.45 ? '^' : cell.character,
        color: mixColors(hot, finalColor, cooling),
        glow: (1 - cooling) * 18,
      }
    })
    const active = order[Math.min(order.length - 1, Math.floor(position))]

    return {
      beam: active
        ? {
            color: colorAt(options.laserColors ?? ['#ffffff', '#376cff'], progress),
            column: active.column,
            row: active.row,
          }
        : null,
      cells,
      particles: recentParticles(order, plans, position, FIRE_COLORS),
    }
  })
}

export function createDecryptEffect({ grid, random, options }) {
  const order = shuffle(grid.visibleCells, random)
  const ranks = rankMap(order)
  const count = Math.max(1, order.length)

  return renderer(grid, options, (progress, elapsed) => {
    const tick = Math.floor(elapsed / (options.glyphInterval ?? 45))

    return {
      cells: grid.visibleCells.map((cell) => {
        const settleAt = 0.18 + (ranks.get(cell.index) / count) * 0.72
        const settled = progress >= settleAt

        return styled(cell, grid, options, {
          alpha: clamp(progress * 8),
          character: settled ? cell.character : glyph(cell.index + tick * 17),
          color: settled
            ? cellColor(cell, grid, options)
            : mixColors('#194b5f', '#ffffff', clamp(progress / settleAt)),
          glow: settled ? 2 : 8,
        })
      }),
      particles: [],
    }
  })
}

export function createWipeEffect({ grid, options }) {
  const feather = Math.max(0.5, Number(options.feather ?? 2.5))

  return renderer(grid, options, (progress) => {
    const threshold = progress * (grid.columns + grid.rows + feather)

    return {
      cells: grid.visibleCells.flatMap((cell) => {
        const distance = threshold - cell.column - cell.row
        if (distance <= 0) return []

        return styled(cell, grid, options, {
          alpha: clamp(distance / feather),
          glow: distance < feather ? 12 * (1 - clamp(distance / feather)) : 0,
        })
      }),
      particles: [],
    }
  })
}

function createBeamsEffect({ grid, options }) {
  return renderer(grid, options, (progress) => {
    const horizontal = progress * (grid.columns + 8) - 4
    const vertical = progress * (grid.rows + 4) - 2

    return {
      cells: grid.visibleCells.flatMap((cell) => {
        const distance = Math.min(Math.abs(cell.column - horizontal), Math.abs(cell.row - vertical) * 2)
        const passed = cell.column <= horizontal || cell.row <= vertical
        if (!passed && distance > 2.5) return []

        return styled(cell, grid, options, {
          alpha: passed ? 1 : clamp(1 - distance / 2.5),
          color: distance < 1.3 ? '#ffffff' : cellColor(cell, grid, options),
          glow: clamp(1 - distance / 3) * 15,
        })
      }),
      particles: [],
    }
  })
}

function createBinaryPathEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const plan = plans[index]
      const local = stagger(progress, index, grid.visibleCells.length, 0.4)

      return styled(cell, grid, options, {
        alpha: clamp(local * 3),
        character: local < 0.82 ? (plan.value > 0.5 ? '1' : '0') : cell.character,
        column: mix(plan.edgeColumn, cell.column, easeOut(local)),
        color: local < 0.82 ? '#55ff99' : cellColor(cell, grid, options),
        row: mix(plan.edgeRow, cell.row, easeOut(local)),
      })
    }),
    particles: [],
  }))
}

function createBlackholeEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)
  const center = gridCenter(grid)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const plan = plans[index]
      const angle = plan.angle + progress * Math.PI * 4
      let column
      let row

      if (progress < 0.42) {
        const pull = easeInOut(progress / 0.42)
        column = mix(cell.column, center.column + Math.cos(angle) * (1 - pull) * 4, pull)
        row = mix(cell.row, center.row + Math.sin(angle) * (1 - pull) * 2, pull)
      } else {
        const release = easeOut((progress - 0.42) / 0.58)
        const burst = Math.sin(release * Math.PI) * plan.distance * 0.8
        column = mix(center.column, cell.column, release) + Math.cos(angle) * burst
        row = mix(center.row, cell.row, release) + Math.sin(angle) * burst * 0.5
      }

      return styled(cell, grid, options, { column, row, glow: 8 * (1 - progress) })
    }),
    particles: radialParticles(center, plans, progress, ['#8a5cff', '#00d1ff']),
  }))
}

function createBouncyBallsEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const local = stagger(progress, index, grid.visibleCells.length, 0.45)
      const bounce = Math.abs(Math.sin(local * Math.PI * (2 + plans[index].value * 2)))
        * (1 - local) * 3

      return styled(cell, grid, options, {
        column: cell.column,
        row: mix(-3 - plans[index].distance, cell.row, easeOut(local)) - bounce,
      })
    }),
    particles: [],
  }))
}

function createBubblesEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const local = stagger(progress, index, grid.visibleCells.length, 0.35)
      const plan = plans[index]
      const wobble = Math.sin(local * Math.PI * 5 + plan.angle) * (1 - local)

      return styled(cell, grid, options, {
        alpha: clamp(local * 2),
        character: local < 0.7 ? '○' : cell.character,
        column: cell.column + wobble * 2,
        row: mix(grid.rows + plan.distance, cell.row, easeInOut(local)),
        glow: (1 - local) * 8,
      })
    }),
    particles: [],
  }))
}

function createBurnEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)
  const threshold = (progress) => grid.rows + 2 - progress * (grid.rows + 4)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.flatMap((cell) => {
      const heat = cell.row - threshold(progress)
      if (heat < -2) return []
      return styled(cell, grid, options, {
        alpha: clamp((heat + 2) / 2),
        color: heat < 1 ? colorAt(FIRE_COLORS, clamp((heat + 2) / 3)) : cellColor(cell, grid, options),
        glow: heat < 1 ? 14 : 0,
      })
    }),
    particles: plans.slice(0, 24).map((plan, index) => ({
      alpha: clamp(1 - progress),
      character: PARTICLES[index % PARTICLES.length],
      color: colorAt(FIRE_COLORS, plan.value),
      column: (plan.value * grid.columns + progress * plan.drift * 3 + grid.columns) % grid.columns,
      row: threshold(progress) - plan.distance * progress,
    })),
  }))
}

function createColorShiftEffect({ grid, options }) {
  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell) =>
      styled(cell, grid, options, {
        color: colorAt(options.colors ?? DEFAULT_COLORS, (cell.column / grid.columns + progress * 1.5) % 1),
        glow: 4,
      }),
    ),
    particles: [],
  }))
}

function createCrumbleEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const plan = plans[index]
      if (progress < 0.38) {
        const fall = stagger(progress / 0.38, index, grid.visibleCells.length, 0.5)
        return styled(cell, grid, options, {
          alpha: 1 - fall * 0.65,
          character: fall > 0.45 ? PARTICLES[index % PARTICLES.length] : cell.character,
          column: cell.column + plan.drift * fall,
          row: cell.row + fall * fall * (grid.rows + plan.distance),
        })
      }

      const rebuild = easeOut((progress - 0.38) / 0.62)
      return styled(cell, grid, options, {
        alpha: rebuild,
        character: rebuild < 0.55 ? PARTICLES[index % PARTICLES.length] : cell.character,
        column: mix(plan.edgeColumn, cell.column, rebuild),
        row: mix(grid.rows + plan.distance, cell.row, rebuild),
      })
    }),
    particles: [],
  }))
}

function createErrorCorrectEffect({ grid, random, options }) {
  const order = shuffle(grid.visibleCells, random)
  const ranks = rankMap(order)

  return renderer(grid, options, (progress, elapsed) => ({
    cells: grid.visibleCells.map((cell) => {
      const corrected = progress >= (ranks.get(cell.index) + 1) / order.length
      return styled(cell, grid, options, {
        character: corrected ? cell.character : glyph(cell.index + Math.floor(elapsed / 90)),
        color: corrected ? cellColor(cell, grid, options) : '#ff5577',
        glow: corrected ? 0 : 7,
      })
    }),
    particles: [],
  }))
}

function createExpandEffect({ grid, options }) {
  const center = gridCenter(grid)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell) =>
      styled(cell, grid, options, {
        alpha: clamp(progress * 2),
        column: mix(center.column, cell.column, easeOut(progress)),
        row: mix(center.row, cell.row, easeOut(progress)),
      }),
    ),
    particles: [],
  }))
}

function createFireworksEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)
  const launch = { column: grid.columns / 2, row: grid.rows + 2 }

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const plan = plans[index]
      const burstPoint = {
        column: grid.columns * (0.25 + plan.value * 0.5),
        row: grid.rows * (0.2 + plan.value2 * 0.35),
      }

      if (progress < 0.3) {
        const local = progress / 0.3
        return styled(cell, grid, options, {
          alpha: clamp(local * 3),
          character: '*',
          column: mix(launch.column, burstPoint.column, local),
          color: colorAt(FIRE_COLORS, plan.value),
          row: mix(launch.row, burstPoint.row, easeOut(local)),
          glow: 12,
        })
      }

      const settle = easeInOut((progress - 0.3) / 0.7)
      const radius = Math.sin(settle * Math.PI) * plan.distance
      return styled(cell, grid, options, {
        column: mix(burstPoint.column + Math.cos(plan.angle) * radius, cell.column, settle),
        row: mix(burstPoint.row + Math.sin(plan.angle) * radius * 0.6, cell.row, settle),
      })
    }),
    particles: [],
  }))
}

function createHighlightEffect({ grid, options }) {
  return renderer(grid, options, (progress) => {
    const center = progress * (grid.columns + 8) - 4

    return {
      cells: grid.visibleCells.map((cell) => {
        const light = clamp(1 - Math.abs(cell.column - center) / 4)
        return styled(cell, grid, options, {
          color: mixColors(cellColor(cell, grid, options), '#ffffff', light),
          glow: light * 16,
        })
      }),
      particles: [],
    }
  })
}

function createMatrixEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress, elapsed) => {
    const tick = Math.floor(elapsed / 70)
    const cells = grid.visibleCells.map((cell, index) => {
      const settleAt = 0.35 + plans[index].value * 0.55
      const settled = progress >= settleAt
      return styled(cell, grid, options, {
        character: settled ? cell.character : glyph(cell.index + tick),
        color: settled ? cellColor(cell, grid, options) : colorAt(MATRIX_COLORS, plans[index].value),
        glow: settled ? 0 : 7,
      })
    })
    const particles = Array.from({ length: Math.min(36, grid.columns) }, (_, index) => {
      const plan = plans[index % plans.length]
      return {
        alpha: 1 - progress,
        character: plan.value > 0.5 ? '1' : '0',
        color: colorAt(MATRIX_COLORS, plan.value2),
        column: (index * 3 + Math.floor(plan.value * 4)) % grid.columns,
        row: (tick * (0.35 + plan.value) + index * 1.7) % (grid.rows + 6) - 3,
      }
    })

    return { cells, particles }
  })
}

function createMiddleOutEffect({ grid, options }) {
  const middle = (grid.rows - 1) / 2

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.flatMap((cell) => {
      const rowDistance = Math.abs(cell.row - middle)
      const local = clamp(progress * (grid.rows / 2 + 1) - rowDistance)
      if (local <= 0) return []

      return styled(cell, grid, options, {
        alpha: local,
        column: mix(grid.columns / 2, cell.column, easeOut(local)),
      })
    }),
    particles: [],
  }))
}

function createOrbittingVolleyEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)
  const center = gridCenter(grid)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const plan = plans[index]
      const local = stagger(progress, index, grid.visibleCells.length, 0.5)
      const angle = plan.angle + progress * Math.PI * 5
      const radius = (1 - local) * (Math.max(grid.columns, grid.rows) * 0.55 + plan.distance)

      return styled(cell, grid, options, {
        column: mix(center.column + Math.cos(angle) * radius, cell.column, easeOut(local)),
        row: mix(center.row + Math.sin(angle) * radius * 0.45, cell.row, easeOut(local)),
      })
    }),
    particles: [],
  }))
}

function createOverflowEffect({ grid, random, options }) {
  const rowOffsets = Array.from({ length: grid.rows }, () => Math.floor(random() * grid.rows * 2) + 2)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell) => {
      const local = stagger(progress, cell.row, grid.rows, 0.45)
      const scroll = Math.round((1 - local) * rowOffsets[cell.row])
      return styled(cell, grid, options, {
        character: local < 0.8 ? glyph(cell.index + scroll) : cell.character,
        row: (cell.row + scroll) % grid.rows,
      })
    }),
    particles: [],
  }))
}

function createPourEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const local = stagger(progress, index, grid.visibleCells.length, 0.65)
      return styled(cell, grid, options, {
        column: cell.column + Math.sin(local * Math.PI * 2 + plans[index].angle) * (1 - local),
        row: mix(-4 - plans[index].distance, cell.row, easeIn(local)),
      })
    }),
    particles: [],
  }))
}

function createPrintEffect({ grid, options }) {
  return renderer(grid, options, (progress) => {
    const position = progress * (grid.columns * grid.rows + grid.columns)
    const cells = grid.visibleCells.filter((cell) => cell.index < position)
      .map((cell) => styled(cell, grid, options))
    const headIndex = Math.min(grid.columns * grid.rows - 1, Math.floor(position))

    return {
      cells,
      particles: [{
        alpha: 1,
        character: '▌',
        color: '#ffffff',
        column: headIndex % grid.columns,
        row: Math.floor(headIndex / grid.columns),
      }],
    }
  })
}

function createRainEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const local = stagger(progress, index, grid.visibleCells.length, 0.5)
      const plan = plans[index]
      return styled(cell, grid, options, {
        alpha: clamp(local * 3),
        row: mix(-2 - plan.distance * 1.5, cell.row, easeIn(local)),
      })
    }),
    particles: [],
  }))
}

function createRandomSequenceEffect({ grid, random, options }) {
  const order = shuffle(grid.visibleCells, random)
  const ranks = rankMap(order)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.flatMap((cell) => {
      const local = clamp(progress * order.length - ranks.get(cell.index))
      return local > 0
        ? styled(cell, grid, options, { alpha: local, glow: (1 - local) * 10 })
        : []
    }),
    particles: [],
  }))
}

function createRingsEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)
  const center = gridCenter(grid)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const plan = plans[index]
      const angle = plan.angle + progress * Math.PI * 4
      const radius = (1 - easeInOut(progress)) * (3 + (index % 4) * 2)

      return styled(cell, grid, options, {
        column: mix(center.column + Math.cos(angle) * radius, cell.column, easeInOut(progress)),
        row: mix(center.row + Math.sin(angle) * radius * 0.5, cell.row, easeInOut(progress)),
      })
    }),
    particles: [],
  }))
}

function createScatteredEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const plan = plans[index]
      return styled(cell, grid, options, {
        column: mix(plan.edgeColumn, cell.column, easeInOut(progress)),
        row: mix(plan.edgeRow, cell.row, easeInOut(progress)),
      })
    }),
    particles: [],
  }))
}

function createSliceEffect({ grid, options }) {
  const middle = (grid.rows - 1) / 2

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell) => {
      const offset = (1 - easeOut(progress)) * grid.columns
      return styled(cell, grid, options, {
        column: cell.column + (cell.row <= middle ? -offset : offset),
      })
    }),
    particles: [],
  }))
}

function createSlideEffect({ grid, options }) {
  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell) =>
      styled(cell, grid, options, {
        column: mix(cell.column - grid.columns - 2, cell.column, easeOut(progress)),
      }),
    ),
    particles: [],
  }))
}

function createSmokeEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress) => {
    const smokeCenter = progress * (grid.columns + 10) - 5
    return {
      cells: grid.visibleCells.flatMap((cell) =>
        cell.column < smokeCenter
          ? styled(cell, grid, options, { alpha: clamp((smokeCenter - cell.column) / 4) })
          : [],
      ),
      particles: plans.slice(0, 45).map((plan, index) => ({
        alpha: Math.sin(progress * Math.PI) * (0.25 + plan.value * 0.6),
        character: index % 3 === 0 ? '░' : plan.value > 0.5 ? '▒' : '·',
        color: mixColors('#293047', '#b8c0d9', plan.value2),
        column: smokeCenter - 5 + plan.value * 10 + Math.sin(progress * 8 + plan.angle) * 2,
        row: (plan.value2 * grid.rows + plan.drift * progress * 2 + grid.rows) % grid.rows,
      })),
    }
  })
}

function createSpotlightsEffect({ grid, options }) {
  return renderer(grid, options, (progress) => {
    const lights = [
      { column: (0.1 + progress * 0.8) * grid.columns, row: (0.25 + Math.sin(progress * 7) * 0.2) * grid.rows },
      { column: (0.9 - progress * 0.8) * grid.columns, row: (0.7 + Math.cos(progress * 6) * 0.2) * grid.rows },
    ]
    const expand = clamp((progress - 0.72) / 0.28)

    return {
      cells: grid.visibleCells.flatMap((cell) => {
        const light = Math.max(...lights.map((spotlight) => {
          const dx = (cell.column - spotlight.column) / 5
          const dy = (cell.row - spotlight.row) / 2.5
          return clamp(1 - Math.hypot(dx, dy))
        }), expand)
        return light > 0
          ? styled(cell, grid, options, {
              alpha: light,
              color: mixColors('#4b5064', cellColor(cell, grid, options), light),
              glow: light * 8,
            })
          : []
      }),
      particles: [],
    }
  })
}

function createSprayEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)
  const origin = gridCenter(grid)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const local = stagger(progress, index, grid.visibleCells.length, 0.6)
      const plan = plans[index]
      return styled(cell, grid, options, {
        alpha: clamp(local * 3),
        column: mix(origin.column + Math.cos(plan.angle) * plan.distance, cell.column, easeOut(local)),
        row: mix(origin.row + Math.sin(plan.angle) * plan.distance * 0.5, cell.row, easeOut(local)),
      })
    }),
    particles: [],
  }))
}

function createSwarmEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const plan = plans[index]
      const local = easeInOut(progress)
      const orbit = (1 - local) * (2 + (index % 5))
      return styled(cell, grid, options, {
        column: mix(plan.edgeColumn, cell.column, local) + Math.cos(progress * 12 + plan.angle) * orbit,
        row: mix(plan.edgeRow, cell.row, local) + Math.sin(progress * 10 + plan.angle) * orbit * 0.35,
      })
    }),
    particles: [],
  }))
}

function createSweepEffect({ grid, options }) {
  return renderer(grid, options, (progress) => {
    const reveal = clamp(progress * 2)
    const colorPass = clamp(progress * 2 - 1)

    return {
      cells: grid.visibleCells.flatMap((cell) => {
        const position = (cell.column + cell.row) / (grid.columns + grid.rows)
        if (position > reveal) return []
        const colored = clamp((colorPass - position) * 8)
        return styled(cell, grid, options, {
          color: mixColors('#6b7085', cellColor(cell, grid, options), colored),
          glow: (1 - colored) * 3,
        })
      }),
      particles: [],
    }
  })
}

function createSynthGridEffect({ grid, options }) {
  return renderer(grid, options, (progress, elapsed) => {
    const tick = Math.floor(elapsed / 100)
    return {
      cells: grid.visibleCells.map((cell) => {
        const local = clamp(progress * 1.4 - (cell.row + cell.column) / (grid.rows + grid.columns) * 0.4)
        return styled(cell, grid, options, {
          character: local < 0.72 ? (cell.index + tick) % 3 === 0 ? '┼' : '·' : cell.character,
          color: local < 0.72 ? '#8a5cff' : cellColor(cell, grid, options),
          glow: local < 0.72 ? 8 : 0,
        })
      }),
      particles: [],
    }
  })
}

function createThunderstormEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)

  return renderer(grid, options, (progress, elapsed) => {
    const flash = Math.floor(elapsed / 110) % 13 === 0 && progress < 0.82
    const cells = grid.visibleCells.map((cell) =>
      styled(cell, grid, options, {
        color: flash ? '#ffffff' : cellColor(cell, grid, options),
        glow: flash ? 20 : 0,
      }),
    )
    const particles = plans.slice(0, 34).map((plan, index) => ({
      alpha: 1 - progress,
      character: index % 8 === 0 && flash ? '╱' : '│',
      color: flash && index % 8 === 0 ? '#ffffff' : '#5876a8',
      column: plan.value * grid.columns,
      row: (progress * (8 + plan.distance) + plan.value2 * grid.rows) % (grid.rows + 4) - 2,
    }))

    return { cells, particles }
  })
}

function createUnstableEffect({ grid, random, options }) {
  const plans = createPlans(grid.visibleCells, random)
  const center = gridCenter(grid)

  return renderer(grid, options, (progress) => ({
    cells: grid.visibleCells.map((cell, index) => {
      const plan = plans[index]
      if (progress < 0.32) {
        const shake = 1 - progress / 0.32
        return styled(cell, grid, options, {
          column: cell.column + Math.sin(progress * 70 + plan.angle) * shake,
          row: cell.row + Math.cos(progress * 60 + plan.angle) * shake * 0.4,
        })
      }

      const settle = easeInOut((progress - 0.32) / 0.68)
      const blast = Math.sin(settle * Math.PI)
      return styled(cell, grid, options, {
        column: mix(center.column + Math.cos(plan.angle) * plan.distance * blast, cell.column, settle),
        row: mix(center.row + Math.sin(plan.angle) * plan.distance * blast * 0.5, cell.row, settle),
      })
    }),
    particles: [],
  }))
}

function createVhsTapeEffect({ grid, random, options }) {
  const rowNoise = Array.from({ length: grid.rows }, () => random() * Math.PI * 2)

  return renderer(grid, options, (progress, elapsed) => {
    const intensity = Math.sin(progress * Math.PI)
    return {
      cells: grid.visibleCells.map((cell) => {
        const glitch = Math.sin(elapsed / 45 + rowNoise[cell.row]) > 0.72
        return styled(cell, grid, options, {
          alpha: glitch ? 0.65 : 1,
          column: cell.column + (glitch ? Math.sin(elapsed / 18 + cell.row) * 2.5 * intensity : 0),
          color: glitch ? (cell.row % 2 ? '#ff4d8d' : '#00d1ff') : cellColor(cell, grid, options),
        })
      }),
      particles: [],
    }
  })
}

function createWavesEffect({ grid, options }) {
  return renderer(grid, options, (progress) => {
    const front = progress * (grid.columns + 8) - 4
    return {
      cells: grid.visibleCells.flatMap((cell) => {
        const distance = front - cell.column
        if (distance < -4) return []
        const wave = distance < 5 ? Math.sin((cell.column - front) * 1.2) * (1 - clamp(distance / 5)) : 0
        return styled(cell, grid, options, {
          alpha: clamp((distance + 4) / 3),
          row: cell.row + wave,
          glow: Math.abs(wave) * 6,
        })
      }),
      particles: [],
    }
  })
}

function effect(name, description, factory) {
  return { description, factory, name }
}

function renderer(grid, options, render) {
  return {
    render(progress, elapsed = 0) {
      const safeProgress = clamp(progress)
      if (safeProgress >= 1) {
        return finalState(grid, options)
      }
      return render(safeProgress, elapsed)
    },
  }
}

function finalState(grid, options) {
  return {
    beam: null,
    cells: grid.visibleCells.map((cell) => styled(cell, grid, options)),
    particles: [],
  }
}

function styled(cell, grid, options, changes = {}) {
  return {
    ...cell,
    alpha: 1,
    color: cellColor(cell, grid, options),
    glow: 0,
    ...changes,
  }
}

function cellColor(cell, grid, options) {
  return colorAt(options.colors ?? DEFAULT_COLORS, cell.column / Math.max(1, grid.columns - 1))
}

function createPlans(cells, random) {
  return cells.map(() => {
    const angle = random() * Math.PI * 2
    const distance = 3 + random() * 10
    return {
      angle,
      distance,
      drift: random() * 2 - 1,
      edgeColumn: Math.cos(angle) > 0 ? distance + 20 : -distance - 5,
      edgeRow: Math.sin(angle) > 0 ? distance + 12 : -distance - 4,
      value: random(),
      value2: random(),
    }
  })
}

function rankMap(cells) {
  return new Map(cells.map((cell, rank) => [cell.index, rank]))
}

function revealByRank(grid, options, ranks, position, style) {
  return grid.visibleCells.flatMap((cell) => {
    const age = position - ranks.get(cell.index)
    return age > 0 ? styled(cell, grid, options, style(cell, age)) : []
  })
}

function nearestOrder(cells, random) {
  if (cells.length < 2) return [...cells]

  const remaining = new Set(cells.map((cell) => cell.index))
  const byIndex = new Map(cells.map((cell) => [cell.index, cell]))
  const order = []
  let current = cells[Math.floor(random() * cells.length)]

  while (remaining.size > 0) {
    if (!remaining.has(current.index)) {
      current = byIndex.get(remaining.values().next().value)
    }

    order.push(current)
    remaining.delete(current.index)

    let nearestDistance = Number.POSITIVE_INFINITY
    const nearest = []

    for (const index of remaining) {
      const candidate = byIndex.get(index)
      const distance = Math.abs(candidate.column - current.column) + Math.abs(candidate.row - current.row)

      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest.length = 0
        nearest.push(candidate)
      } else if (distance === nearestDistance) {
        nearest.push(candidate)
      }
    }

    if (nearest.length > 0) {
      current = nearest[Math.floor(random() * nearest.length)]
    }
  }

  return order
}

function recentParticles(order, plans, position, colors) {
  const particles = []
  const newest = Math.min(order.length - 1, Math.floor(position))
  const oldest = Math.max(0, newest - 10)

  for (let rank = oldest; rank <= newest; rank += 1) {
    const cell = order[rank]
    const plan = plans[rank]
    const age = clamp((position - rank) / 11)

    for (let index = 0; index < 3; index += 1) {
      const angle = plan.angle + index * 1.7
      particles.push({
        alpha: 1 - age,
        character: PARTICLES[(rank + index) % PARTICLES.length],
        color: colorAt(colors, age),
        column: cell.column + Math.cos(angle) * plan.distance * age * 0.35,
        row: cell.row - Math.sin(angle) * plan.distance * age * 0.2 + age * age * 2,
      })
    }
  }

  return particles
}

function radialParticles(center, plans, progress, colors) {
  return plans.slice(0, 32).map((plan, index) => ({
    alpha: Math.sin(progress * Math.PI) * 0.8,
    character: PARTICLES[index % PARTICLES.length],
    color: colorAt(colors, plan.value),
    column: center.column + Math.cos(plan.angle + progress * 5) * plan.distance * progress,
    row: center.row + Math.sin(plan.angle + progress * 5) * plan.distance * progress * 0.5,
  }))
}

function shuffle(items, random) {
  const result = [...items]

  for (let index = result.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1))
    const current = result[index]
    result[index] = result[next]
    result[next] = current
  }

  return result
}

function gridCenter(grid) {
  return {
    column: (grid.columns - 1) / 2,
    row: (grid.rows - 1) / 2,
  }
}

function glyph(value) {
  return GLYPHS[Math.abs(Math.imul(value + 1, 2654435761)) % GLYPHS.length]
}

function stagger(progress, index, count, spread = 0.5) {
  const delay = (index / Math.max(1, count - 1)) * spread
  return clamp((progress - delay) / (1 - spread))
}

function mix(from, to, progress) {
  return from + (to - from) * clamp(progress)
}

function easeIn(progress) {
  return progress * progress
}

function easeOut(progress) {
  return 1 - (1 - progress) ** 3
}

function easeInOut(progress) {
  return progress < 0.5
    ? 4 * progress ** 3
    : 1 - (-2 * progress + 2) ** 3 / 2
}
