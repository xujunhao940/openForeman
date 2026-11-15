import { useEffect, useRef, type CSSProperties } from "react"

type Cell = {
  x: number
  y: number
  noise: number
  shimmerPhase: number
}

const loopFrames = 241
const frameIntervalMs = 100
const patternCount = 6
const transitionStart = 0.72
const resizeDebounceMs = 90
// 1× is the default; the workspace slider controls playback from 0.5× to 2×.
export const PROJECT_ARTWORK_SPEED = 1
const glyphs = " .,:;irsXA253hMHGS#9B&@"
const palette = ["#3d7650", "#5968c9", "#258b82", "#a76577", "#9a7647", "#53768b"]
const canvasFont = '12px "SFMono-Regular", Consolas, "Liberation Mono", monospace'

function hashString(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createRandom(seed: number) {
  let state = seed || 1
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function smoothstep(value: number) {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

function getDensity(
  form: number,
  x: number,
  y: number,
  noise: number,
  time: number,
  projectPhase: number,
) {
  if (form === 0) {
    const driftX = x - Math.sin(time) * 0.36
    const driftY = y - Math.cos(time) * 0.24
    const core = Math.exp(-(driftX ** 2 * 3.2 + driftY ** 2 * 4.2))
    const tail = Math.exp(-((x + Math.sin(time) * 0.56) ** 2 * 1.5 + (y + Math.cos(time) * 0.36) ** 2 * 8))
    return Math.min(1, core * 0.9 + tail * 0.34 + noise * core * 0.22)
  }

  if (form === 1) {
    const ribbon = Math.sin(x * 4.2 + time) * 0.34
    const counterRibbon = Math.sin(x * 2.8 - time + projectPhase) * 0.27
    const firstLine = Math.max(0, 1 - Math.abs(y - ribbon) * 3.4)
    const secondLine = Math.max(0, 1 - Math.abs(y - counterRibbon) * 3.8) * 0.72
    return Math.min(1, Math.max(firstLine, secondLine) * (0.7 + noise * 0.3))
  }

  if (form === 2) {
    const radius = Math.sqrt((x * 0.86) ** 2 + y ** 2)
    const angle = Math.atan2(y, x)
    const ring = Math.sin(radius * 20 - time + Math.sin(angle * 4 + projectPhase) * 1.2)
    return Math.max(0, 1 - Math.abs(ring) * 1.5) * Math.exp(-radius * 0.62)
  }

  if (form === 3) {
    const radius = Math.sqrt((x * 0.8) ** 2 + y ** 2)
    const angle = Math.atan2(y, x)
    const bloom = 0.48 + Math.sin(angle * 5 + time) * 0.2
    return Math.max(0, 1 - Math.abs(radius - bloom) * 3.4) * (0.7 + noise * 0.3)
  }

  if (form === 4) {
    const columnWave = 0.5 + 0.5 * Math.cos(x * 8 + projectPhase)
    const fallingSignal = 0.5 + 0.5 * Math.cos(y * 8 - time * 2 + x * 2.4)
    return columnWave * fallingSignal * (0.68 + noise * 0.32)
  }

  const contour = Math.sin(x * 3.8 + Math.sin(y * 3.2 + time) * 0.7 + projectPhase)
    + Math.cos(y * 4.3 - time * 2 + projectPhase)
  return Math.max(0, 1 - Math.abs(contour) * 0.72) * (0.72 + noise * 0.28)
}

function createCells(seed: number, columns: number, rows: number): Cell[] {
  const random = createRandom(seed)
  const cells: Cell[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        x: (column / Math.max(1, columns - 1) - 0.5) * 1.64,
        y: (row / Math.max(1, rows - 1) - 0.5) * 1.3,
        noise: random(),
        shimmerPhase: random() * Math.PI * 2,
      })
    }
  }

  return cells
}

export function ProjectArtwork({
  projectId,
  label,
  color: colorOverride,
  speed = PROJECT_ARTWORK_SPEED,
  compact = false,
}: {
  projectId: string
  label: string
  color?: string
  speed?: number
  compact?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const speedRef = useRef(speed)
  const colorRef = useRef(colorOverride)
  speedRef.current = speed
  colorRef.current = colorOverride

  const seed = hashString(projectId)
  const color = colorOverride ?? palette[seed % palette.length]

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    const context = canvas?.getContext("2d", { alpha: true })
    if (!root || !canvas || !context) return

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const projectPhase = ((seed % 1000) / 1000) * Math.PI * 2
    const projectOffset = (seed / 4294967296) * patternCount
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    let cells: Cell[] = []
    let columns = 0
    let rows = 0
    let frame = 0
    let lastFrameAt = 0
    let animationId = 0
    let resizeTimer = 0
    let cssWidth = 0
    let cssHeight = 0

    const draw = () => {
      if (!columns || !rows) return

      const phase = (frame / (loopFrames - 1)) * Math.PI * 2
      const time = phase + projectPhase
      const progress = frame / (loopFrames - 1)
      const scenePosition = projectOffset + progress * patternCount
      const sceneNumber = Math.floor(scenePosition)
      const currentForm = sceneNumber % patternCount
      const nextForm = (currentForm + 1) % patternCount
      const localProgress = scenePosition - sceneNumber
      const transition = smoothstep((localProgress - transitionStart) / (1 - transitionStart))

      context.clearRect(0, 0, cssWidth, cssHeight)
      context.font = canvasFont
      context.textBaseline = "top"
      context.textAlign = "left"
      context.fillStyle = colorRef.current ?? palette[seed % palette.length]

      const metrics = context.measureText("M")
      const cellWidth = metrics.width || 7.2
      const lineHeight = 13.2
      const startX = Math.max(0, (cssWidth - columns * cellWidth) / 2)
      const startY = Math.max(0, (cssHeight - rows * lineHeight) / 2)

      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index]
        const currentDensity = getDensity(currentForm, cell.x, cell.y, cell.noise, time, projectPhase)
        const nextDensity = getDensity(nextForm, cell.x, cell.y, cell.noise, time, projectPhase)
        const density = currentDensity * (1 - transition) + nextDensity * transition
        if (density < 0.3 + cell.noise * 0.15) continue

        const glyphIndex = Math.min(glyphs.length - 1, Math.floor(density * (glyphs.length - 1)))
        const shimmer = 0.92 + (Math.sin(phase + cell.shimmerPhase) + 1) * 0.04
        context.globalAlpha = (0.62 + density * 0.34) * shimmer
        const row = Math.floor(index / columns)
        const column = index - row * columns
        context.fillText(
          glyphs[glyphIndex],
          startX + column * cellWidth,
          startY + row * lineHeight,
        )
      }
      context.globalAlpha = 1
    }

    const resize = (width: number, height: number) => {
      cssWidth = width
      cssHeight = height
      const pixelWidth = Math.max(1, Math.round(width * dpr))
      const pixelHeight = Math.max(1, Math.round(height * dpr))
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.font = canvasFont
      const cellWidth = context.measureText("M").width || 7.2
      const lineHeight = 13.2
      columns = Math.max(1, Math.floor(width / cellWidth))
      rows = Math.max(1, Math.floor(height / lineHeight))
      cells = createCells(seed, columns, rows)
      draw()
    }

    resize(root.clientWidth, root.clientHeight)

    const observer = new ResizeObserver(([entry]) => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        resize(entry.contentRect.width, entry.contentRect.height)
      }, resizeDebounceMs)
    })
    observer.observe(root)

    const animate = (timestamp: number) => {
      if (timestamp - lastFrameAt >= frameIntervalMs / Math.max(0.1, speedRef.current)) {
        frame = (frame + 1) % loopFrames
        lastFrameAt = timestamp
        draw()
      }
      if (!reducedMotion) animationId = window.requestAnimationFrame(animate)
    }

    if (!reducedMotion) animationId = window.requestAnimationFrame(animate)

    return () => {
      observer.disconnect()
      window.clearTimeout(resizeTimer)
      window.cancelAnimationFrame(animationId)
    }
  }, [projectId, seed])

  useEffect(() => {
    colorRef.current = color
  }, [color])

  return (
    <div
      ref={rootRef}
      className={`project-artwork${compact ? " project-artwork-compact" : ""}`}
      style={{ "--art-color": color } as CSSProperties}
    >
      <canvas ref={canvasRef} className="project-artwork-canvas" role="img" aria-label={label} />
    </div>
  )
}
