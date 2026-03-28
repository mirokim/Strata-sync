# 3D Graph 노드 클릭 선택 불가 이슈 — 심층 분석

> 분석일: 2026-03-19
> 대상 파일: `src/components/graph/Graph3D.tsx`, `src/hooks/useGraphSimulation3D.ts`
> Three.js 버전: `^0.175.0`

---

## 1. 요약

3D 그래프에서 노드를 클릭해도 선택이 되지 않는 이슈의 **주요 원인은 `InstancedMesh`의 `boundingSphere` 캐싱 문제**이다. Three.js의 `InstancedMesh.raycast()`는 최초 호출 시 `boundingSphere`를 한 번 계산한 뒤 영구 캐싱하는데, force simulation이 노드 위치를 업데이트해도 이 캐시가 갱신되지 않아 raycasting이 실패한다.

보조적으로, 최근 커밋되지 않은 변경에서 `orbitChangedRef` 가드가 제거되어 카메라 회전과 클릭 간의 구분 로직이 사라진 점도 동작 변경에 기여한다.

---

## 2. 클릭 처리 흐름 (정상 동작 기준)

```
사용자 마우스 클릭
    │
    ├─ [1] pointerdown → handleMouseDown (line 883)
    │       • nodeWasDraggedRef = false (리셋)
    │       • Raycaster로 instancedMeshArrayRef 교차 검사
    │       • 노드 히트 시: dragging 상태 설정, OrbitControls 비활성화
    │
    ├─ [2] pointerup → handleMouseUp (line 977)
    │       • 드래그 상태 해제, OrbitControls 재활성화
    │
    └─ [3] click → handleCanvasClick (line 1018)
            • nodeWasDraggedRef 가드 체크
            • Raycaster로 instancedMeshArrayRef 교차 검사
            • 히트 시: setSelectedNode(nodeId), setSelectedDoc(docId)
            • 툴팁 표시 (싱글클릭) 또는 에디터 열기 (더블클릭)
```

---

## 3. 근본 원인: InstancedMesh BoundingSphere 캐싱

### 3.1 Three.js의 내부 동작

`InstancedMesh.raycast()` 메서드는 개별 인스턴스를 검사하기 전에 **전체 BoundingSphere 검사**를 수행한다:

```typescript
// three.js 내부 (InstancedMesh.raycast)
if (this.boundingSphere === null) this.computeBoundingSphere();
_sphere.copy(this.boundingSphere).applyMatrix4(matrixWorld);
if (raycaster.ray.intersectsSphere(_sphere) === false) return;  // ← 여기서 탈락
// ... 개별 인스턴스 검사 (여기까지 도달하지 못함)
```

- `computeBoundingSphere()`는 **최초 raycast 호출 시 1회만 실행**
- `instanceMatrix.needsUpdate = true`는 GPU 버퍼 업로드만 트리거하며 **boundingSphere를 무효화하지 않음**
- 한 번 계산된 boundingSphere는 명시적으로 `null` 설정하지 않는 한 영구 캐싱

### 3.2 문제 발생 시나리오 (타임라인)

```
[t=0ms]   Scene setup effect 실행
           └─ setupNode(): 모든 인스턴스 위치 = (0, 0, 0)     ← 초기 위치
           └─ instancedMeshArrayRef 설정 완료

[t=5ms]   d3-force-3d 비동기 import 시작

[t=10ms]  이벤트 리스너 등록 (pointermove, click 등)

[t=20ms]  d3-force-3d 로드 완료 → simulation 시작
           └─ 노드 초기 위치: random ±40 (useGraphSimulation3D line 57-61)

[t=20~50ms] 사용자 마우스가 캔버스 위에 있으면
            pointermove → handleMouseMove → RAF에서 raycast
            ┌────────────────────────────────────────────────┐
            │ computeBoundingSphere() 호출!                   │
            │ 노드 위치: (0,0,0) 또는 시뮬레이션 초기 위치    │
            │ → 매우 작은 boundingSphere 생성 → 영구 캐싱    │
            └────────────────────────────────────────────────┘

[t=2000~5000ms] Simulation 수렴
           └─ 노드들이 ±100~200 범위로 퍼짐
           └─ 캐싱된 boundingSphere 범위를 초과

[t=사용자 클릭] handleCanvasClick → raycasterRef.intersectObjects()
           └─ boundingSphere 체크: ray가 작은 캐싱된 sphere에 교차하지 않음
           └─ return (0 hits) → 클릭 무시됨
```

### 3.3 코드 내 증거

**setupNode (line 313):** 모든 인스턴스 초기 위치 (0,0,0)
```typescript
dummy.position.set(0, 0, 0)  // ← 모든 노드가 원점에서 시작
dummy.scale.setScalar(scaledRadius)
dummy.updateMatrix()
iMesh.setMatrixAt(idx, dummy.matrix)
```

**handleTick (line 144-158):** Simulation tick마다 위치 업데이트하지만 boundingSphere 미갱신
```typescript
for (const n of simNodes) {
  data.pos.set(x, y, z)
  dummy.position.set(x, y, z)
  dummy.updateMatrix()
  data.iMesh.setMatrixAt(data.idx, dummy.matrix)
}
// instanceMatrix.needsUpdate = true만 설정 — boundingSphere는 갱신 안 됨
```

**hover detection (line 964-966):** 마우스 이동 시 raycast → boundingSphere 최초 계산 트리거 가능
```typescript
requestAnimationFrame(() => {
  const hits = raycasterRef.current.intersectObjects(instancedMeshArrayRef.current)
  // ↑ 이 시점에 boundingSphere가 null이면 computeBoundingSphere() 호출
})
```

**`computeBoundingSphere()` 또는 `boundingSphere = null`**: 전체 코드에서 **단 한 번도 호출/설정되지 않음** (Grep 검색 결과 0건)

### 3.4 왜 항상 재현되지 않는가

- 사용자가 그래프 로드 후 **마우스를 움직이지 않고 충분히 기다린 뒤** 클릭하면, 첫 raycast가 수렴된 위치에서 발생하므로 boundingSphere가 정확
- 사용자가 **로드 직후 마우스를 이동**하면 hover 감지에서 stale한 boundingSphere가 계산되어 이후 모든 raycast 실패
- 그래프가 재구성(nodes/links 변경)되면 새 InstancedMesh가 생성되어 boundingSphere가 리셋되므로 일시적으로 해결

---

## 4. 보조 원인: `orbitChangedRef` 가드 제거

### 4.1 변경 내용 (미커밋 diff)

```diff
- const orbitChangedRef = useRef(false)
  const nodeWasDraggedRef = useRef(false)

  // OrbitControls 'change' 핸들러:
- orbitChangedRef.current = true
  // (삭제됨)

  // handleMouseDown:
- orbitChangedRef.current = false
  nodeWasDraggedRef.current = false

  // handleCanvasClick:
- if (orbitChangedRef.current) { orbitChangedRef.current = false; return }
  if (nodeWasDraggedRef.current) { ... }
```

### 4.2 영향 분석

| 상황 | 이전 동작 | 현재 동작 |
|------|----------|----------|
| 순수 클릭 (이동 없음) | 선택 O | 선택 O |
| 카메라 회전 중 클릭 | **차단** (orbitChanged 가드) | **선택 시도** (가드 없음) |
| 노드 드래그 후 클릭 | 차단 (nodeWasDragged 가드) | 차단 (동일) |
| autoRotate 중 클릭 | change 이벤트 → 잠재적 차단 | 제한 없이 통과 |

- `orbitChangedRef` 제거는 클릭이 **더 잘 통과하게** 만듦 (가드 제거)
- 따라서 "클릭이 안 됨"의 직접 원인은 아님
- 단, 카메라 회전과 클릭을 구분하지 못해 **의도하지 않은 선택이 발생**할 수 있음

---

## 5. 검증된 정상 동작 영역

| 항목 | 상태 | 근거 |
|------|------|------|
| click 이벤트 리스너 등록 | 정상 | `renderer.domElement.addEventListener('click', onClick)` (line 530) |
| Ref 패턴으로 최신 콜백 보장 | 정상 | `handleCanvasClickRef` 패턴 (line 1095) |
| CSS 레이어 pointerEvents | 정상 | CSS2DRenderer, label div, NodeTooltip 모두 `pointerEvents: 'none'` |
| preventDefault / stopPropagation | 정상 | Graph3D에서 click 관련 차단 없음 (webglcontextlost에만 사용) |
| NDC 좌표 변환 | 정상 | `getBoundingClientRect()` 기반 정확한 변환 (line 838-843) |
| nodeIdFromHit 인스턴스 ID 해석 | 정상 | sphereInstancedRef/octaInstancedRef 기반 정확한 매핑 (line 847-852) |
| 스토어 상태 업데이트 | 정상 | `setSelectedNode(nodeId)` → graphStore 반영 (line 1046) |
| 드래그 가드 로직 | 정상 | 4px 임계값 기반 클릭/드래그 구분 (line 937-941) |

---

## 6. 수정 방안

### 6.1 [필수] BoundingSphere 무효화 추가

**handleTick**에서 인스턴스 매트릭스 업데이트 후 boundingSphere를 무효화:

```typescript
// src/components/graph/Graph3D.tsx — handleTick 함수 끝부분 (line 157-158 이후)
if (sphereDirty && sphereInstancedRef.current) {
  sphereInstancedRef.current.instanceMatrix.needsUpdate = true
  sphereInstancedRef.current.boundingSphere = null        // ← 추가
}
if (octaDirty && octaInstancedRef.current) {
  octaInstancedRef.current.instanceMatrix.needsUpdate = true
  octaInstancedRef.current.boundingSphere = null          // ← 추가
}
```

**성능 고려**: `computeBoundingSphere()`는 모든 인스턴스를 순회하므로 매 raycast마다 호출되면 비용이 있다. 하지만 raycast는 사용자 인터랙션 시에만 발생하므로 (hover, click) 실제 영향은 미미하다. 시뮬레이션이 수렴한 뒤에는 `sphereDirty`가 false이므로 불필요한 무효화도 없다.

### 6.2 [권장] `orbitChangedRef` 가드 복원

카메라 회전과 클릭을 구분하기 위해 제거된 가드를 복원:

```typescript
// Ref 선언
const orbitChangedRef = useRef(false)

// OrbitControls 'change' 핸들러
const onControlsChange = () => {
  renderBudgetRef.current = Math.max(renderBudgetRef.current, 10)
  orbitChangedRef.current = true  // ← 복원
}

// handleMouseDown
orbitChangedRef.current = false  // ← 복원

// handleCanvasClick (첫 번째 가드)
if (orbitChangedRef.current) { orbitChangedRef.current = false; return }  // ← 복원
```

### 6.3 [선택] 추가 안전장치

시뮬레이션 수렴 시에만 boundingSphere를 재계산하는 최적화:

```typescript
// useGraphSimulation3D.ts — simulation 'end' 이벤트에서 콜백
sim.on('end', () => {
  // simulation이 수렴하면 boundingSphere를 한 번만 갱신
  onConvergeRef.current?.()
})
```

---

## 7. 진단 방법 (디버그 로그 활용)

현재 코드에 `console.debug` 문이 포함되어 있어 DevTools Console에서 진단 가능:

### 7.1 콘솔 확인 항목

```
[G3D] click: dragged=false meshes=2 → meshes가 0이면 instancedMeshArrayRef 비어있음
[G3D] click: ndc=(0.15,-0.23) hits=0 → hits=0이면 raycast 실패 (boundingSphere 문제)
[G3D] down: ndc=(0.15,-0.23) meshes=2 hits=0 → mouseDown에서도 동일 증상 확인
```

### 7.2 수동 검증 코드 (DevTools에서 실행)

```javascript
// 1. InstancedMesh 배열 상태 확인
// (Graph3D 컴포넌트의 instancedMeshArrayRef.current)
// DevTools에서 React DevTools로 확인 가능

// 2. BoundingSphere 상태 확인
// 브라우저 콘솔에서 Three.js scene 접근:
const mesh = scene.children.find(c => c.isInstancedMesh)
console.log('boundingSphere:', mesh.boundingSphere)
console.log('instance count:', mesh.count)
```

---

## 8. 관련 파일 목록

| 파일 | 역할 |
|------|------|
| `src/components/graph/Graph3D.tsx` | 3D 그래프 렌더링, 이벤트 핸들링 |
| `src/hooks/useGraphSimulation3D.ts` | d3-force-3d 시뮬레이션 관리 |
| `src/stores/graphStore.ts` | selectedNodeId 상태 관리 |
| `src/components/graph/GraphPanel.tsx` | Graph3D 컴포넌트 마운트 |
| `src/components/graph/NodeTooltip.tsx` | 노드 툴팁 표시 |
