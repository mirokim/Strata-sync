export default function AboutTab() {
  const sectionTitle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginBottom: 8,
  }
  const badge: React.CSSProperties = {
    display: 'inline-block',
    fontSize: 10,
    padding: '2px 7px',
    borderRadius: 4,
    background: 'var(--color-bg-active)',
    color: 'var(--color-accent)',
    marginRight: 4,
    marginBottom: 4,
  }
  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '5px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    fontSize: 11,
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.02em' }}>
            STRATA SYNC
          </h2>
          <p style={{ fontSize: 11, color: 'var(--color-accent)', marginTop: 2 }}>
            v0.3.0 &nbsp;·&nbsp; AI Director Proxy System
          </p>
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'right', lineHeight: 1.6 }}>
          <div>Developer</div>
          <a
            href="mailto:miro85a@gmail.com"
            style={{ color: 'var(--color-accent)', textDecoration: 'none' }}
          >
            miro85a@gmail.com
          </a>
        </div>
      </div>

      {/* Overview */}
      <div>
        <p style={{ fontSize: 12, lineHeight: 1.8, color: 'var(--color-text-secondary)' }}>
          Visualizes your Obsidian vault as a <strong style={{ color: 'var(--color-text-primary)' }}>WikiLink knowledge graph</strong>,
          with 5 AI director personas traversing the graph via BFS to deliver insights and feedback on the entire project.
          Designed to support knowledge management and decision-making in a game development studio.
        </p>
      </div>

      {/* Tech Stack */}
      <div>
        <p style={sectionTitle}>Tech Stack</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
          {[
            'Electron 31', 'React 19', 'TypeScript 5.5', 'Vite 5',
            'Three.js', 'd3-force', 'CodeMirror 6', 'Zustand 5',
            'Tailwind CSS 4', 'Framer Motion', 'FastAPI', 'ChromaDB',
          ].map(t => (
            <span key={t} style={badge}>{t}</span>
          ))}
        </div>
      </div>

      {/* Supported LLMs */}
      <div>
        <p style={sectionTitle}>Supported LLMs</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            { provider: 'Anthropic', models: 'Claude Opus / Sonnet / Haiku', vision: true },
            { provider: 'OpenAI', models: 'GPT-4o / GPT-4o mini', vision: true },
            { provider: 'Google', models: 'Gemini 1.5 Pro / Flash', vision: true },
            { provider: 'xAI', models: 'Grok Beta', vision: false },
          ].map(({ provider, models, vision }) => (
            <div key={provider} style={row}>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{provider}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {models}
                {vision && <span style={{ ...badge, marginLeft: 6, marginBottom: 0, color: 'var(--color-text-secondary)' }}>Vision</span>}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Core Algorithms */}
      <div>
        <p style={sectionTitle}>Core Algorithms</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            {
              name: 'TF-IDF Vector Search',
              desc: 'Documents are vectorized at vault load time; cosine similarity selects semantic seeds',
            },
            {
              name: 'BFS Graph Traversal',
              desc: 'Follows WikiLinks up to 4 hops, collecting up to 35 documents with per-hop budgets',
            },
            {
              name: 'PageRank',
              desc: 'O(N+M) reverse-edge algorithm identifies hub documents (25 iterations)',
            },
            {
              name: 'Union-Find Clustering',
              desc: 'Connected-component detection with path compression; groups documents by cluster',
            },
            {
              name: 'Korean Morpheme Processing',
              desc: 'Greedy longest-match suffix stripping (이라는/에서의/으로 etc., 50+ patterns)',
            },
            {
              name: 'd3-force Physics Simulation',
              desc: 'Repulsion, tension, and centering forces produce natural 2D/3D graph layouts',
            },
          ].map(({ name, desc }) => (
            <div key={name} style={{ ...row, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600, fontSize: 11 }}>{name}</span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 10, lineHeight: 1.5 }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* RAG Pipeline */}
      <div>
        <p style={sectionTitle}>Graph-Augmented RAG Pipeline</p>
        <div style={{
          background: 'var(--color-bg-active)',
          borderRadius: 6,
          padding: '10px 12px',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          lineHeight: 1.9,
          fontFamily: 'monospace',
        }}>
          {[
            '① Intent detection → global/overview keywords → buildGlobalGraphContext()',
            '② TF-IDF cosine similarity search → top 8 candidates',
            '③ Score filter (> 0.05) + re-ranking',
            '④ Fewer than 2 seeds → PageRank hub nodes auto-supplement',
            '⑤ BFS traversal (3 hops, up to 20 documents)',
            '⑥ Structural header injection (top PageRank + cluster overview)',
            '⑦ LLM streaming analysis',
          ].map(line => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </div>

    </div>
  )
}
