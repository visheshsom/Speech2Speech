export default function ApiKeySetup({ value, onSave, onClose }) {
  const update = (patch) => onSave({ ...value, ...patch })

  return (
    <div style={s.overlay}>
      <div style={s.card}>
        <div style={s.topRow}>
          <div>
            <div style={s.title}>Connection settings</div>
            <div style={s.subtitle}>The frontend talks to your local voice backend. API keys stay on the server.</div>
          </div>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        <label style={s.label}>Backend URL</label>
        <input
          style={s.input}
          value={value.backendUrl}
          onChange={(e) => update({ backendUrl: e.target.value })}
          placeholder="/api"
        />

        <label style={s.label}>Voice output</label>
        <select
          style={s.input}
          value={value.ttsProvider}
          onChange={(e) => update({ ttsProvider: e.target.value })}
        >
          <option value="parler">Indic Parler-TTS</option>
          <option value="sarvam">Sarvam Bulbul fallback</option>
        </select>

        <label style={s.checkRow}>
          <input
            type="checkbox"
            checked={value.autoListen}
            onChange={(e) => update({ autoListen: e.target.checked })}
          />
          Auto-start the next listening turn after the reply finishes
        </label>

        <div style={s.note}>
          Run the backend with <code>SARVAM_API_KEY</code>. For Indic Parler-TTS, start the optional Python service and set <code>PARLER_TTS_URL</code>.
        </div>

        <button style={s.primary} onClick={onClose}>Done</button>
      </div>
    </div>
  )
}

const s = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.58)',
    backdropFilter: 'blur(10px)',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: 'min(520px, 100%)',
    background: '#101114',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 24,
    padding: 20,
    color: '#F5F0E8',
    boxShadow: '0 28px 80px rgba(0,0,0,0.45)',
  },
  topRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 18,
  },
  title: {
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: 'rgba(245,240,232,0.66)',
    lineHeight: 1.45,
  },
  closeBtn: {
    border: 'none',
    background: 'none',
    color: 'rgba(245,240,232,0.55)',
    fontSize: 18,
    cursor: 'pointer',
    padding: 4,
  },
  label: {
    display: 'block',
    marginTop: 14,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: 600,
    color: 'rgba(245,240,232,0.82)',
  },
  input: {
    width: '100%',
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: '#F5F0E8',
    padding: '12px 14px',
    outline: 'none',
    fontSize: 14,
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    fontSize: 13,
    color: 'rgba(245,240,232,0.72)',
    lineHeight: 1.4,
  },
  note: {
    marginTop: 16,
    fontSize: 12,
    lineHeight: 1.5,
    color: 'rgba(245,240,232,0.62)',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 14,
  },
  primary: {
    marginTop: 18,
    width: '100%',
    border: 'none',
    borderRadius: 14,
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #FF9933, #FF5500)',
    color: '#fff',
    fontWeight: 800,
    fontSize: 14,
    cursor: 'pointer',
  },
}
