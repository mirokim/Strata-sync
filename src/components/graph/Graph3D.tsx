import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { useGraphStore } from '@/stores/graphStore'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useVaultStore } from '@/stores/vaultStore'
import { parseVaultFilesAsync } from '@/lib/markdownParser'
import { buildGraph } from '@/lib/graphBuilder'
import type { LoadedDocument } from '@/types'
import { useGraphSimulation3D, type SimNode3D, type SimLink3D } from '@/hooks/useGraphSimulation3D'
import { useFrameRate } from '@/hooks/useFrameRate'
import { graphCallbacks } from '@/lib/graphEvents'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'
import { buildNodeColorMap, getNodeColor, lightenColor, degreeScaleFactor, degreeSize, DEGREE_LIGHT_MAX } from '@/lib/nodeColors'
import type { GraphLink } from '@/types'
import NodeTooltip from './NodeTooltip'

interface Props {
  width: number
  height: number
}

const NODE_RADIUS = 4
const RING_SEGMENTS = 64
// Default edge color: #444444 normalised to [0,1]
const EDGE_DEF_R = 0x44 / 0xff
const EDGE_DEF_G = 0x44 / 0xff
const EDGE_DEF_B = 0x44 / 0xff

export default function Graph3D({ width, height }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const css2dRendererRef = useRef<CSS2DRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const nodeMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const lineGeoRef = useRef<THREE.BufferGeometry | null>(null)
  const linePosRef = useRef<Float32Array | null>(null)
  const lineColorArrayRef = useRef<Float32Array | null>(null)
  const lineColorAttrRef = useRef<THREE.BufferAttribute | null>(null)
  const lineMatRef = useRef<THREE.LineBasicMaterial | null>(null)
  const rafRef = useRef<number>(0)
  const selRingRef = useRef<THREE.Line | null>(null)
  const particlesRef = useRef<THREE.Points | null>(null)
  const particlePosRef = useRef<Float32Array | null>(null)
  const particleOffsets = useRef<Float32Array | null>(null)
  const tickRef = useRef(0)
  const raycasterRef = useRef(new THREE.Raycaster())
  // AI highlight: set of node IDs currently being scanned (updated via effect)
  const aiHighlightRef = useRef<Set<string>>(new Set())
  // Previous AI highlight set — used for delta-only scale updates in animation loop
  const prevAiHighlightRef = useRef<Set<string>>(new Set())
  // Individual label divs for per-node visibility control (hover-based labels)
  const labelDivsRef = useRef<Map<string, HTMLElement>>(new Map())
  // Auto-rotate idle timer: resumes autoRotate 10s after last user interaction
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Drag state
  const draggingNodeIdRef = useRef<string | null>(null)
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane())
  const isDraggingRef = useRef(false)
  // Hover: local ref avoids store updates on every mousemove frame
  const lastHoveredRef = useRef<string | null>(null)
  // Adjacency map: nodeId → Set<linkIndex>
  const adjacencyRef = useRef<Map<string, Set<number>>>(new Map())
  // Raycasting throttle: queue one RAF per frame, skip intermediate mousemove events
  const rafScheduledRef = useRef(false)
  const pendingMousePosRef = useRef<{ x: number; y: number } | null>(null)
  // Previous hover state for delta-only neighbor updates (O(k) instead of O(n+e))
  interface HoverState { neighborIds: Set<string>; neighborLinkIdxs: Set<number> }
  const prevHoverStateRef = useRef<HoverState | null>(null)

  const { nodes, links, selectedNodeId, hoveredNodeId, setSelectedNode, setHoveredNode, setNodes, setLinks, physics, aiHighlightNodeIds, setGraphLayoutReady } = useGraphStore()
  const { setSelectedDoc, setCenterTab, centerTab, nodeColorMode, openInEditor } = useUIStore()
  const { vaultPath, loadedDocuments, setLoadedDocuments } = useVaultStore()
  const showNodeLabels = useSettingsStore(s => s.showNodeLabels)
  const isFast = useSettingsStore(s => s.paragraphRenderQuality === 'fast')
  const isFastRef = useRef(isFast)
  isFastRef.current = isFast
  const tagColors = useSettingsStore(s => s.tagColors)
  const folderColors = useSettingsStore(s => s.folderColors)

  // Build color lookup map whenever nodes or color mode changes
  const nodeColorMap = useMemo(
    () => buildNodeColorMap(nodes, nodeColorMode, tagColors, folderColors),
    [nodes, nodeColorMode, tagColors, folderColors]
  )
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId
  const nodeRadiusRef = useRef(physics.nodeRadius)
  nodeRadiusRef.current = physics.nodeRadius

  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null)

  useFrameRate()

  // ── Update node colors when color mode changes ────────────────────────────
  useEffect(() => {
    const meshMap = nodeMeshesRef.current
    nodes.forEach(node => {
      const mesh = meshMap.get(node.id)
      if (mesh) {
        const mat = mesh.material as THREE.MeshBasicMaterial
        const baseColor = getNodeColor(node, nodeColorMode, nodeColorMap)
        const sf = (mesh.userData.degreeScale as number | undefined) ?? 1
        const lightFactor = (1 - sf) * DEGREE_LIGHT_MAX
        mat.color.set(lightFactor > 0.01 ? lightenColor(baseColor, lightFactor) : baseColor)
      }
    })
  }, [nodes, nodeColorMode, nodeColorMap])

  // ── Build adjacency map whenever links change ──────────────────────────────
  useEffect(() => {
    const map = new Map<string, Set<number>>()
    links.forEach((link: GraphLink, i: number) => {
      const src = typeof link.source === 'string' ? link.source : (link.source as { id: string }).id
      const tgt = typeof link.target === 'string' ? link.target : (link.target as { id: string }).id
      if (!map.has(src)) map.set(src, new Set())
      if (!map.has(tgt)) map.set(tgt, new Set())
      map.get(src)!.add(i)
      map.get(tgt)!.add(i)
    })
    adjacencyRef.current = map
  }, [links])

  // ── Tick: update node mesh positions + edge lines ──────────────────────────
  const handleTick = useCallback((simNodes: SimNode3D[], simLinks: SimLink3D[]) => {
    const meshMap = nodeMeshesRef.current
    for (const n of simNodes) {
      const mesh = meshMap.get(n.id)
      if (mesh) {
        mesh.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
      }
    }

    // Update edge positions
    const pos = linePosRef.current
    if (pos) {
      simLinks.forEach((link, i) => {
        const src = link.source as SimNode3D
        const tgt = link.target as SimNode3D
        const base = i * 6
        pos[base + 0] = src.x ?? 0; pos[base + 1] = src.y ?? 0; pos[base + 2] = src.z ?? 0
        pos[base + 3] = tgt.x ?? 0; pos[base + 4] = tgt.y ?? 0; pos[base + 5] = tgt.z ?? 0
      })
      if (lineGeoRef.current) {
        const attr = lineGeoRef.current.getAttribute('position') as THREE.BufferAttribute
        attr.needsUpdate = true
      }
    }

    // Keep selection ring + particles tracking selected node
    const selId = selectedNodeIdRef.current
    if (selId && selRingRef.current) {
      const n = simNodes.find(x => x.id === selId)
      if (n) {
        selRingRef.current.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
        if (particlesRef.current) {
          particlesRef.current.position.set(n.x ?? 0, n.y ?? 0, n.z ?? 0)
        }
      }
    }
  }, [])

  const { simRef, simNodesRef } = useGraphSimulation3D({ onTick: handleTick })

  // ── Three.js scene setup ───────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // WebGL renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height)
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // CSS2DRenderer — HTML labels on top of WebGL canvas
    const css2dRenderer = new CSS2DRenderer()
    css2dRenderer.setSize(width, height)
    css2dRenderer.domElement.style.position = 'absolute'
    css2dRenderer.domElement.style.top = '0'
    css2dRenderer.domElement.style.left = '0'
    css2dRenderer.domElement.style.pointerEvents = 'none'
    mount.appendChild(css2dRenderer.domElement)
    css2dRendererRef.current = css2dRenderer

    // Scene + camera
    const scene = new THREE.Scene()
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(60, width / height, 1, 5000)
    // Initial position: moderately close — fitCameraToNodes() will adjust after simulation settles
    camera.position.set(0, 0, Math.max(300, Math.sqrt(nodes.length) * 30))
    cameraRef.current = camera

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.4
    const onInteractStart = () => {
      controls.autoRotate = false
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
    const onInteractEnd = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => { controls.autoRotate = true }, 10_000)
    }
    controls.addEventListener('start', onInteractStart)
    controls.addEventListener('end', onInteractEnd)
    controlsRef.current = controls

    // Fit camera so all nodes are visible — called after simulation settles and on reset
    const fitCameraToNodes = () => {
      const meshes = Array.from(nodeMeshesRef.current.values())
      if (meshes.length === 0) return
      let minX = Infinity, maxX = -Infinity
      let minY = Infinity, maxY = -Infinity
      let minZ = Infinity, maxZ = -Infinity
      meshes.forEach(m => {
        minX = Math.min(minX, m.position.x); maxX = Math.max(maxX, m.position.x)
        minY = Math.min(minY, m.position.y); maxY = Math.max(maxY, m.position.y)
        minZ = Math.min(minZ, m.position.z); maxZ = Math.max(maxZ, m.position.z)
      })
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const cz = (minZ + maxZ) / 2
      const spread = Math.max(maxX - minX, maxY - minY, maxZ - minZ)
      const fovRad = (camera.fov * Math.PI) / 180
      // distance to fit spread in FOV with 20% padding
      const dist = Math.max(150, (spread * 0.6) / Math.tan(fovRad / 2))
      controls.target.set(cx, cy, cz)
      camera.position.set(cx, cy, cz + dist)
      controls.update()
    }

    // Register camera reset callback for PhysicsControls
    graphCallbacks.resetCamera = fitCameraToNodes

    // ── Degree map for Obsidian-style node sizing ─────────────────────────
    const degMap = new Map<string, number>()
    links.forEach((l: GraphLink) => {
      const s = typeof l.source === 'string' ? l.source : (l.source as { id: string }).id
      const t = typeof l.target === 'string' ? l.target : (l.target as { id: string }).id
      degMap.set(s, (degMap.get(s) ?? 0) + 1)
      degMap.set(t, (degMap.get(t) ?? 0) + 1)
    })
    const maxDeg3D = Math.max(1, ...degMap.values())

    // ── Nodes ────────────────────────────────────────────────────────────────
    const sphereGeo = new THREE.SphereGeometry(NODE_RADIUS, 16, 12)
    const octaGeo = new THREE.OctahedronGeometry(NODE_RADIUS * 1.25)
    nodes.forEach(node => {
      const color = getNodeColor(node, nodeColorMode, nodeColorMap)
      const deg3d = degMap.get(node.id) ?? 0
      const sf3d = degreeScaleFactor(deg3d, maxDeg3D)
      const baseScale = nodeRadiusRef.current / 7
      const lightFactor = (1 - sf3d) * DEGREE_LIGHT_MAX
      const finalColor = lightFactor > 0.01 ? lightenColor(color, lightFactor) : color
      const mat = new THREE.MeshBasicMaterial({ color: finalColor, transparent: true, opacity: 1.0 })
      const mesh = new THREE.Mesh(node.isImage ? octaGeo : sphereGeo, mat)
      const scaledRadius = baseScale * degreeSize(sf3d)
      mesh.scale.setScalar(scaledRadius)
      mesh.userData.nodeId = node.id
      mesh.userData.docId = node.docId
      mesh.userData.degreeScale = sf3d    // cache for color refresh
      mesh.userData.scaledRadius = scaledRadius  // cache for animation loop
      scene.add(mesh)
      nodeMeshesRef.current.set(node.id, mesh)

      // HTML label via CSS2DObject
      const labelDiv = document.createElement('div')
      labelDiv.textContent = node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label
      labelDiv.style.fontSize = '11px'
      labelDiv.style.fontWeight = 'normal'
      labelDiv.style.color = '#e3e2de'
      labelDiv.style.pointerEvents = 'none'
      labelDiv.style.whiteSpace = 'nowrap'
      labelDiv.style.textShadow = '0 0 6px #000, 0 0 4px #000, 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000'
      labelDiv.style.opacity = useSettingsStore.getState().showNodeLabels ? '0.95' : '0'
      labelDiv.style.userSelect = 'none'
      labelDiv.style.letterSpacing = '0.01em'
      const labelObj = new CSS2DObject(labelDiv)
      labelObj.position.set(0, -NODE_RADIUS - 6, 0)
      mesh.add(labelObj)
      labelDivsRef.current.set(node.id, labelDiv)
    })

    // ── Edges with vertex colors for per-edge highlight ─────────────────────
    const posArray = new Float32Array(links.length * 6)
    linePosRef.current = posArray

    // Vertex color buffer: 2 vertices per edge × 3 RGB components
    const colorArray = new Float32Array(links.length * 6)
    for (let i = 0; i < links.length * 2; i++) {
      colorArray[i * 3 + 0] = EDGE_DEF_R
      colorArray[i * 3 + 1] = EDGE_DEF_G
      colorArray[i * 3 + 2] = EDGE_DEF_B
    }
    lineColorArrayRef.current = colorArray

    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
    const colorAttr = new THREE.BufferAttribute(colorArray, 3)
    lineGeo.setAttribute('color', colorAttr)
    lineColorAttrRef.current = colorAttr
    lineGeoRef.current = lineGeo

    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: physics.linkOpacity })
    lineMatRef.current = lineMat
    const lineSegments = new THREE.LineSegments(lineGeo, lineMat)
    lineSegments.frustumCulled = false  // edges span the whole scene — never cull
    scene.add(lineSegments)

    // ── Selection ring (initially hidden) ─────────────────────────────────────
    const ringPoints: THREE.Vector3[] = []
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2
      ringPoints.push(new THREE.Vector3(Math.cos(angle) * 12, Math.sin(angle) * 12, 0))
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints)
    const ringMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 3, gapSize: 2 })
    const ring = new THREE.Line(ringGeo, ringMat)
    ring.computeLineDistances()
    ring.visible = false
    scene.add(ring)
    selRingRef.current = ring

    // ── Particles ─────────────────────────────────────────────────────────────
    const PARTICLE_COUNT = 20
    const pPos = new Float32Array(PARTICLE_COUNT * 3)
    const offsets = new Float32Array(PARTICLE_COUNT * 3)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      const r = 12 + Math.random() * 8
      offsets[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta)
      offsets[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      offsets[i * 3 + 2] = r * Math.cos(phi)
    }
    particlePosRef.current = pPos
    particleOffsets.current = offsets
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3))
    const pMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2 })
    const pts = new THREE.Points(pGeo, pMat)
    pts.visible = false
    scene.add(pts)
    particlesRef.current = pts

    // ── Animation loop ────────────────────────────────────────────────────────
    function animate() {
      rafRef.current = requestAnimationFrame(animate)
      tickRef.current++

      const selId = selectedNodeIdRef.current
      if (selId) {
        const mesh = nodeMeshesRef.current.get(selId)
        if (mesh) {
          controls.target.lerp(mesh.position, 0.04)
        }
      }

      controls.update()

      if (selRingRef.current?.visible) {
        selRingRef.current.rotation.z += 0.008
      }

      // AI highlight: pulse scale — delta-only updates (O(k) not O(n))
      const aiSet = aiHighlightRef.current
      const prevAiSet = prevAiHighlightRef.current
      if (aiSet.size > 0) {
        const pulseBase = 1 + Math.sin(tickRef.current * 0.06) * 0.3
        aiSet.forEach(nodeId => {
          const mesh = nodeMeshesRef.current.get(nodeId)
          if (mesh) {
            mesh.scale.setScalar((mesh.userData.scaledRadius as number) * pulseBase)
          }
        })
        // Reset nodes that left the highlight set
        prevAiSet.forEach(nodeId => {
          if (!aiSet.has(nodeId)) {
            const mesh = nodeMeshesRef.current.get(nodeId)
            if (mesh) {
              mesh.scale.setScalar(mesh.userData.scaledRadius as number)
            }
          }
        })
      }
      prevAiHighlightRef.current = aiSet

      if (particlesRef.current?.visible && particlePosRef.current && particleOffsets.current) {
        const t = tickRef.current * 0.01
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          const drift = Math.sin(t + i) * 0.5
          pPos[i * 3 + 0] = offsets[i * 3 + 0] + drift
          pPos[i * 3 + 1] = offsets[i * 3 + 1] + drift
          pPos[i * 3 + 2] = offsets[i * 3 + 2]
        }
        ;(pGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
      }

      renderer.render(scene, camera)
      css2dRenderer.render(scene, camera)
    }
    animate()
    // Signal that the 3D scene is initialized and the loading overlay can be dismissed.
    // setNodes() resets this to false; we restore it once the scene is ready to render.
    setGraphLayoutReady(true)

    // Auto-fit after simulation has had time to spread nodes (d3 mostly settles in ~1.5s)
    const autoFitTimer = setTimeout(fitCameraToNodes, 1500)

    return () => {
      graphCallbacks.resetCamera = null
      clearTimeout(autoFitTimer)
      cancelAnimationFrame(rafRef.current)
      prevHoverStateRef.current = null
      controls.removeEventListener('start', onInteractStart)
      controls.removeEventListener('end', onInteractEnd)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      if (css2dRenderer.domElement.parentNode) {
        mount.removeChild(css2dRenderer.domElement)
      }
      css2dRendererRef.current = null
      sphereGeo.dispose()
      octaGeo.dispose()
      lineGeo.dispose()
      ringGeo.dispose()
      pGeo.dispose()
      nodeMeshesRef.current.clear()
      labelDivsRef.current.clear()
      linePosRef.current = null
      lineColorArrayRef.current = null
      lineColorAttrRef.current = null
      lineMatRef.current = null
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
      selRingRef.current = null
      particlesRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, setGraphLayoutReady])

  // ── Resize ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    if (!renderer || !camera) return
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    css2dRendererRef.current?.setSize(width, height)
  }, [width, height])

  // ── Selection ring visibility + stop auto-rotate ──────────────────────────
  useEffect(() => {
    if (!selRingRef.current || !particlesRef.current) return
    const visible = !!selectedNodeId

    if (visible && controlsRef.current) {
      controlsRef.current.autoRotate = false
    }

    selRingRef.current.visible = visible
    particlesRef.current.visible = visible

    if (visible && selectedNodeId) {
      const mesh = nodeMeshesRef.current.get(selectedNodeId)
      if (mesh) {
        selRingRef.current.position.copy(mesh.position)
        particlesRef.current.position.copy(mesh.position)

        const node = nodes.find(n => n.id === selectedNodeId)
        if (node) {
          const hex = SPEAKER_CONFIG[node.speaker].hex
          ;(selRingRef.current.material as THREE.LineDashedMaterial).color.setHex(hex)
          ;(particlesRef.current.material as THREE.PointsMaterial).color.setHex(hex)
        }
      }
    }
  }, [selectedNodeId, nodes])

  // ── Wire opacity live update ──────────────────────────────────────────────
  useEffect(() => {
    if (lineMatRef.current) {
      lineMatRef.current.opacity = physics.linkOpacity
      lineMatRef.current.needsUpdate = true
    }
  }, [physics.linkOpacity])

  // ── Node size live update ─────────────────────────────────────────────────
  useEffect(() => {
    const baseScale = physics.nodeRadius / 7
    nodeMeshesRef.current.forEach(mesh => {
      const sf = (mesh.userData.degreeScale as number | undefined) ?? 1
      const scaledRadius = baseScale * degreeSize(sf)
      mesh.userData.scaledRadius = scaledRadius
      mesh.scale.setScalar(scaledRadius)
    })
  }, [physics.nodeRadius])

  // ── CSS2DRenderer labels: hide only when overlay panel is active ────────────
  useEffect(() => {
    const css2d = css2dRendererRef.current
    if (!css2d) return
    css2d.domElement.style.display = centerTab === 'graph' ? '' : 'none'
  }, [centerTab])

  // ── Per-node label visibility: hidden by default, shown on hover ─────────
  useEffect(() => {
    const divMap = labelDivsRef.current
    if (divMap.size === 0) return
    divMap.forEach((div, nodeId) => {
      if (showNodeLabels) {
        div.style.opacity = ''  // show all (CSS2D default)
      } else {
        div.style.opacity = nodeId === hoveredNodeId ? '1' : '0'
      }
    })
  }, [showNodeLabels, hoveredNodeId])

  // ── AI highlight: sync aiHighlightNodeIds → ref for use in animation loop ──
  useEffect(() => {
    aiHighlightRef.current = new Set(aiHighlightNodeIds)
    if (aiHighlightNodeIds.length === 0) {
      // Reset all node scales to degree-based size when highlights are cleared
      nodeMeshesRef.current.forEach(mesh => {
        mesh.scale.setScalar(mesh.userData.scaledRadius as number)
      })
    }
  }, [aiHighlightNodeIds])

  // ── Neighbor highlight — delta updates: O(k) for hover→hover, O(n+e) for enter/exit null
  useEffect(() => {
    const meshMap = nodeMeshesRef.current
    const colorArray = lineColorArrayRef.current
    const colorAttr = lineColorAttrRef.current

    if (!hoveredNodeId) {
      const prev = prevHoverStateRef.current
      if (prev) {
        // Restore neighbor nodes → full opacity (O(prevK))
        prev.neighborIds.forEach(nodeId => {
          const mesh = meshMap.get(nodeId)
          if (mesh) (mesh.material as THREE.MeshBasicMaterial).opacity = 1.0
        })
        // Restore previously-dimmed nodes → full opacity (O(n - prevK))
        // We must reset all nodes because we don't track which were dimmed
        nodes.forEach(n => {
          if (!prev.neighborIds.has(n.id)) {
            const mesh = meshMap.get(n.id)
            if (mesh) (mesh.material as THREE.MeshBasicMaterial).opacity = 1.0
          }
        })
        // Reset only previously-highlighted link colors → default (O(prevK_links))
        if (colorArray && colorAttr) {
          prev.neighborLinkIdxs.forEach(i => {
            for (let v = 0; v < 2; v++) {
              const base = i * 6 + v * 3
              colorArray[base] = EDGE_DEF_R; colorArray[base + 1] = EDGE_DEF_G; colorArray[base + 2] = EDGE_DEF_B
            }
          })
          colorAttr.needsUpdate = true
        }
      }
      prevHoverStateRef.current = null
      return
    }

    // Resolve neighbor sets (O(k_links))
    const neighborLinkIdxs = adjacencyRef.current.get(hoveredNodeId) ?? new Set<number>()
    const neighborIds = new Set<string>([hoveredNodeId])
    neighborLinkIdxs.forEach(i => {
      const link = links[i] as GraphLink | undefined
      if (!link) return
      neighborIds.add(typeof link.source === 'string' ? link.source : (link.source as { id: string }).id)
      neighborIds.add(typeof link.target === 'string' ? link.target : (link.target as { id: string }).id)
    })

    const hovNode = nodes.find(n => n.id === hoveredNodeId)
    const accentHex = hovNode ? SPEAKER_CONFIG[hovNode.speaker].hex : 0xffffff
    const accentR = ((accentHex >> 16) & 0xff) / 0xff
    const accentG = ((accentHex >> 8) & 0xff) / 0xff
    const accentB = (accentHex & 0xff) / 0xff

    const prev = prevHoverStateRef.current

    if (prev) {
      // Delta update: hover moved from one node to another (O(prevK + newK))
      // Nodes leaving highlight → dim
      prev.neighborIds.forEach(nodeId => {
        if (!neighborIds.has(nodeId)) {
          const mesh = meshMap.get(nodeId)
          if (mesh) (mesh.material as THREE.MeshBasicMaterial).opacity = 0.1
        }
      })
      // Nodes entering highlight → brighten
      neighborIds.forEach(nodeId => {
        if (!prev.neighborIds.has(nodeId)) {
          const mesh = meshMap.get(nodeId)
          if (mesh) (mesh.material as THREE.MeshBasicMaterial).opacity = 1.0
        }
      })
      // Links: reset previously-highlighted, set newly-highlighted
      if (colorArray && colorAttr) {
        prev.neighborLinkIdxs.forEach(i => {
          if (!neighborLinkIdxs.has(i)) {
            for (let v = 0; v < 2; v++) {
              const base = i * 6 + v * 3
              colorArray[base] = 0.04; colorArray[base + 1] = 0.04; colorArray[base + 2] = 0.04
            }
          }
        })
        neighborLinkIdxs.forEach(i => {
          if (!prev.neighborLinkIdxs.has(i)) {
            for (let v = 0; v < 2; v++) {
              const base = i * 6 + v * 3
              colorArray[base] = accentR; colorArray[base + 1] = accentG; colorArray[base + 2] = accentB
            }
          }
        })
        colorAttr.needsUpdate = true
      }
    } else {
      // Initial hover: full pass unavoidable (O(n+e))
      nodes.forEach(n => {
        const mesh = meshMap.get(n.id)
        if (!mesh) return
        ;(mesh.material as THREE.MeshBasicMaterial).opacity = neighborIds.has(n.id) ? 1.0 : 0.1
      })
      if (colorArray && colorAttr) {
        links.forEach((_: GraphLink, i: number) => {
          const isNeighbor = neighborLinkIdxs.has(i)
          for (let v = 0; v < 2; v++) {
            const base = i * 6 + v * 3
            if (isNeighbor) { colorArray[base] = accentR; colorArray[base + 1] = accentG; colorArray[base + 2] = accentB }
            else { colorArray[base] = 0.04; colorArray[base + 1] = 0.04; colorArray[base + 2] = 0.04 }
          }
        })
        colorAttr.needsUpdate = true
      }
    }

    prevHoverStateRef.current = { neighborIds, neighborLinkIdxs }
  }, [hoveredNodeId, nodes, links])

  // ── Helper: screen coords → NDC (Normalized Device Coordinates) ───────────
  const getNDC = useCallback((clientX: number, clientY: number): THREE.Vector2 => {
    const renderer = rendererRef.current
    if (!renderer) return new THREE.Vector2(0, 0)
    const rect = renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
  }, [])

  // ── Global mouseup: release drag even when mouse leaves the component ─────
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (!draggingNodeIdRef.current) return
      const simNode = simNodesRef.current.find(n => n.id === draggingNodeIdRef.current)
      if (simNode) {
        simNode.fx = null
        simNode.fy = null
        simNode.fz = null
      }
      ;(simRef.current as any)?.alphaTarget(0)
      if (controlsRef.current) controlsRef.current.enabled = true
      draggingNodeIdRef.current = null
      isDraggingRef.current = false
      setHoveredNode(null)
      lastHoveredRef.current = null
      setTooltip(null)
      // Schedule auto-rotate resume after dragging outside the component
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        if (controlsRef.current) controlsRef.current.autoRotate = true
      }, 10_000)
    }
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [simNodesRef, simRef, setHoveredNode])

  // ── Mouse down: start drag or just hover ──────────────────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    if (!renderer || !camera) return

    const ndc = getNDC(e.clientX, e.clientY)
    raycasterRef.current.setFromCamera(ndc, camera)

    const meshes = Array.from(nodeMeshesRef.current.values())
    const hits = raycasterRef.current.intersectObjects(meshes)
    if (hits.length === 0) return

    const mesh = hits[0].object as THREE.Mesh
    const nodeId: string = mesh.userData.nodeId

    // Create drag plane: camera-facing, through the hit point
    const camDir = camera.getWorldDirection(new THREE.Vector3())
    dragPlaneRef.current.setFromNormalAndCoplanarPoint(camDir, hits[0].point)

    // Pin the node in the simulation
    const simNode = simNodesRef.current.find(n => n.id === nodeId)
    if (simNode) {
      simNode.fx = simNode.x
      simNode.fy = simNode.y
      simNode.fz = simNode.z
      ;(simRef.current as any)?.alphaTarget(0.3).restart()
    }

    // Disable orbit controls + stop auto-rotate while dragging a node
    if (controlsRef.current) {
      controlsRef.current.enabled = false
      controlsRef.current.autoRotate = false
    }
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)

    draggingNodeIdRef.current = nodeId
    isDraggingRef.current = false

    // Set hover immediately for visual feedback
    if (nodeId !== lastHoveredRef.current) {
      lastHoveredRef.current = nodeId
      setHoveredNode(nodeId)
    }
    setTooltip({ nodeId, x: e.clientX, y: e.clientY })
  }, [getNDC, simNodesRef, simRef, setHoveredNode])

  // ── Mouse move: update drag position OR detect hover (raycasting throttled to 1/frame)
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current
    const camera = cameraRef.current
    if (!renderer || !camera) return

    if (draggingNodeIdRef.current) {
      // Drag: process immediately (no throttle needed — already limited by mouse events)
      isDraggingRef.current = true
      const ndc = getNDC(e.clientX, e.clientY)
      raycasterRef.current.setFromCamera(ndc, camera)
      const intersection = new THREE.Vector3()
      if (raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, intersection)) {
        const simNode = simNodesRef.current.find(n => n.id === draggingNodeIdRef.current)
        if (simNode) {
          simNode.fx = intersection.x; simNode.fy = intersection.y; simNode.fz = intersection.z
          ;(simRef.current as any)?.alphaTarget(0.3).restart()
        }
      }
      setTooltip(null)  // clear tooltip as soon as drag begins
      return
    }

    // Throttle hover raycasting to one per animation frame
    pendingMousePosRef.current = { x: e.clientX, y: e.clientY }
    if (!rafScheduledRef.current) {
      rafScheduledRef.current = true
      requestAnimationFrame(() => {
        rafScheduledRef.current = false
        const pos = pendingMousePosRef.current
        if (!pos || !rendererRef.current || !cameraRef.current) return
        const ndc = getNDC(pos.x, pos.y)
        raycasterRef.current.setFromCamera(ndc, cameraRef.current)
        const meshes = Array.from(nodeMeshesRef.current.values())
        const hits = raycasterRef.current.intersectObjects(meshes)
        const newHoverId = hits.length > 0
          ? (hits[0].object as THREE.Mesh).userData.nodeId as string
          : null
        if (newHoverId !== lastHoveredRef.current) {
          lastHoveredRef.current = newHoverId
          // Fast mode: skip hover effects (no label reveal, no neighbor highlight)
          if (!isFastRef.current) setHoveredNode(newHoverId)
        }
      })
    }
  }, [getNDC, simNodesRef, simRef, setHoveredNode])

  // ── Mouse up: release drag; if no movement happened → treat as click ──────
  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const draggedNodeId = draggingNodeIdRef.current
    const wasActualDrag = isDraggingRef.current

    if (draggedNodeId) {
      // Release the pin
      const simNode = simNodesRef.current.find(n => n.id === draggedNodeId)
      if (simNode) {
        simNode.fx = null
        simNode.fy = null
        simNode.fz = null
      }
      ;(simRef.current as any)?.alphaTarget(0)
      if (controlsRef.current) controlsRef.current.enabled = true
      draggingNodeIdRef.current = null
      isDraggingRef.current = false

      // No movement → treat as click: select node + navigate to document
      if (!wasActualDrag) {
        const mesh = nodeMeshesRef.current.get(draggedNodeId)
        if (mesh) {
          const docId = mesh.userData.docId as string
          setSelectedNode(draggedNodeId)
          setSelectedDoc(docId)

          if (docId.startsWith('_phantom_')) {
            // Phantom node: create the file and open in editor
            const node = nodes.find(n => n.id === docId)
            const label = node?.label ?? docId.replace('_phantom_', '')
            if (vaultPath && window.vaultAPI) {
              const sep = vaultPath.includes('\\') ? '\\' : '/'
              const newPath = `${vaultPath}${sep}${label}.md`
              window.vaultAPI.saveFile(newPath, `# ${label}\n\n`).then(() => {
                return window.vaultAPI!.loadFiles(vaultPath)
              }).then(async ({ files }) => {
                if (!files) return
                const docs = await parseVaultFilesAsync(files) as LoadedDocument[]
                setLoadedDocuments(docs)
                const { nodes: newNodes, links: newLinks } = buildGraph(docs)
                setNodes(newNodes)
                setLinks(newLinks)
                const newDoc = docs.find(d =>
                  d.absolutePath.replace(/\\/g, '/') === newPath.replace(/\\/g, '/')
                )
                if (newDoc) openInEditor(newDoc.id)
              }).catch((e: unknown) => {
                console.error('[Graph3D] phantom node file creation failed:', e)
              })
            }
          } else {
            openInEditor(docId)
          }
        }
      }
    }

    // Clear hover on release (mousemove will re-detect if still hovering)
    setHoveredNode(null)
    lastHoveredRef.current = null
    setTooltip(null)

    // Schedule auto-rotate resume 10s after last node interaction
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      if (controlsRef.current) controlsRef.current.autoRotate = true
    }, 10_000)
  }, [simNodesRef, simRef, setSelectedNode, setSelectedDoc, setCenterTab, setHoveredNode,
      openInEditor, nodes, vaultPath, loadedDocuments, setLoadedDocuments, setNodes, setLinks])

  // ── Mouse leave: clear hover when cursor leaves the 3D area ──────────────
  const handleMouseLeave = useCallback(() => {
    if (draggingNodeIdRef.current) return  // keep hover during drag
    if (lastHoveredRef.current !== null) {
      lastHoveredRef.current = null
      setHoveredNode(null)
      setTooltip(null)
    }
  }, [setHoveredNode])

  return (
    <div
      ref={mountRef}
      style={{
        width,
        height,
        overflow: 'hidden',
        cursor: draggingNodeIdRef.current ? 'grabbing' : 'grab',
        position: 'relative',
      }}
      data-testid="graph-3d"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {tooltip && <NodeTooltip nodeId={tooltip.nodeId} x={tooltip.x} y={tooltip.y} />}
    </div>
  )
}
