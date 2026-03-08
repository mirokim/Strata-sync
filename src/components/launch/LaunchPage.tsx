import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUIStore } from '@/stores/uiStore'
import { SPEAKER_CONFIG } from '@/lib/speakerConfig'

interface Props {
  onComplete: () => void
}

type Stage = 'init' | 'center' | 'nodes' | 'descend' | 'done'

const SATELLITE_COUNT = 8
const RADIUS = 100

// 8 satellite angles evenly spaced
const SATELLITE_ANGLES = Array.from({ length: SATELLITE_COUNT }, (_, i) =>
  (i / SATELLITE_COUNT) * Math.PI * 2
)

// Cycle through speaker colors for satellites
const SPEAKER_KEYS = Object.keys(SPEAKER_CONFIG) as (keyof typeof SPEAKER_CONFIG)[]
const SATELLITE_COLORS = SATELLITE_ANGLES.map((_, i) =>
  SPEAKER_CONFIG[SPEAKER_KEYS[i % SPEAKER_KEYS.length]].color
)

const containerVariants = {
  nodes: {
    transition: { staggerChildren: 0.04, delayChildren: 0.1 },
  },
}

const satelliteVariants = {
  init: (i: number) => ({
    x: 0,
    y: 0,
    opacity: 0,
    scale: 0,
  }),
  nodes: (i: number) => ({
    x: Math.cos(SATELLITE_ANGLES[i]) * RADIUS,
    y: Math.sin(SATELLITE_ANGLES[i]) * RADIUS,
    opacity: 1,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 160, damping: 20 },
  }),
  descend: (i: number) => ({
    x: Math.cos(SATELLITE_ANGLES[i]) * RADIUS,
    y: Math.sin(SATELLITE_ANGLES[i]) * RADIUS,
    opacity: 0.4,
    scale: 0.8,
    transition: { duration: 0.4 },
  }),
}

const centerVariants = {
  init: { scale: 0.3, opacity: 0 },
  center: {
    scale: 1,
    opacity: 1,
    transition: { type: 'spring' as const, stiffness: 200, damping: 18, duration: 0.5 },
  },
  descend: {
    scale: 1.15,
    opacity: 0.9,
    transition: { duration: 0.4 },
  },
}

const wrapperVariants = {
  visible: { opacity: 1 },
  hidden: { opacity: 0, transition: { duration: 0.35 } },
}

export default function LaunchPage({ onComplete }: Props) {
  const { graphMode } = useUIStore()
  const [stage, setStage] = useState<Stage>('init')

  useEffect(() => {
    // State machine driven by timeouts
    const t1 = setTimeout(() => setStage('center'), 100)
    const t2 = setTimeout(() => setStage('nodes'), 700)
    const t3 = setTimeout(() => setStage('descend'), 1800)
    const t4 = setTimeout(() => setStage('done'), 2400)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4) }
  }, [])

  useEffect(() => {
    if (stage === 'done') onComplete()
  }, [stage, onComplete])

  return (
    <AnimatePresence>
      {stage !== 'done' && (
        <motion.div
          key="launch"
          variants={wrapperVariants}
          initial="visible"
          animate="visible"
          exit="hidden"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-bg-primary)',
            zIndex: 100,
          }}
          data-testid="launch-page"
        >
          <Svg2DSequence stage={stage} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Both 3D and 2D use the SVG sequence in this prototype.
// (Three.js mini-scene can be added as an enhancement later.)
function Svg2DSequence({ stage }: { stage: Stage }) {
  return (
    <div
      style={{ position: 'relative', width: 300, height: 300 }}
      data-testid="launch-svg"
    >
      {/* Center node + satellites */}
      <motion.div
        variants={containerVariants}
        animate={stage === 'nodes' || stage === 'descend' ? 'nodes' : undefined}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        {/* Center node */}
        <motion.div
          variants={centerVariants}
          initial="init"
          animate={
            stage === 'center' || stage === 'nodes' ? 'center'
            : stage === 'descend' ? 'descend'
            : 'init'
          }
          data-testid="launch-center-node"
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 0 16px rgba(255,255,255,0.5)',
            position: 'absolute',
            transform: 'translate(-50%, -50%)',
          }}
        />

        {/* Satellites */}
        {SATELLITE_ANGLES.map((_, i) => (
          <motion.div
            key={i}
            custom={i}
            variants={satelliteVariants}
            initial="init"
            animate={
              stage === 'nodes' ? 'nodes'
              : stage === 'descend' ? 'descend'
              : 'init'
            }
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: SATELLITE_COLORS[i],
              position: 'absolute',
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
      </motion.div>
    </div>
  )
}
