import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { api } from '../store';

const KINDS = ['presence', 'people_count', 'motion', 'breathing'] as const;
type Kind = (typeof KINDS)[number];

export function History() {
  const { t } = useTranslation();
  const [hours, setHours] = useState(1);
  const [data, setData] = useState<Record<Kind, { ts: number; value: number }[]>>({
    presence: [],
    people_count: [],
    motion: [],
    breathing: [],
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const results = await Promise.all(KINDS.map((k) => api.history(k, hours)));
      if (!alive) return;
      const next: any = {};
      KINDS.forEach((k, i) => (next[k] = results[i]));
      setData(next);
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [hours]);

  const fmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const titleFor: Record<Kind, string> = {
    presence: t('history.presence'),
    people_count: t('history.people'),
    motion: t('history.motion'),
    breathing: t('history.breathing'),
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card row between">
        <h3 style={{ margin: 0 }}>{t('history.title')}</h3>
        <div className="row">
          <span className="sub">{t('history.hours')}:</span>
          {[1, 6, 24].map((h) => (
            <button key={h} className={`btn ${hours === h ? '' : 'ghost'}`} onClick={() => setHours(h)}>
              {h}
            </button>
          ))}
        </div>
      </div>
      <div className="grid cols-2">
        {KINDS.map((k) => (
          <div className="card" key={k}>
            <h3>{titleFor[k]}</h3>
            {data[k].length === 0 ? (
              <div className="sub">{t('history.empty')}</div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                {k === 'motion' ? (
                  <AreaChart data={data[k]}>
                    <defs>
                      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4f8cff" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="#4f8cff" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#243049" strokeDasharray="3 3" />
                    <XAxis dataKey="ts" tickFormatter={fmt} stroke="#8a97ad" fontSize={11} />
                    <YAxis stroke="#8a97ad" fontSize={11} domain={[0, 1]} />
                    <Tooltip labelFormatter={fmt} contentStyle={{ background: '#161d2c', border: '1px solid #243049' }} />
                    <Area type="monotone" dataKey="value" stroke="#4f8cff" fill="url(#g)" isAnimationActive={false} />
                  </AreaChart>
                ) : (
                  <LineChart data={data[k]}>
                    <CartesianGrid stroke="#243049" strokeDasharray="3 3" />
                    <XAxis dataKey="ts" tickFormatter={fmt} stroke="#8a97ad" fontSize={11} />
                    <YAxis stroke="#8a97ad" fontSize={11} allowDecimals={false} />
                    <Tooltip labelFormatter={fmt} contentStyle={{ background: '#161d2c', border: '1px solid #243049' }} />
                    <Line type={k === 'presence' ? 'stepAfter' : 'monotone'} dataKey="value" stroke="#28d6a8" dot={false} strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
