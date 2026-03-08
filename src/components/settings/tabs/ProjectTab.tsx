import { useRef } from 'react'
import { Upload } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { fieldInputStyle, fieldLabelStyle } from '../settingsShared'

const uploadBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 10,
  padding: '2px 7px',
  borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'transparent',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  transition: 'color 0.1s',
}

export default function ProjectTab() {
  const { projectInfo, setProjectInfo } = useSettingsStore()
  const projectFileRef = useRef<HTMLInputElement>(null)
  const teamFileRef = useRef<HTMLInputElement>(null)

  function handleProjectFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setProjectInfo({ rawProjectInfo: (ev.target?.result as string).trim() })
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function handleTeamFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setProjectInfo({ teamMembers: (ev.target?.result as string).trim() })
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Project Info</h3>
          <button style={uploadBtnStyle} onClick={() => projectFileRef.current?.click()} title="Load from a project .md file">
            <Upload size={10} /> Load MD
          </button>
          <input ref={projectFileRef} type="file" accept=".md" style={{ display: 'none' }} onChange={handleProjectFile} />
        </div>
        <textarea
          value={projectInfo.rawProjectInfo}
          onChange={e => setProjectInfo({ rawProjectInfo: e.target.value })}
          placeholder={'# Project Name\n\nGame engine, genre, platform, team size, overview, etc.\nPaste your MD file contents here directly.'}
          rows={10}
          style={{ ...fieldInputStyle, resize: 'vertical', lineHeight: 1.6 }}
        />
      </section>

      {/* Current Situation */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>Current Situation</label>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Latest real-world info not in the vault · MD format supported</span>
        </div>
        <textarea
          value={projectInfo.currentSituation}
          onChange={e => setProjectInfo({ currentSituation: e.target.value })}
          placeholder={'## Current Sprint\n- Alpha test in progress (2 weeks remaining)\n- Combat system priority\n\n## Recent Decisions\n- ...'}
          rows={7}
          style={{ ...fieldInputStyle, resize: 'vertical', lineHeight: 1.6 }}
        />
      </section>

      {/* Team Members */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ ...fieldLabelStyle, marginBottom: 0 }}>Team Members</label>
          <button style={uploadBtnStyle} onClick={() => teamFileRef.current?.click()} title="Load from a team .md file">
            <Upload size={10} /> Load MD
          </button>
          <input ref={teamFileRef} type="file" accept=".md" style={{ display: 'none' }} onChange={handleTeamFile} />
        </div>
        <textarea
          value={projectInfo.teamMembers}
          onChange={e => setProjectInfo({ teamMembers: e.target.value })}
          placeholder={'chief: John Smith\nart: Jane Doe, Mike Park\nplan: Alice Kim\nprog: Bob Lee'}
          rows={4}
          style={{ ...fieldInputStyle, resize: 'vertical', lineHeight: 1.6 }}
        />
      </section>
    </div>
  )
}
