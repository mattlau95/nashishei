import { useRef, useState, useEffect, useCallback } from 'react'

const MIN_SCALE = 1
const MAX_SCALE = 8
const DRAG_THRESHOLD_PX = 5

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function clampTranslation(tx: number, ty: number, scale: number, w: number, h: number) {
  return {
    tx: clamp(tx, -(scale - 1) * w, 0),
    ty: clamp(ty, -(scale - 1) * h, 0),
  }
}

type ZoomState = { scale: number; tx: number; ty: number }

type GestureRef = {
  pointers: Map<number, { x: number; y: number }>
  pinchActive: boolean
  pinch0: { dist: number; scale: number; midX: number; midY: number; tx: number; ty: number }
  panActive: boolean
  pan0: { clientX: number; clientY: number; tx: number; ty: number; moved: boolean }
}

export function useZoomPan(opts: {
  containerRef: React.RefObject<HTMLDivElement>
  disabled?: boolean
}) {
  const { containerRef, disabled } = opts
  const [state, setState] = useState<ZoomState>({ scale: 1, tx: 0, ty: 0 })
  // Keep a ref mirror so gesture handlers always see current values without stale closures
  const stateRef = useRef(state)
  stateRef.current = state

  const gesture = useRef<GestureRef>({
    pointers: new Map(),
    pinchActive: false,
    pinch0: { dist: 0, scale: 1, midX: 0, midY: 0, tx: 0, ty: 0 },
    panActive: false,
    pan0: { clientX: 0, clientY: 0, tx: 0, ty: 0, moved: false },
  })

  const reset = useCallback(() => {
    setState({ scale: 1, tx: 0, ty: 0 })
  }, [])

  const getContainerOrigin = () => {
    const r = containerRef.current?.getBoundingClientRect()
    return r ? { ox: r.left, oy: r.top, w: r.width, h: r.height } : null
  }

  // Compute new tx/ty so that the screen point (cx, cy) stays fixed after changing scale
  function zoomAround(cx: number, cy: number, newScale: number, cur: ZoomState, ox: number, oy: number, w: number, h: number): ZoomState {
    const clamped = clamp(newScale, MIN_SCALE, MAX_SCALE)
    const imgX = (cx - ox - cur.tx) / cur.scale
    const imgY = (cy - oy - cur.ty) / cur.scale
    const rawTx = (cx - ox) - imgX * clamped
    const rawTy = (cy - oy) - imgY * clamped
    const { tx, ty } = clampTranslation(rawTx, rawTy, clamped, w, h)
    return { scale: clamped, tx, ty }
  }

  // ── wheel (desktop trackpad pinch / ctrl+scroll) ────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey) return
      e.preventDefault()
      const origin = getContainerOrigin()
      if (!origin) return
      const { ox, oy, w, h } = origin
      const cur = stateRef.current
      // deltaY in pixels (deltaMode 0) or lines (deltaMode 1)
      const delta = e.deltaMode === 1 ? e.deltaY * 0.1 : e.deltaY * 0.01
      const factor = Math.exp(-delta * 0.3)
      setState(zoomAround(e.clientX, e.clientY, cur.scale * factor, cur, ox, oy, w, h))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [containerRef])

  // ── pointer handlers (pinch + pan) ─────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent) {
    const g = gesture.current
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (g.pointers.size === 2) {
      // Cancel any single-finger pan in progress and switch to pinch
      g.panActive = false
      const pts = [...g.pointers.values()]
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const midX = (pts[0].x + pts[1].x) / 2
      const midY = (pts[0].y + pts[1].y) / 2
      const cur = stateRef.current
      g.pinchActive = true
      g.pinch0 = { dist, scale: cur.scale, midX, midY, tx: cur.tx, ty: cur.ty }
    } else if (g.pointers.size === 1 && !disabled) {
      const cur = stateRef.current
      g.panActive = true
      g.pan0 = { clientX: e.clientX, clientY: e.clientY, tx: cur.tx, ty: cur.ty, moved: false }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (g.pinchActive && g.pointers.size >= 2) {
      const origin = getContainerOrigin()
      if (!origin) return
      const { ox, oy, w, h } = origin
      const pts = [...g.pointers.values()]
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
      const midX = (pts[0].x + pts[1].x) / 2
      const midY = (pts[0].y + pts[1].y) / 2
      const p0 = g.pinch0
      const newScale = clamp(p0.scale * (dist / p0.dist), MIN_SCALE, MAX_SCALE)

      // Zoom around the initial pinch midpoint (stable feel)
      const imgX = (p0.midX - ox - p0.tx) / p0.scale
      const imgY = (p0.midY - oy - p0.ty) / p0.scale
      const rawTx = (p0.midX - ox) - imgX * newScale + (midX - p0.midX)
      const rawTy = (p0.midY - oy) - imgY * newScale + (midY - p0.midY)
      const { tx, ty } = clampTranslation(rawTx, rawTy, newScale, w, h)
      setState({ scale: newScale, tx, ty })
      return
    }

    if (g.panActive && g.pointers.size === 1) {
      const origin = getContainerOrigin()
      if (!origin) return
      const { w, h } = origin
      const p0 = g.pan0
      const dx = e.clientX - p0.clientX
      const dy = e.clientY - p0.clientY
      if (!p0.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      g.pan0.moved = true
      const cur = stateRef.current
      const { tx, ty } = clampTranslation(p0.tx + dx, p0.ty + dy, cur.scale, w, h)
      setState((s) => ({ ...s, tx, ty }))
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current
    g.pointers.delete(e.pointerId)

    if (g.pointers.size < 2) {
      g.pinchActive = false
    }
    if (g.pointers.size === 0) {
      g.panActive = false
    }
  }

  const transformStyle: React.CSSProperties = {
    transform: `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`,
    transformOrigin: '0 0',
  }

  return {
    scale: state.scale,
    transformStyle,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    } as const,
    reset,
  }
}
