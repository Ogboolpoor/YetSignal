import { useTranslation } from 'react-i18next';
import { api, useStore } from '../store';

export function Nodes() {
  const { t } = useTranslation();
  const nodes = Object.values(useStore((s) => s.nodes)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="card">
      <h3>{t('nav.nodes')}</h3>
      {nodes.length === 0 ? (
        <div className="sub">{t('nodes.empty')}</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('nodes.name')}</th>
              <th>{t('nodes.id')}</th>
              <th>{t('nodes.status')}</th>
              <th>{t('nodes.rssi')}</th>
              <th>{t('nodes.quality')}</th>
              <th>{t('nodes.channel')}</th>
              <th>{t('nodes.fw')}</th>
              <th>{t('nodes.temp')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id}>
                <td>
                  {n.name}
                  {n.simulated && <span className="tag sim">{t('nodes.sim')}</span>}
                </td>
                <td style={{ fontFamily: 'monospace', color: 'var(--muted)' }}>{n.id}</td>
                <td>
                  <span className={`tag ${n.online ? 'online' : 'offline'}`}>
                    {n.online ? t('nodes.online') : t('nodes.offline')}
                  </span>
                </td>
                <td>{Math.round(n.rssi)} dBm</td>
                <td>
                  <div className="bar" style={{ width: 70 }}>
                    <span style={{ width: `${Math.round(n.signalQuality * 100)}%` }} />
                  </div>
                </td>
                <td>{n.channel}</td>
                <td style={{ color: 'var(--muted)' }}>{n.firmware}</td>
                <td>{n.temperatureC != null ? `${n.temperatureC.toFixed(1)}°C` : '—'}</td>
                <td>
                  <button className="btn ghost" onClick={() => api.removeNode(n.id)}>
                    {t('nodes.remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
