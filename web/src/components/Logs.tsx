import { useEffect, useRef } from 'react';
import { useStore } from '../store';

/** Live server log stream (NFR-17 observability surfaced in the UI). */
export function Logs() {
  const logs = useStore((s) => s.logs);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [logs]);
  return (
    <div className="logs" ref={ref}>
      {logs.length === 0 && <div className="logline debug">…</div>}
      {logs.map((l, i) => (
        <div key={i} className={`logline ${l.level}`}>
          {new Date(l.ts).toLocaleTimeString()} {l.level.toUpperCase()} {l.msg}
        </div>
      ))}
    </div>
  );
}
