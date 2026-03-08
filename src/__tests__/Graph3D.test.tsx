import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useUIStore } from '@/stores/uiStore'
import { useGraphStore } from '@/stores/graphStore'
import { MOCK_NODES, MOCK_LINKS } from '@/data/mockGraph'
import { DEFAULT_PHYSICS } from '@/stores/graphStore'

// ── Configurable mock state (module-level variables updated per test) ───────
// Mock factories close over these; tests mutate them directly.
let _intersectResult: { object: any }[] = []
let _numDimensionsCalled = false
let _forceSimulationCalled = false
let _webGLRendererCreated = false
let _useFrameRateCalled = false

// Reset all state between tests
function resetMockState() {
  _intersectResult = []
  _numDimensionsCalled = false
  _forceSimulationCalled = false
  _webGLRendererCreated = false
  _useFrameRateCalled = false
}

// ── Mock Three.js ──────────────────────────────────────────────────────────
vi.mock('three', () => {
  class V3 {
    x = 0; y = 0; z = 0
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this }
    copy(v: any) { this.x = v.x; this.y = v.y; this.z = v.z; return this }
    lerp(v: any, alpha: number) { this.x += (v.x - this.x) * alpha; this.y += (v.y - this.y) * alpha; this.z += (v.z - this.z) * alpha; return this }
  }
  class BufAttr {
    needsUpdate = false
    constructor(public array: any, public itemSize: number) {}
  }
  class BufGeo {
    setAttribute() { return this }
    getAttribute() { return new BufAttr(new Float32Array(0), 3) }
    setFromPoints() { return this }
    dispose() {}
  }
  class Mesh {
    position = new V3()
    scale = { setScalar(_s: number) {} }
    userData: any = {}
    visible = true
    material = { color: { setHex() {} } }
    add() {}
  }
  class Line {
    position = new V3()
    rotation = { z: 0 }
    visible = false
    material = { color: { setHex() {} } }
    computeLineDistances() {}
  }
  class Points {
    position = new V3()
    visible = false
    material = { color: { setHex() {} } }
  }

  return {
    WebGLRenderer: class {
      domElement = (() => {
        try { return document.createElement('canvas') } catch { return {} }
      })()
      constructor() { _webGLRendererCreated = true }
      setPixelRatio() {}
      setSize() {}
      setClearColor() {}
      render() {}
      dispose() {}
    },
    Scene: class { add() {} },
    PerspectiveCamera: class {
      position = new V3()
      aspect = 1
      updateProjectionMatrix() {}
      getWorldDirection(v: any) { return v }
    },
    Vector3: V3,
    Vector2: class { constructor(public x = 0, public y = 0) {} },
    Plane: class {
      setFromNormalAndCoplanarPoint() { return this }
    },
    BufferGeometry: BufGeo,
    BufferAttribute: BufAttr,
    Mesh,
    SphereGeometry: class { dispose() {} },
    OctahedronGeometry: class { dispose() {} },
    MeshBasicMaterial: class { opacity = 1; transparent = true },
    LineBasicMaterial: class {},
    LineDashedMaterial: class { color = { setHex() {} } },
    PointsMaterial: class { color = { setHex() {} } },
    LineSegments: class {},
    Line,
    Points,
    Raycaster: class {
      ray = {
        intersectPlane(_plane: any, target: any) {
          if (target && typeof target.set === 'function') target.set(0, 0, 0)
          return target
        },
      }
      setFromCamera() {}
      intersectObjects() { return _intersectResult }
    },
  }
})

// ── Mock OrbitControls ──────────────────────────────────────────────────────
vi.mock('three/examples/jsm/controls/OrbitControls.js', () => {
  class V3Mock {
    x = 0; y = 0; z = 0
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this }
    lerp(v: any, alpha: number) { this.x += (v.x - this.x) * alpha; return this }
  }
  return {
    OrbitControls: class {
      enableDamping = false
      dampingFactor = 0
      autoRotate = false
      autoRotateSpeed = 0
      enabled = true
      target = new V3Mock()
      update() {}
      dispose() {}
      addEventListener() {}
      removeEventListener() {}
    },
  }
})

// ── Mock CSS2DRenderer ──────────────────────────────────────────────────────
vi.mock('three/examples/jsm/renderers/CSS2DRenderer.js', () => ({
  CSS2DRenderer: class {
    domElement = (() => {
      try { return document.createElement('div') } catch { return {} }
    })()
    setSize() {}
    render() {}
  },
  CSS2DObject: class {
    element: HTMLElement
    position = { set() {} }
    constructor(el: HTMLElement) { this.element = el }
  },
}))

// ── Mock d3-force-3d ────────────────────────────────────────────────────────
vi.mock('d3-force-3d', () => {
  const makeSim = () => ({
    numDimensions(n: number) { if (n === 3) _numDimensionsCalled = true; return this },
    force() { return this },
    on() { return this },
    stop() {},
    alpha() { return this },
    alphaTarget() { return this },
    restart() { return this },
  })
  return {
    forceSimulation: (nodes: any) => {
      _forceSimulationCalled = true
      return makeSim()
    },
    forceLink: () => ({ id: () => ({ strength: () => ({ distance() { return this } }) }), strength() { return this }, distance() { return this } }),
    forceManyBody: () => ({ strength() { return this } }),
    forceCenter: () => ({ strength() { return this } }),
  }
})

// ── Mock useFrameRate ───────────────────────────────────────────────────────
vi.mock('@/hooks/useFrameRate', () => ({
  useFrameRate: () => { _useFrameRateCalled = true },
}))

// ── Stub globals ───────────────────────────────────────────────────────────
vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn(),
})))

// ── Lazy import ─────────────────────────────────────────────────────────────
let Graph3D: typeof import('@/components/graph/Graph3D').default

beforeEach(async () => {
  vi.useFakeTimers()
  resetMockState()

  const mod = await import('@/components/graph/Graph3D')
  Graph3D = mod.default

  useUIStore.setState({
    appState: 'main', centerTab: 'graph',
    selectedDocId: null, theme: 'dark', graphMode: '3d',
  })
  useGraphStore.setState({
    nodes: MOCK_NODES, links: MOCK_LINKS,
    selectedNodeId: null, hoveredNodeId: null,
    physics: { ...DEFAULT_PHYSICS },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('Graph3D — mount', () => {
  it('renders the container div with data-testid="graph-3d"', async () => {
    render(<Graph3D width={800} height={600} />)
    await act(async () => { vi.advanceTimersByTime(50) })
    expect(screen.getByTestId('graph-3d')).toBeInTheDocument()
  })

  it('creates a WebGLRenderer on mount', async () => {
    render(<Graph3D width={800} height={600} />)
    await act(async () => { vi.advanceTimersByTime(50) })
    expect(_webGLRendererCreated).toBe(true)
  })
})

describe('Graph3D — simulation', () => {
  it('initialises d3-force-3d simulation', async () => {
    render(<Graph3D width={800} height={600} />)
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(_forceSimulationCalled).toBe(true)
  })

  it('calls numDimensions(3) for 3D simulation', async () => {
    render(<Graph3D width={800} height={600} />)
    await act(async () => { vi.advanceTimersByTime(100) })
    expect(_numDimensionsCalled).toBe(true)
  })
})

describe('Graph3D — click handling', () => {
  it('mousedown with no raycaster hit does not change selectedNodeId', async () => {
    _intersectResult = []
    render(<Graph3D width={800} height={600} />)
    await act(async () => { vi.advanceTimersByTime(50) })
    const el = screen.getByTestId('graph-3d')
    fireEvent.mouseDown(el, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(el, { clientX: 400, clientY: 300 })
    expect(useGraphStore.getState().selectedNodeId).toBeNull()
  })

  it('mousedown+mouseup with a raycaster hit selects the node and switches to document tab', async () => {
    const firstNode = MOCK_NODES[0]
    _intersectResult = [{
      object: { userData: { nodeId: firstNode.id, docId: firstNode.docId } },
      point: { x: 0, y: 0, z: 0 },
    }]

    render(<Graph3D width={800} height={600} />)
    await act(async () => { vi.advanceTimersByTime(50) })
    const el = screen.getByTestId('graph-3d')
    // mouseDown starts drag, mouseUp with no actual movement → treated as click
    fireEvent.mouseDown(el, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(el, { clientX: 400, clientY: 300 })

    expect(useGraphStore.getState().selectedNodeId).toBe(firstNode.id)
    // Graph3D uses openInEditor on node click → centerTab becomes 'editor'
    expect(useUIStore.getState().centerTab).toBe('editor')
    expect(useUIStore.getState().editingDocId).toBe(firstNode.id)
  })
})

describe('Graph3D — graphMode routing', () => {
  it('calls useFrameRate to enable auto-switch to 2D on low FPS', async () => {
    render(<Graph3D width={800} height={600} />)
    await act(async () => { vi.advanceTimersByTime(50) })
    expect(_useFrameRateCalled).toBe(true)
  })

  it('setGraphMode("2d") switches store to 2D mode', () => {
    useUIStore.getState().setGraphMode('2d')
    expect(useUIStore.getState().graphMode).toBe('2d')
  })
})
