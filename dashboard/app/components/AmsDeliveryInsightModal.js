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

/** Team pooled on-time vs delayed as a donut (SVG). */
function TeamDonut({ onTimeRate, delayed, total }) {
  const onTime = Math.max(0, total - delayed);
  const safeTotal = total > 0 ? total : 1;
  const onFrac = onTime / safeTotal;
  const delayFrac = delayed / safeTotal;
  const r = 36;
  const c = 2 * Math.PI * r;
  const onLen = onFrac * c;
  const delayLen = delayFrac * c;
  const cOn = accuracyColors(onTimeRate > 0 ? onTimeRate : 0);
  const cDel = { stroke: 'hsl(0 55% 42%)' };

  return (
    <div className="flex items-center gap-4 shrink-0">
      <svg width="100" height="100" viewBox="0 0 100 100" className="shrink-0" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={cOn.bar}
          strokeWidth="14"
          strokeDasharray={`${onLen} ${c - onLen}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ filter: `drop-shadow(0 0 6px ${cOn.barGlow})` }}
        />
        {delayFrac > 0.001 && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={cDel.stroke}
            strokeWidth="14"
            strokeDasharray={`${delayLen} ${c - delayLen}`}
            strokeDashoffset={-onLen}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            opacity={0.85}
          />
        )}
        <text
          x="50"
          y="54"
          textAnchor="middle"
          className="fill-foreground text-[0.85rem] font-bold"
          style={{ fontSize: '13px' }}
        >
          {onTimeRate != null ? `${onTimeRate}%` : '—'}
        </text>
      </svg>
      <div className="min-w-0 text-[0.7rem] text-text-muted space-y-1">
        <p className="text-[0.65rem] uppercase tracking-wider text-text-secondary font-semibold">Team</p>
        <p className="tabular-nums">
          <span className="text-completed font-medium">{onTime}</span> on-time ·{' '}
          <span className="text-blocked/90 font-medium">{delayed}</span> delayed
        </p>
        <p className="text-[0.65rem] text-text-muted/90">{total} assignment shares</p>
      </div>
    </div>
  );
}

/**
 * Vertical bar chart: each member one bar, height = on-time %.
 * viewBox scales; labels below bars (truncated).
 */
function MemberBarChart({ members }) {
  const n = members.length;
  if (n === 0) return null;

  const vbW = Math.max(320, n * 44);
  const vbH = 182;
  const padL = 28;
  const padR = 12;
  const padT = 12;
  /** Extra room for two staggered label rows under the category axis. */
  const padB = 64;
  const innerW = vbW - padL - padR;
  const innerH = vbH - padT - padB;
  const slot = innerW / n;
  const barW = Math.min(28, slot * 0.72);
  const gridLines = [0, 25, 50, 75, 100];

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
      <svg
        width="100%"
        height={vbH}
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        className="min-w-[min(100%,520px)]"
        role="img"
        aria-label="On-time rate by member"
      >
        <title>On-time rate comparison</title>
        {gridLines.map((g) => {
          const y = padT + innerH * (1 - g / 100);
          return (
            <g key={g}>
              <line
                x1={padL}
                x2={vbW - padR}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
              <text x={4} y={y + 3} className="fill-text-muted" style={{ fontSize: '9px' }}>
                {g}%
              </text>
            </g>
          );
        })}
        {members.map((m, i) => {
          const rate = Math.min(100, Math.max(0, m.onTimeRate || 0));
          const h = (rate / 100) * innerH;
          const x = padL + i * slot + (slot - barW) / 2;
          const y = padT + innerH - h;
          const c = accuracyColors(rate);
          const label = String(m.username || '').slice(0, 12) + (String(m.username || '').length > 12 ? '…' : '');
          /** Alternate name rows so adjacent labels don’t overlap. */
          const nameY = i % 2 === 0 ? vbH - 8 : vbH - 22;
          return (
            <g key={`${m.username}:${m.email || i}`}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 1)}
                rx={3}
                fill={c.bar}
                style={{ filter: `drop-shadow(0 0 8px ${c.barGlow})` }}
              />
              <text
                x={x + barW / 2}
                y={nameY}
                textAnchor="middle"
                className="fill-text-secondary"
                style={{ fontSize: '9px' }}
              >
                {label}
              </text>
              <text
                x={x + barW / 2}
                y={y - 4}
                textAnchor="middle"
                className="fill-foreground font-semibold"
                style={{ fontSize: '10px' }}
              >
                {rate}%
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-[0.62rem] text-text-muted px-1 pt-1">Bar height = on-time rate · {n} people</p>
    </div>
  );
}

/** Ring showing on-time % + task split bar. */
function MemberRow({ m }) {
  const c = accuracyColors(m.onTimeRate);
  const total = m.totalTasks || 0;
  const onT = m.onTimeTasks ?? Math.max(0, total - (m.delayedTasks || 0));
  const del = m.delayedTasks || 0;
  const onPct = total > 0 ? (onT / total) * 100 : 0;
  const delPct = total > 0 ? (del / total) * 100 : 0;

  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = ((m.onTimeRate || 0) / 100) * circ;

  return (
    <li
      className="rounded-lg border bg-white/[0.03] px-3 py-2.5 grid grid-cols-[auto_1fr_auto] gap-3 items-center"
      style={{ borderColor: c.border }}
    >
      <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={c.bar}
          strokeWidth="5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 22 22)"
          style={{ filter: `drop-shadow(0 0 4px ${c.barGlow})` }}
        />
        <text x="22" y="25" textAnchor="middle" className="fill-foreground font-bold" style={{ fontSize: '9px' }}>
          {Math.round(m.onTimeRate)}%
        </text>
      </svg>

      <div className="min-w-0">
        <div className="flex justify-between gap-2 text-xs">
          <span className="font-medium text-foreground truncate">{m.username}</span>
          <span className="shrink-0 tabular-nums text-[0.65rem] text-text-muted">
            {onT} on-time · {del} delayed
          </span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-white/10 mt-2">
          <div
            className="h-full transition-all duration-300 rounded-l-sm"
            style={{
              width: `${onPct}%`,
              background: `linear-gradient(90deg, hsl(${accuracyHue(m.onTimeRate)} 65% 42%), hsl(${accuracyHue(m.onTimeRate)} 75% 36%))`,
              boxShadow: `0 0 8px ${c.barGlow}`,
            }}
          />
          <div
            className="h-full bg-rose-500/35 rounded-r-sm"
            style={{ width: `${delPct}%` }}
            title={`${del} delayed tasks`}
          />
        </div>
        <div className="text-[0.62rem] text-text-muted mt-1 tabular-nums">{total} tasks · multi-assignee counted</div>
      </div>
    </li>
  );
}

export default function AmsDeliveryInsightModal({
  open,
  onClose,
  /** API returning same shape as /api/ams-member-stats (or PS/RTL /api/ps-member-stats · /api/rtl-member-stats). */
  statsUrl = '/api/ams-member-stats',
}) {
  const [mounted, setMounted] = useState(false);
  const [panelEntered, setPanelEntered] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewFilter, setViewFilter] = useState('worst');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      setPanelEntered(false);
      return;
    }
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setPanelEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const load = useCallback(async () => {
    if (!statsUrl) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(statsUrl);
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
  }, [statsUrl]);

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
    if (viewFilter === 'best') {
      list.sort((a, b) => b.onTimeRate - a.onTimeRate || a.delayedTasks - b.delayedTasks);
    } else if (viewFilter === 'all') {
      list.sort((a, b) => String(a.username || '').localeCompare(String(b.username || '')));
    } else {
      list.sort((a, b) => a.onTimeRate - b.onTimeRate || b.delayedTasks - a.delayedTasks);
    }
    return list;
  }, [data, viewFilter]);

  const team = data?.team;

  const contextSubtitle = useMemo(() => {
    if (!data) return 'On-time delivery · assignee workload';
    const k = data.teamKind;
    if (k === 'ps' || k === 'rtl') {
      const pid = String(data.projectId || '').toUpperCase();
      return `${data.teamLabel} · ${data.workflowTitle} · ${pid} · What went wrong · delayed task assignments`;
    }
    if (k === 'ams') {
      return `${data.teamLabel} · ${data.workflowTitle} · source: ${data.sourceFile || 'ams_tasks.json'}`;
    }
    return 'On-time delivery · assignee workload';
  }, [data]);

  if (!mounted || !open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[10060] pointer-events-none" role="presentation">
      {/* Backdrop: closes panel */}
      <button
        type="button"
        aria-label="Close leader board"
        className="pointer-events-auto absolute inset-0 z-0 bg-black/55 backdrop-blur-[1px] transition-opacity"
        onClick={onClose}
      />
      {/* Side panel */}
      <div
        className={`
          pointer-events-auto absolute inset-y-0 right-0 z-10 flex h-full w-full max-w-[min(100vw,28rem)] sm:max-w-xl flex-col
          border-l border-white/12 bg-[#0d0d0d] shadow-[-12px_0_40px_rgba(0,0,0,0.45)]
          transform transition-transform duration-300 ease-out
          ${panelEntered ? 'translate-x-0' : 'translate-x-full'}
        `}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ams-delivery-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-white/[0.08] shrink-0">
          <div>
            <h2 id="ams-delivery-title" className="text-base font-semibold text-foreground tracking-tight">
              Leader board
            </h2>
            <p className="text-[0.65rem] text-text-muted mt-0.5 leading-snug">{contextSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-text-muted hover:text-foreground px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/25 transition-colors"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-3 text-[0.7rem] text-text-muted border-b border-white/[0.06] shrink-0 space-y-2">
          <p>
            {viewFilter === 'best'
              ? 'Highest on-time rate first.'
              : viewFilter === 'all'
                ? 'Alphabetical.'
                : 'Lowest on-time rate first.'}{' '}
            Multi-assignee tasks count toward each person.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setViewFilter('worst')}
              className={`px-2.5 py-1 rounded-full border text-[0.62rem] uppercase tracking-wide transition-colors ${
                viewFilter === 'worst'
                  ? 'border-blocked/60 bg-blocked/15 text-blocked'
                  : 'border-white/15 text-text-muted hover:text-foreground hover:border-white/30'
              }`}
            >
              Worst
            </button>
            <button
              type="button"
              onClick={() => setViewFilter('best')}
              className={`px-2.5 py-1 rounded-full border text-[0.62rem] uppercase tracking-wide transition-colors ${
                viewFilter === 'best'
                  ? 'border-completed/60 bg-completed/15 text-completed'
                  : 'border-white/15 text-text-muted hover:text-foreground hover:border-white/30'
              }`}
            >
              Best
            </button>
            <button
              type="button"
              onClick={() => setViewFilter('all')}
              className={`px-2.5 py-1 rounded-full border text-[0.62rem] uppercase tracking-wide transition-colors ${
                viewFilter === 'all'
                  ? 'border-accent/60 bg-accent/15 text-accent'
                  : 'border-white/15 text-text-muted hover:text-foreground hover:border-white/30'
              }`}
            >
              All
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 py-4 space-y-5">
          {loading && <p className="text-text-muted text-sm text-center py-12">Loading…</p>}
          {!loading && error && <p className="text-blocked text-sm text-center py-12">{error}</p>}

          {!loading && !error && team && (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-3 rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.04] to-transparent">
                <TeamDonut
                  onTimeRate={team.onTimeRate}
                  delayed={team.delayedAssignments}
                  total={team.totalTaskAssignments}
                />
                <div className="flex-1 min-w-0 text-[0.7rem] text-text-muted space-y-1 border-t sm:border-t-0 sm:border-l border-white/[0.06] sm:pl-4 pt-3 sm:pt-0">
                  <p className="text-text-secondary font-medium text-xs">How to read</p>
                  <p>
                    <span className="text-completed">Green</span> segments = share of tasks finished on time;{' '}
                    <span className="text-blocked/90">red</span> = delayed. Rings and bars use the same hue scale (red →
                    yellow → green).
                  </p>
                </div>
              </div>

              {members.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-text-secondary">
                    Comparison chart
                  </h3>
                  <MemberBarChart members={members} />
                </div>
              )}

              <div className="space-y-2">
                <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-text-secondary">
                  Detail
                </h3>
                <ul className="space-y-2.5">
                  {members.map((m) => (
                    <MemberRow key={`${m.username}:${m.email || ''}`} m={m} />
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
