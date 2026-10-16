import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import { api, connectWs, useStore } from './store';
import { Dashboard } from './pages/Dashboard';
import { Mesh3D } from './pages/Mesh3D';
import { Nodes } from './pages/Nodes';
import { History } from './pages/History';
import { Settings } from './pages/Settings';

type Page = 'dashboard' | 'mesh' | 'nodes' | 'history' | 'settings';

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const ICONS = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  mesh: 'M12 2l8 4.5v9L12 22l-8-6.5v-9L12 2zM12 2v20M4 6.5l8 4.5 8-4.5',
  nodes: 'M4 7h16M4 12h16M4 17h16',
  history: 'M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 6 9.4l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 12 4.6V4.5a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 2.82 1.17l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 12v.09z',
};

export function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState<Page>('dashboard');
  // Subscribe only to low-frequency state here. High-frequency state (sensing,
  // metrics) updates ~10×/s; reading it in App would re-render every page —
  // including the heavy History charts. Pages subscribe to what they need.
  const connected = useStore((s) => s.connected);
  const server = useStore((s) => s.server);
  const settings = useStore((s) => s.settings);
  const hasState = useStore((s) => !!s.sensing);

  useEffect(() => connectWs(), []);
  useEffect(() => {
    if (settings?.locale && settings.locale !== i18n.language) i18n.changeLanguage(settings.locale);
  }, [settings?.locale]);

  const nav: { key: Page; label: string }[] = [
    { key: 'dashboard', label: t('nav.dashboard') },
    { key: 'mesh', label: t('nav.mesh') },
    { key: 'nodes', label: t('nav.nodes') },
    { key: 'history', label: t('nav.history') },
    { key: 'settings', label: t('nav.settings') },
  ];

  const privacy = !!settings?.privacyMode;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
              <path d="M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0" />
              <circle cx="12" cy="12" r="1.4" fill="#fff" stroke="none" />
            </svg>
          </div>
          <div>
            <h1>YetSignal</h1>
            <small>CSI sensing</small>
          </div>
        </div>
        {nav.map((n) => (
          <button key={n.key} className={`navbtn ${page === n.key ? 'active' : ''}`} onClick={() => setPage(n.key)}>
            <Icon d={ICONS[n.key]} />
            {n.label}
          </button>
        ))}
        <div className="spacer" />
        <SidebarFooter />
      </aside>

      <div className="main">
        <div className="topbar">
          <h2>{nav.find((n) => n.key === page)?.label}</h2>
          <span className="pill">
            <span className={`dot ${connected ? 'ok' : 'off'}`} />
            {connected ? t('status.connected') : t('status.disconnected')}
          </span>
          {server?.mqtt && <span className="pill">{t('status.mqtt')}</span>}
          <select
            value={settings?.locale ?? 'uk'}
            onChange={(e) => api.setSettings({ locale: e.target.value as 'uk' | 'en' })}
          >
            <option value="uk">Українська</option>
            <option value="en">English</option>
          </select>
          <div
            className={`toggle ${privacy ? 'on' : ''}`}
            title={privacy ? t('privacy.on') : t('privacy.off')}
            onClick={() => api.setPrivacy(!privacy)}
          />
          <span className="pill" style={{ minWidth: 130, justifyContent: 'center' }}>
            {privacy ? `🔒 ${t('privacy.on')}` : `🟢 ${t('privacy.off')}`}
          </span>
        </div>

        {privacy && page !== 'settings' && <div className="privacy-banner">🔒 {t('privacy.banner')}</div>}

        <div className="content">
          {!settings || !hasState ? (
            <div className="card">Connecting to sensing server…</div>
          ) : page === 'dashboard' ? (
            <Dashboard />
          ) : page === 'mesh' ? (
            <Mesh3D />
          ) : page === 'nodes' ? (
            <Nodes />
          ) : page === 'history' ? (
            <History />
          ) : (
            <Settings />
          )}
        </div>
      </div>
    </div>
  );
}

/** Isolated so the ~10 Hz metrics updates re-render only the footer line. */
function SidebarFooter() {
  const { t } = useTranslation();
  const server = useStore((s) => s.server);
  const metrics = useStore((s) => s.metrics);
  return (
    <div className="footer">
      v{server?.version ?? '0.1.0'}
      <br />
      {metrics ? `${metrics.nodesOnline} ${t('status.online')} · ${metrics.framesPerSec} fps` : ''}
    </div>
  );
}
