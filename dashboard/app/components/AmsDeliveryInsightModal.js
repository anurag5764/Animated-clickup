'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

/** 0% → red (0°), 50% → yellow (60°), 100% → green (120°) */
function accuracyHue(rate) {
  const r = Math.max(0, Math.min(100, Number(rate) || 0));
  return Math.round((r / 100) * 120);
}

function accuracyColors(rate) {
  const h = accuracyHue(rate);
  return {
    bar: `hsl(${h} 78% 46%)`,
    barGlow: `hsl(${h} 70% 50% / 0.35)`,
    text: `hsl(${h} 85% 62%)`,
    border: `hsl(${h} 50% 38% / 0.55)`,
  };
}

export default function AmsDeliveryInsightModal({ open, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ams-member-stats');
      if (!res.ok) {
        let msg = `${res.status}`;
        try {
          const j = await res.json();
          if (j.error) msg = j.hint ? `${j.error} — ${j.hint}` : j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      setData(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const members = useMemo(() => {
    const list = [...(data?.members || [])];
    list.sort((a, b) => a.onTimeRate - b.onTimeRate || b.delayedTasks - a.delayedTasks);
    return list;
  }, [data]);

  const team = data?.team;

  if (!mounted || !open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10060] flex items-center justify-center p-4 bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ams-delivery-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md max-h-[85vh] flex flex-col rounded-xl border border-white/10 bg-[#111] shadow-xl">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.08] shrink-0">
          <h2 id="ams-delivery-title" className="text-sm font-semibold text-foreground">
            Performance
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-text-muted hover:text-foreground px-2 py-1 rounded border border-transparent hover:border-white/15"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-3 text-[0.7rem] text-text-muted border-b border-white/[0.06] shrink-0">
          Sorted lowest
          on-time first. Multi-assignee tasks count for each person.
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-3">
          {loading && <p className="text-text-muted text-sm text-center py-8">Loading…</p>}
          {!loading && error && <p className="text-blocked text-sm text-center py-8">{error}</p>}

          {!loading && !error && team && (
            <>
              <p className="text-xs text-text-secondary mb-3 tabular-nums">
                Team:{' '}
                <span
                  className="font-semibold"
                  style={{ color: accuracyColors(team.onTimeRate).text }}
                >
                  {team.onTimeRate}%
                </span>{' '}
                on-time · {team.delayedAssignments} delayed / {team.totalTaskAssignments} assignments
                <span className="block mt-1 text-[0.65rem] text-text-muted">
                  Green = high on-time · red = more delayed share
                </span>
              </p>
              <ul className="space-y-2">
                {members.map((m) => {
                  const c = accuracyColors(m.onTimeRate);
                  return (
                    <li
                      key={`${m.username}:${m.email || ''}`}
                      className="rounded-lg border bg-white/[0.02] px-2.5 py-2"
                      style={{ borderColor: c.border }}
                    >
                      <div className="flex justify-between gap-2 text-xs">
                        <span className="font-medium text-foreground truncate">{m.username}</span>
                        <span className="shrink-0 tabular-nums font-medium" style={{ color: c.text }}>
                          {m.onTimeRate}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded bg-white/10 mt-1.5 overflow-hidden">
                        <div
                          className="h-full rounded transition-[width] duration-300"
                          style={{
                            width: `${Math.min(100, m.onTimeRate)}%`,
                            backgroundColor: c.bar,
                            boxShadow: `0 0 10px ${c.barGlow}`,
                          }}
                        />
                      </div>
                      <div className="text-[0.65rem] text-text-muted mt-1 tabular-nums">
                        {m.delayedTasks} delayed · {m.totalTasks} tasks
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
