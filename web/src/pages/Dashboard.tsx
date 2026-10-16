import { useTranslation } from 'react-i18next';
import { api, useStore } from '../store';
import { Heatmap } from '../components/Heatmap';
import { CsiChart } from '../components/CsiChart';
import { Logs } from '../components/Logs';

export function Dashboard() {
  const { t } = useTranslation();
  const s = useStore((st) => st.sensing)!;
  const csi = useStore((st) => st.csi);
  const nodes = useStore((st) => st.nodes);
  const metrics = useStore((st) => st.metrics);

  const firstNode = Object.values(nodes).find((n) => n.online);
  const amp = firstNode ? csi[firstNode.id] ?? [] : [];

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* headline cards */}
      <div className="grid cols-4">
        <div className="card">
          <h3>{t('presence.title')}</h3>
          <span className={`badge ${s.fall ? 'fall' : s.presence ? 'present' : 'absent'}`}>
            {s.fall ? t('activity.fall') : s.presence ? t('presence.present') : t('presence.absent')}
          </span>
        </div>
        <div className="card">
          <h3>{t('people.title')}</h3>
          <div className="stat">{s.peopleCount}</div>
          <div className="sub">{t('people.estimate')}</div>
        </div>
        <div className="card">
          <h3>{t('activity.title')}</h3>
          <div style={{ marginTop: 8 }}>
            <span className={`activity-tag ${s.activity}`}>{t(`activity.${s.activity}`)}</span>
          </div>
          <div className="bar" style={{ marginTop: 14 }}>
            <span style={{ width: `${Math.round(s.motionLevel * 100)}%` }} />
          </div>
          <div className="sub">
            {t('motion.title')}: {Math.round(s.motionLevel * 100)}%
          </div>
        </div>
        <div className="card">
          <h3>{t('vitals.breathing')} / {t('vitals.heart')}</h3>
          <div className="stat">
            {s.breathingRateBpm ?? t('vitals.none')}
            <span className="unit">{t('vitals.bpm')}</span>
          </div>
          <div className="sub">
            {t('vitals.heart')}: {s.heartRateBpm ? `${s.heartRateBpm} ${t('vitals.bpm')}` : t('vitals.none')}
          </div>
        </div>
      </div>

      {/* heatmap + csi */}
      <div className="grid cols-2">
        <div className="card">
          <h3>{t('heatmap.title')}</h3>
          <Heatmap data={s.heatmap} w={s.gridW} h={s.gridH} />
        </div>
        <div className="grid" style={{ gap: 16 }}>
          <div className="card">
            <h3>
              {t('csi.title')} {firstNode ? `· ${firstNode.name}` : ''}
            </h3>
            {amp.length ? <CsiChart amplitude={amp} /> : <div className="sub">{t('csi.waiting')}</div>}
          </div>
          <SimCard />
        </div>
      </div>

      {/* diagnostics + logs */}
      <div className="grid cols-2">
        <div className="card">
          <h3>{t('metrics.title')}</h3>
          {metrics && (
            <div className="grid cols-2" style={{ gap: 8, fontSize: 13 }}>
              <Metric label={t('metrics.frameUs')} value={`${metrics.avgFrameProcUs} µs`} />
              <Metric label={t('metrics.fps')} value={`${metrics.framesPerSec}`} />
              <Metric label={t('metrics.latency')} value={`${metrics.inferenceLatencyMs} ms`} />
              <Metric label={t('metrics.varMax')} value={`${metrics.varMax}`} />
              <Metric label={t('metrics.breathSnr')} value={`${metrics.breathSnr}`} />
              <Metric label={t('metrics.uptime')} value={`${metrics.uptimeSec}s`} />
            </div>
          )}
        </div>
        <div className="card">
          <h3>{t('logs.title')}</h3>
          <Logs />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="row between" style={{ borderBottom: '1px solid var(--border)', padding: '4px 0' }}>
      <span style={{ color: 'var(--muted)' }}>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function SimCard() {
  const { t } = useTranslation();
  const server = useStore((st) => st.server);
  const nodeCount = Object.keys(useStore((st) => st.nodes)).length;
  if (!server?.simulator) return null; // only when the server is running the simulator
  return (
    <div className="card">
      <h3>🧪 {t('sim.title')}</h3>
      {nodeCount === 0 && (
        <div className="sub" style={{ marginBottom: 10, color: 'var(--warn)' }}>
          {t('sim.noNodes')}
        </div>
      )}
      <div className="row">
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('sim.people')}:</span>
        {[0, 1, 2, 3, 4].map((n) => (
          <button key={n} className="btn ghost" onClick={() => api.sim({ kind: 'set_people', count: n })}>
            {n}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn warn" onClick={() => api.sim({ kind: 'trigger_fall' })}>
          {t('sim.fall')}
        </button>
        <button className={`btn ${nodeCount === 0 ? '' : 'ghost'}`} onClick={() => api.sim({ kind: 'add_node' })}>
          + {t('sim.addNode')}
        </button>
      </div>
    </div>
  );
}
