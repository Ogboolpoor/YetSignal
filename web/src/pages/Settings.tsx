import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, useStore } from '../store';
import type { SensingModes, DataCategory } from '../types';

export function Settings() {
  const { t } = useTranslation();
  const settings = useStore((s) => s.settings)!;
  const [calibrated, setCalibrated] = useState(false);

  const modeKeys: (keyof SensingModes)[] = ['presence', 'motion', 'breathing', 'heart', 'pose'];
  const retKeys: DataCategory[] = ['raw_csi', 'derived', 'vital'];
  const retLabel: Record<DataCategory, string> = {
    raw_csi: t('settings.rawCsi'),
    derived: t('settings.derived'),
    vital: t('settings.vital'),
  };

  return (
    <div className="grid cols-2" style={{ gap: 16 }}>
      <div className="card">
        <h3>{t('settings.modes')}</h3>
        {modeKeys.map((m) => (
          <div className="switch" key={m}>
            <div
              className={`toggle ${settings.modes[m] ? 'on' : ''}`}
              onClick={() => api.setSettings({ modes: { ...settings.modes, [m]: !settings.modes[m] } })}
            />
            <span>{t(`settings.${m}`)}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>{t('settings.title')}</h3>
        <Slider
          label={t('settings.sensitivity')}
          value={settings.sensitivity}
          onChange={(v) => api.setSettings({ sensitivity: v })}
        />
        <Slider
          label={t('settings.motionThreshold')}
          value={settings.motionThreshold}
          onChange={(v) => api.setSettings({ motionThreshold: v })}
        />
        <Slider
          label={t('settings.fallSensitivity')}
          value={settings.fallSensitivity}
          onChange={(v) => api.setSettings({ fallSensitivity: v })}
        />
        <div className="row" style={{ marginTop: 6 }}>
          <button
            className="btn"
            onClick={async () => {
              await api.calibrate();
              setCalibrated(true);
              setTimeout(() => setCalibrated(false), 2500);
            }}
          >
            {t('settings.calibrate')}
          </button>
          {calibrated && <span style={{ color: 'var(--ok)' }}>✓ {t('settings.calibrated')}</span>}
        </div>
      </div>

      <div className="card">
        <h3>{t('settings.retention')}</h3>
        {retKeys.map((k) => (
          <label className="field" key={k}>
            <span className="lbl">
              {retLabel[k]} <b>{settings.retention[k]} d</b>
            </span>
            <input
              type="range"
              min={0}
              max={90}
              value={settings.retention[k]}
              onChange={(e) =>
                api.setSettings({ retention: { ...settings.retention, [k]: Number(e.target.value) } })
              }
            />
          </label>
        ))}
        <div className="sub">{t('settings.retentionHint')}</div>
      </div>

      <div className="card">
        <h3>{t('settings.language')}</h3>
        <select value={settings.locale} onChange={(e) => api.setSettings({ locale: e.target.value as 'uk' | 'en' })}>
          <option value="uk">Українська</option>
          <option value="en">English</option>
        </select>
        <div className="switch" style={{ marginTop: 20 }}>
          <div className={`toggle ${settings.privacyMode ? 'on' : ''}`} onClick={() => api.setPrivacy(!settings.privacyMode)} />
          <span>{settings.privacyMode ? t('privacy.on') : t('privacy.off')}</span>
        </div>
      </div>
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span className="lbl">
        {label} <b>{Math.round(value * 100)}%</b>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
