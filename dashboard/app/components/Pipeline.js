'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { compareLnoTasks, parseLnoFromName, stageHeatFromLnoTasks } from '../../../lno.js';
import AmsDeliveryInsightModal from './AmsDeliveryInsightModal';

const AMS_STAGE_NAMES = {
  1: 'Initial Module Spec',
  2: 'Mathematical Modeling of the Module',
  3: 'Mathematical Sim in Python',
  4: 'Circuit Implementation and Sim',
  5: 'Layout',
  6: 'Post Layout Sim',
};

const statusConfig = {
  /** Leverage (L) — high ROI */
  leverage: {
    card: 'border-blocked/80 bg-blocked/[0.12] text-blocked shadow-[0_0_22px_rgba(255,80,80,0.22)]',
    badge: 'bg-blocked/20 text-blocked',
    icon: 'L',
  },
  /** Neutral (N) — normal ROI */
  neutral: {
    card: 'border-accent bg-accent/[0.1] text-foreground shadow-[0_0_22px_rgba(255,99,33,0.18)]',
    badge: 'bg-accent text-white',
    icon: 'N',
  },
  /** Overhead (O) — low ROI */
  overhead: {
    card: 'border-yellow-400/60 bg-yellow-500/[0.08] text-yellow-200',
    badge: 'bg-yellow-500/20 text-yellow-200',
    icon: 'O',
  },
  /** Delayed tasks with no L/N/O tag in the name */
  unknown_lno: {
    card: 'border-completed/40 bg-completed/[0.05] text-completed hover:border-completed',
    badge: 'bg-completed/10 text-completed',
    icon: '—',
  },
  upcoming: {
    card: 'border-white/10 bg-white/[0.02] text-text-muted hover:border-white/20',
    badge: 'bg-transparent text-text-muted',
    icon: '⏳',
  },
};

/** PS team workflow (output_ps.json): completed / active / blocked / upcoming */
const psWorkflowStatusConfig = {
  completed: {
    card: 'border-completed/40 bg-completed/[0.05] text-completed hover:border-completed',
    badge: 'bg-completed/10 text-completed',
    icon: '✅',
  },
  active: {
    card: 'border-accent bg-accent/[0.1] text-foreground shadow-[0_0_20px_rgba(255,99,33,0.15)]',
    badge: 'bg-accent text-white',
    icon: '●',
  },
  blocked: {
    card: 'border-blocked/60 bg-blocked/[0.05] text-blocked hover:border-blocked',
    badge: 'bg-blocked/10 text-blocked',
    icon: '🚫',
  },
  upcoming: {
    card: 'border-white/10 bg-white/[0.02] text-text-muted hover:border-white/20',
    badge: 'bg-transparent text-text-muted',
    icon: '⏳',
  },
};

/** Match ClickUp when workspace uses India time (calendar dates + listings). */
const DISPLAY_TIMEZONE = 'Asia/Kolkata';

const displayDateOptions = {
  timeZone: DISPLAY_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-IN', displayDateOptions);
}

const ONE_DAY_MS = 86400000;

/** Calendar date in DISPLAY_TIMEZONE (YYYY-MM-DD) for schedule lanes / comparisons. */
function toScheduleDayLabel(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return null;
  const date = new Date(Number(ms));
  return date.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
}

/** Noon on that calendar day in DISPLAY_TIMEZONE — used so timeline math ignores clock time. */
function snapToNoonIST(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return null;
  const s = new Date(Number(ms)).toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
  const [y, mo, d] = s.split('-').map(Number);
  return new Date(
    `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00+05:30`
  ).getTime();
}

/** Whole calendar days between two instants (IST dates), ignoring time-of-day. */
function calendarDaysSpanIST(startMs, endMs) {
  const a = snapToNoonIST(startMs);
  const b = snapToNoonIST(endMs);
  if (a == null || b == null) return null;
  return Math.max(0, Math.round((b - a) / ONE_DAY_MS));
}

function formatCalendarDayCount(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return '0 calendar days';
  return `${n} calendar day${n === 1 ? '' : 's'}`;
}

function taskRoot(task) {
  return task?.raw || task;
}

function getCustomFieldsList(task) {
  const root = taskRoot(task);
  return root?.customFields || root?.custom_fields || [];
}

function findCustomFieldMs(task, names) {
  const fields = getCustomFieldsList(task);
  const want = new Set(names.map((n) => String(n).trim().toLowerCase()));
  const f = fields.find((field) => want.has(String(field?.name || '').trim().toLowerCase()));
  if (!f || f.value == null || f.value === '') return null;
  const n = Number(f.value);
  return Number.isFinite(n) ? n : null;
}

function plannedStartMsFromTask(task) {
  const fromCf = findCustomFieldMs(task, ['Planned Start date', 'Planned start date']);
  if (fromCf != null) return fromCf;
  const root = taskRoot(task);
  const n = Number(root.plannedStartDate ?? root.planned_start_date);
  return Number.isFinite(n) ? n : null;
}

function plannedDueMsFromTask(task) {
  const fromCf = findCustomFieldMs(task, ['Planned Due date', 'Planned due date']);
  if (fromCf != null) return fromCf;
  const root = taskRoot(task);
  const n = Number(root.plannedDueDate ?? root.planned_due_date);
  return Number.isFinite(n) ? n : null;
}

/** Actual end: Date Done (date_done) preferred; then closed; last resort native due (deadline). */
function actualEndMsFromTask(task) {
  const root = taskRoot(task);
  const n = Number(
    task.dateDone ??
      task.actualCompletionDate ??
      root.actualCompletionDate ??
      root.dateDone ??
      root.date_done ??
      root.dateClosed ??
      root.date_closed ??
      task.dueDate ??
      root.dueDate ??
      root.due_date ??
      task.due_date
  );
  return Number.isFinite(n) ? n : null;
}

/**
 * Delay categories: planned (custom fields) vs actual start (Start date) and actual end (Date Done).
 */
function computeDelayScheduleAnalysis(task) {
  const root = taskRoot(task);
  const pStart = plannedStartMsFromTask(task);
  const pDue = plannedDueMsFromTask(task);
  const aStart =
    Number(
      task.startDate ??
        root.startDate ??
        root.actualStartDate ??
        root.start_date ??
        task.start_date
    ) || null;
  const aDue = actualEndMsFromTask(task);

  const delays = [];
  const dateKey = (ms) => (ms != null && Number.isFinite(Number(ms)) ? toScheduleDayLabel(ms) : '');
  if (pStart && pDue && aStart && aDue) {
    const pk = dateKey(pStart);
    const ak = dateKey(aStart);
    const dk = dateKey(pDue);
    const akd = dateKey(aDue);
    const plannedSpanDays = calendarDaysSpanIST(pStart, pDue);
    const actualSpanDays = calendarDaysSpanIST(aStart, aDue);
    if (ak > pk) delays.push('start');
    if (actualSpanDays != null && plannedSpanDays != null && actualSpanDays > plannedSpanDays) {
      delays.push('length');
    }
    if (akd > dk) delays.push('completion');
  }

  const ps = snapToNoonIST(pStart);
  const pd = snapToNoonIST(pDue);
  const asSnap = snapToNoonIST(aStart);
  const adSnap = snapToNoonIST(aDue);
  const candidates = [ps, pd, asSnap, adSnap].filter((x) => x != null && Number.isFinite(x));
  let timeline = null;
  if (candidates.length >= 2) {
    const tMin = Math.min(...candidates);
    const tMax = Math.max(...candidates);
    const span = Math.max(tMax - tMin, 1);
    const pctRaw = (t) => ((Number(t) - tMin) / span) * 100;
    const clampPct = (p) => Math.min(100, Math.max(0, p));
    const seg = (s, e) => {
      const lo = Math.min(s, e);
      const hi = Math.max(s, e);
      const left = clampPct(pctRaw(lo));
      const right = clampPct(pctRaw(hi));
      return { left, width: Math.max(right - left, 0.85) };
    };

    const milestoneTitles = {
      ps: 'Planned start',
      pd: 'Planned due',
      as: 'Start date',
      ad: 'Date done',
    };
    const milestones = [];
    const addM = (rawMs, key, tone) => {
      const snap = snapToNoonIST(rawMs);
      if (snap == null || !Number.isFinite(snap)) return;
      milestones.push({
        key,
        left: clampPct(pctRaw(snap)),
        date: toScheduleDayLabel(rawMs) || '—',
        tone,
        ms: rawMs,
        label: milestoneTitles[key] || key,
      });
    };
    addM(pStart, 'ps', 'planned');
    addM(pDue, 'pd', 'planned');
    addM(aStart, 'as', 'actual');
    addM(aDue, 'ad', 'actual');

    const delayZones = [];
    if (pStart && pDue && aStart && aDue && ps != null && pd != null && asSnap != null && adSnap != null) {
      const pk = dateKey(pStart);
      const ak = dateKey(aStart);
      const dk = dateKey(pDue);
      const akd = dateKey(aDue);
      const plannedSpanDays = calendarDaysSpanIST(pStart, pDue);
      const actualSpanDays = calendarDaysSpanIST(aStart, aDue);

      if (ak > pk) {
        const g = seg(ps, asSnap);
        delayZones.push({
          key: 'leader',
          label: 'Start delay: work began after planned start',
          shortLegend: 'Start delay',
          left: g.left,
          width: g.width,
          startMs: ps,
          endMs: asSnap,
          durationCalendarDays: calendarDaysSpanIST(pStart, aStart),
          barClass:
            'bg-warning/60 border-2 border-warning/90 shadow-[0_0_14px_rgba(245,158,11,0.3)]',
          swatchClass: 'bg-warning shadow-sm ring-1 ring-warning/50',
        });
      }
      if (akd > dk) {
        const g = seg(pd, adSnap);
        delayZones.push({
          key: 'owner',
          label: 'Completion delay: finished after planned due',
          shortLegend: 'Completion delay',
          left: g.left,
          width: g.width,
          startMs: pd,
          endMs: adSnap,
          durationCalendarDays: calendarDaysSpanIST(pDue, aDue),
          barClass:
            'bg-blocked/55 border-2 border-blocked/90 shadow-[0_0_14px_rgba(239,68,68,0.3)]',
          swatchClass: 'bg-blocked shadow-sm ring-1 ring-blocked/45',
        });
      }
      if (plannedSpanDays != null && actualSpanDays != null && actualSpanDays > plannedSpanDays) {
        const virtualEnd = asSnap + plannedSpanDays * ONE_DAY_MS;
        if (adSnap > virtualEnd) {
          const g = seg(virtualEnd, adSnap);
          delayZones.push({
            key: 'length',
            label: 'Length delay: actual window longer than planned span',
            shortLegend: 'Length delay',
            left: g.left,
            width: g.width,
            startMs: virtualEnd,
            endMs: adSnap,
            durationCalendarDays: calendarDaysSpanIST(virtualEnd, aDue),
            barClass:
              'bg-accent/50 border-2 border-accent/90 shadow-[0_0_14px_rgba(255,99,33,0.28)]',
            swatchClass: 'bg-accent shadow-sm ring-1 ring-accent/50',
          });
        }
      }
    }

    timeline = {
      planned: ps != null && pd != null ? seg(ps, pd) : null,
      actual: asSnap != null && adSnap != null ? seg(asSnap, adSnap) : null,
      delayZones,
      milestones,
    };
  }

  const plannedWindowCalendarDays = calendarDaysSpanIST(pStart, pDue);
  const actualWindowCalendarDays = calendarDaysSpanIST(aStart, aDue);

  return {
    delays,
    hasFullSet: Boolean(pStart && pDue && aStart && aDue),
    plannedStartLabel: toScheduleDayLabel(pStart) || 'Missing',
    plannedDueLabel: toScheduleDayLabel(pDue) || 'Missing',
    actualStartLabel: toScheduleDayLabel(aStart) || 'Not set',
    actualDueLabel: toScheduleDayLabel(aDue) || 'Not set',
    plannedWindowCalendarDays,
    actualWindowCalendarDays,
    anchorMs: { pStart, pDue, aStart, aDue },
    timeline,
  };
}

/** Chip styles for nested task tooltip — matches site theme (warning / accent / blocked). */
const DELAY_TYPE_LABEL = {
  start: 'Start delay',
  length: 'Length delay',
  completion: 'Completion delay',
};

function delayTypeChipClass(kind) {
  switch (kind) {
    case 'start':
      return 'border-warning/55 bg-warning-dim text-warning shadow-[0_0_10px_rgba(245,158,11,0.12)]';
    case 'length':
      return 'border-accent-dim bg-accent-glow text-accent-soft shadow-[0_0_10px_rgba(255,99,33,0.12)]';
    case 'completion':
      return 'border-blocked/55 bg-blocked-dim text-blocked shadow-[0_0_10px_rgba(239,68,68,0.12)]';
    default:
      return 'border-white/20 bg-white/10 text-text-secondary';
  }
}

function scheduleLaneStyle(seg) {
  if (!seg) return null;
  return {
    left: `${seg.left}%`,
    width: `${seg.width}%`,
    maxWidth: `${Math.max(0, 100 - seg.left)}%`,
  };
}

function ScheduleHoverPortal({ tip }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted || !tip || typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="tooltip"
      className="fixed z-[10050] pointer-events-none max-w-[min(280px,calc(100vw-20px))] rounded-lg border border-white/20 bg-zinc-950/98 px-2.5 py-2 shadow-2xl backdrop-blur-md"
      style={{
        left: tip.x,
        top: tip.y,
        transform: tip.placement === 'below' ? 'translate(-50%, 10px)' : 'translate(-50%, calc(-100% - 10px))',
      }}
    >
      {tip.title ? (
        <div className="text-[0.6rem] font-semibold text-cyan-100/95 border-b border-white/10 pb-1 mb-1">
          {tip.title}
        </div>
      ) : null}
      <div className="space-y-1">
        {tip.rows.map((row) =>
          row.label ? (
            <div key={row.k} className="flex justify-between gap-4 text-[0.58rem] leading-snug">
              <span className="text-text-muted shrink-0">{row.label}</span>
              <span className="text-right text-foreground/95 tabular-nums">{row.value}</span>
            </div>
          ) : (
            <div key={row.k} className="text-[0.58rem] leading-snug text-foreground/95">
              {row.value}
            </div>
          )
        )}
      </div>
    </div>,
    document.body
  );
}

function DelayTimelineBars({ analysis }) {
  const { timeline, actualWindowCalendarDays, anchorMs } = analysis;
  const { aStart: aaS, aDue: aaD } = anchorMs || {};
  const [tip, setTip] = useState(null);
  const hideT = useRef(null);

  const clearHide = useCallback(() => {
    if (hideT.current) {
      window.clearTimeout(hideT.current);
      hideT.current = null;
    }
  }, []);

  const showTip = useCallback(
    (el, payload) => {
      clearHide();
      const r = el.getBoundingClientRect();
      const centerX = r.left + r.width / 2;
      const placeAbove = r.top > 120;
      setTip({
        x: centerX,
        y: placeAbove ? r.top : r.bottom,
        placement: placeAbove ? 'above' : 'below',
        ...payload,
      });
    },
    [clearHide]
  );

  const hideTip = useCallback(() => {
    clearHide();
    hideT.current = window.setTimeout(() => setTip(null), 140);
  }, [clearHide]);

  useEffect(() => () => clearHide(), [clearHide]);

  if (!timeline || (!timeline.planned && !timeline.actual)) {
    return (
      <div className="text-[0.65rem] text-text-muted rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 leading-snug min-w-0 max-w-full">
        Add Planned Start/Due (custom fields), task Start date, and Date done in ClickUp to see a schedule comparison.
      </div>
    );
  }

  const zones = timeline.delayZones || [];
  const milestones = timeline.milestones || [];
  const leaderZone = zones.find((z) => z.key === 'leader') || null;
  const lengthZones = zones.filter((z) => z.key === 'length');
  const completionZones = zones.filter((z) => z.key === 'owner');

  const barTop = '0.875rem';
  const barStyle = { top: barTop, height: '3px' };

  return (
    <div className="min-w-0 max-w-full rounded-lg border border-white/[0.1] bg-white/[0.02] px-2.5 py-2.5 overflow-x-hidden overflow-y-visible space-y-2">
      <ScheduleHoverPortal tip={tip} />

      <div>
        <div className="text-[0.62rem] font-semibold uppercase tracking-wide text-text-secondary">Timeline</div>
        <p className="text-[0.58rem] text-text-muted leading-snug mt-0.5">
          Calendar days (Asia/Kolkata). Green = task span · amber = start delay · orange = length delay · red =
          completion delay · dots = milestones.
        </p>
      </div>

      <div className="relative w-full min-w-0 h-9 overflow-visible">
        <div
          className="absolute left-0 right-0 rounded-full bg-zinc-950/90 border border-white/10 pointer-events-none"
          style={barStyle}
        />

        {timeline.actual ? (
          <button
            type="button"
            tabIndex={0}
            className="absolute rounded-full bg-completed/88 hover:bg-completed border border-completed-dim cursor-default z-[1] focus:outline-none focus-visible:ring-2 focus-visible:ring-completed/80 shadow-[0_0_10px_rgba(34,197,94,0.2)]"
            style={{ ...scheduleLaneStyle(timeline.actual), ...barStyle }}
            onMouseEnter={(e) =>
              showTip(e.currentTarget, {
                title: 'Actual task',
                rows: [
                  { k: 's', label: 'Start (IST date)', value: toScheduleDayLabel(aaS) || '—' },
                  { k: 'e', label: 'Date done (IST)', value: toScheduleDayLabel(aaD) || '—' },
                  { k: 'd', label: 'Span', value: formatCalendarDayCount(actualWindowCalendarDays) },
                ],
              })
            }
            onMouseLeave={hideTip}
            onFocus={(e) =>
              showTip(e.currentTarget, {
                title: 'Actual task',
                rows: [
                  { k: 's', label: 'Start (IST date)', value: toScheduleDayLabel(aaS) || '—' },
                  { k: 'e', label: 'Date done (IST)', value: toScheduleDayLabel(aaD) || '—' },
                  { k: 'd', label: 'Span', value: formatCalendarDayCount(actualWindowCalendarDays) },
                ],
              })
            }
            onBlur={hideTip}
            aria-label="Actual task window"
          />
        ) : null}

        {leaderZone ? (
          <button
            type="button"
            tabIndex={0}
            className="absolute rounded-full bg-warning/88 hover:bg-warning border border-warning/70 cursor-default z-[2] focus:outline-none focus-visible:ring-2 focus-visible:ring-warning/80 shadow-[0_0_10px_rgba(245,158,11,0.28)]"
            style={{
              left: `${leaderZone.left}%`,
              width: `${leaderZone.width}%`,
              maxWidth: `${Math.max(0, 100 - leaderZone.left)}%`,
              ...barStyle,
            }}
            onMouseEnter={(e) =>
              showTip(e.currentTarget, {
                title: 'Start delay',
                rows: [
                  { k: 'd', label: 'Late by', value: formatCalendarDayCount(leaderZone.durationCalendarDays) },
                  { k: 'a', label: 'Planned start', value: toScheduleDayLabel(leaderZone.startMs) || '—' },
                  { k: 'b', label: 'Actual start', value: toScheduleDayLabel(leaderZone.endMs) || '—' },
                ],
              })
            }
            onMouseLeave={hideTip}
            onFocus={(e) =>
              showTip(e.currentTarget, {
                title: 'Start delay',
                rows: [
                  { k: 'd', label: 'Late by', value: formatCalendarDayCount(leaderZone.durationCalendarDays) },
                  { k: 'a', label: 'Planned start', value: toScheduleDayLabel(leaderZone.startMs) || '—' },
                  { k: 'b', label: 'Actual start', value: toScheduleDayLabel(leaderZone.endMs) || '—' },
                ],
              })
            }
            onBlur={hideTip}
            aria-label="Start delay"
          />
        ) : null}

        {lengthZones.map((z) => (
          <button
            key={`len-${z.left}-${z.width}`}
            type="button"
            tabIndex={0}
            className="absolute rounded-full bg-accent/85 hover:bg-accent/95 border border-accent/55 cursor-default z-[3] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/75 shadow-[0_0_10px_rgba(255,99,33,0.22)]"
            style={{
              left: `${z.left}%`,
              width: `${z.width}%`,
              maxWidth: `${Math.max(0, 100 - z.left)}%`,
              ...barStyle,
            }}
            onMouseEnter={(e) =>
              showTip(e.currentTarget, {
                title: 'Length delay',
                rows: [
                  { k: 'd', label: 'Delay duration', value: formatCalendarDayCount(z.durationCalendarDays) },
                  { k: 'a', label: 'From (IST date)', value: toScheduleDayLabel(z.startMs) || '—' },
                  { k: 'b', label: 'To (IST date)', value: toScheduleDayLabel(z.endMs) || '—' },
                ],
              })
            }
            onMouseLeave={hideTip}
            onFocus={(e) =>
              showTip(e.currentTarget, {
                title: 'Length delay',
                rows: [
                  { k: 'd', label: 'Delay duration', value: formatCalendarDayCount(z.durationCalendarDays) },
                  { k: 'a', label: 'From (IST date)', value: toScheduleDayLabel(z.startMs) || '—' },
                  { k: 'b', label: 'To (IST date)', value: toScheduleDayLabel(z.endMs) || '—' },
                ],
              })
            }
            onBlur={hideTip}
            aria-label={`Length delay ${formatCalendarDayCount(z.durationCalendarDays)}`}
          />
        ))}
        {completionZones.map((z) => (
          <button
            key={`cmp-${z.left}-${z.width}`}
            type="button"
            tabIndex={0}
            className="absolute rounded-full bg-blocked/82 hover:bg-blocked border border-blocked/55 cursor-default z-[3] focus:outline-none focus-visible:ring-2 focus-visible:ring-blocked/70 shadow-[0_0_10px_rgba(239,68,68,0.22)]"
            style={{
              left: `${z.left}%`,
              width: `${z.width}%`,
              maxWidth: `${Math.max(0, 100 - z.left)}%`,
              ...barStyle,
            }}
            onMouseEnter={(e) =>
              showTip(e.currentTarget, {
                title: 'Completion delay',
                rows: [
                  { k: 'd', label: 'Delay duration', value: formatCalendarDayCount(z.durationCalendarDays) },
                  { k: 'a', label: 'From (IST date)', value: toScheduleDayLabel(z.startMs) || '—' },
                  { k: 'b', label: 'To (IST date)', value: toScheduleDayLabel(z.endMs) || '—' },
                ],
              })
            }
            onMouseLeave={hideTip}
            onFocus={(e) =>
              showTip(e.currentTarget, {
                title: 'Completion delay',
                rows: [
                  { k: 'd', label: 'Delay duration', value: formatCalendarDayCount(z.durationCalendarDays) },
                  { k: 'a', label: 'From (IST date)', value: toScheduleDayLabel(z.startMs) || '—' },
                  { k: 'b', label: 'To (IST date)', value: toScheduleDayLabel(z.endMs) || '—' },
                ],
              })
            }
            onBlur={hideTip}
            aria-label={`Completion delay ${formatCalendarDayCount(z.durationCalendarDays)}`}
          />
        ))}

        {milestones.map((m) => (
          <button
            key={m.key}
            type="button"
            tabIndex={0}
            className="absolute z-[4] h-2 w-2 rounded-full border border-white/50 bg-black hover:bg-zinc-900 cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950 focus-visible:ring-white/50 shadow-sm"
            style={{
              left: `${m.left}%`,
              top: 'calc(0.875rem + 1.5px)',
              transform: 'translate(-50%, -50%)',
            }}
            onMouseEnter={(e) =>
              showTip(e.currentTarget, {
                title: '',
                rows: [
                  { k: 'n', label: '', value: m.label },
                  { k: 'd', label: '', value: formatDate(m.ms) },
                ],
              })
            }
            onMouseLeave={hideTip}
            onFocus={(e) =>
              showTip(e.currentTarget, {
                title: '',
                rows: [
                  { k: 'n', label: '', value: m.label },
                  { k: 'd', label: '', value: formatDate(m.ms) },
                ],
              })
            }
            onBlur={hideTip}
            aria-label={`${m.label} ${m.date}`}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.52rem] text-text-muted pt-0.5">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-completed border border-completed-dim" />
          Task
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-warning border border-warning/70" />
          Start delay
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-accent border border-accent-dim" />
          Length delay
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-blocked border border-blocked/70" />
          Completion delay
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-black border border-white/40" />
          Milestone
        </span>
      </div>

      {!analysis.hasFullSet ? (
        <p className="text-[0.52rem] text-text-muted leading-snug">
          Add planned start/due, start date, and date done for delay bands on this line.
        </p>
      ) : zones.length === 0 ? (
        <p className="text-[0.52rem] text-text-muted">No start, length, or completion delay segment on this scale.</p>
      ) : null}
    </div>
  );
}

function parseDelayedField(task) {
  const customFields = getCustomFieldsList(task);
  const delayedField = customFields.find(
    (field) => String(field?.name || '').trim().toLowerCase() === 'delayed'
  );
  if (!delayedField) return { isDelayed: null, rawValue: null, label: 'Not set' };

  const value = delayedField.value;
  const options = delayedField?.type_config?.options || [];
  const selectedByOrder = options.find((opt) => Number(opt?.orderindex) === Number(value));
  const selectedById = options.find((opt) => String(opt?.id) === String(value));
  const selected = selectedByOrder || selectedById || null;
  const selectedName = String(selected?.name || '').toLowerCase();

  if (selectedName === 'yes') return { isDelayed: true, rawValue: value, label: 'Yes' };
  if (selectedName === 'no') return { isDelayed: false, rawValue: value, label: 'No' };

  // Fallback for data that stores only order index.
  if (value === 0 || value === '0') return { isDelayed: true, rawValue: value, label: 'Yes' };
  if (value === 1 || value === '1') return { isDelayed: false, rawValue: value, label: 'No' };

  return { isDelayed: null, rawValue: value, label: 'Not set' };
}

function parseDelayDurationField(task) {
  const customFields = getCustomFieldsList(task);
  const durationField = customFields.find(
    (field) => String(field?.name || '').trim().toLowerCase() === 'delay duration'
  );
  if (!durationField) return null;
  const value = durationField.value;
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : value;
}

function normalizePsTask(task) {
  return {
    id: task.name || task.id || `task-${Math.random().toString(36).slice(2)}`,
    name: task.name || 'Untitled task',
    owner:
      typeof task.assignee === 'string'
        ? task.assignee
        : task.assignee?.username || task.owner || 'Unassigned',
    detail: task.detail || '',
    comments: [],
    statusLabel: '—',
    blockerSeverity: 'low',
    blockerType: 'workflow',
    blockerReason: '',
    delayedLabel: '—',
    delayDetails: '—',
    delayDuration: null,
    isPsTask: true,
    raw: task,
  };
}

function normalizeTask(task) {
  const rawStatus =
    task?.status?.status ||
    task?.status ||
    task?.raw?.status?.status ||
    task?.raw?.status ||
    '';
  const normalizedStatus = String(rawStatus).toLowerCase();
  const isCompleted =
    normalizedStatus.includes('complete') ||
    normalizedStatus.includes('completed') ||
    normalizedStatus.includes('done') ||
    normalizedStatus.includes('closed');

  const owner =
    task?.assignee ||
    task?.owner ||
    task?.creator?.username ||
    task?.assignees?.[0]?.username ||
    'Unassigned';

  const delayedInfo = parseDelayedField(task);
  const delayDuration = parseDelayDurationField(task);
  const blockerType = String(task?.classification?.blockerType || task?.blockerType || 'unknown').toLowerCase();
  const blockerReason = task?.classification?.blockerReason || task?.blockerReason || 'Insufficient evidence in comments';
  const aiConfidence = task?.classification?.confidence ?? task?.aiConfidence ?? null;
  const stageFromTask = Number(task?.classification?.stage || task?.stage);
  const lno = parseLnoFromName(task.name);

  const rawTop = task.raw || task;
  const dateDone =
    task.actualCompletionDate ??
    task.dateDone ??
    task.date_done ??
    rawTop.actualCompletionDate ??
    rawTop.date_done ??
    null;

  const normalizedTask = {
    id: task.id || task.name,
    name: task.name || 'Untitled task',
    owner,
    projectName: task.listName || task.list?.name || '',
    startDate: task.startDate || task.start_date || task.actualStartDate || rawTop.startDate || null,
    comments: Array.isArray(task.comments) ? task.comments : [],
    dateCreated: task.dateCreated || task.date_created || task.dateCreatedAt || null,
    dateUpdated: task.dateUpdated || task.date_updated || task.dateUpdatedAt || null,
    dueDate: task.dueDate || task.due_date || null,
    dateDone,
    completionDate:
      dateDone ||
      task.dateClosed ||
      task.date_closed ||
      task.dateCompleted ||
      rawTop.date_closed ||
      rawTop.dateClosed ||
      task.dateUpdated ||
      task.date_updated ||
      null,
    statusLabel: rawStatus || 'Unknown',
    isCompleted,
    isDelayed: delayedInfo.isDelayed,
    delayedRawValue: delayedInfo.rawValue,
    delayedLabel: delayedInfo.label,
    delayDuration,
    blockerType,
    blockerReason,
    aiConfidence,
    lnoTier: lno.tier,
    lnoLevel: lno.level,
    lnoLabel: lno.label,
    stageNumber: stageFromTask >= 1 && stageFromTask <= 6 ? stageFromTask : 1,
    raw: task,
  };
  if (normalizedTask.delayedLabel === 'Yes' && normalizedTask.delayDuration !== null) {
    normalizedTask.delayDetails = `Yes`;
  } else {
    normalizedTask.delayDetails = normalizedTask.delayedLabel;
  }
  return normalizedTask;
}

function lnoBadgeClass(tier) {
  if (tier === 'L') return 'bg-blocked/20 text-blocked border border-blocked/40';
  if (tier === 'N') return 'bg-accent/20 text-accent border border-accent/40';
  if (tier === 'O') return 'bg-yellow-500/20 text-yellow-200 border border-yellow-500/40';
  return 'bg-white/10 text-text-muted border border-white/20';
}

const AMS_TOOLTIP_BADGE_TEXT = {
  leverage: 'Leverage (L)',
  neutral: 'Neutral (N)',
  overhead: 'Overhead (O)',
  unknown_lno: 'No L/N/O tag',
  upcoming: 'Upcoming',
};

const LNO_SECTION_META = [
  { tier: 'L', title: 'Leverage', barClass: 'border-l-blocked text-blocked' },
  { tier: 'N', title: 'Neutral', barClass: 'border-l-accent text-accent' },
  { tier: 'O', title: 'Overhead', barClass: 'border-l-yellow-400 text-yellow-200' },
];

function buildAmsTooltipSections(tasks, filter) {
  const filtered = filter === 'all' ? tasks : tasks.filter((t) => t.lnoTier === filter);
  const sections = [];
  for (const { tier, title, barClass } of LNO_SECTION_META) {
    const slice = filtered.filter((t) => t.lnoTier === tier).sort(compareLnoTasks);
    if (slice.length) sections.push({ key: tier, title, barClass, tasks: slice });
  }
  const other = filtered
    .filter((t) => !t.lnoTier)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  if (other.length) {
    sections.push({
      key: 'other',
      title: 'Other (no L/N/O tag)',
      barClass: 'border-l-white/35 text-text-muted',
      tasks: other,
    });
  }
  return sections;
}

function mapAmsStages(data) {
  const tasksRaw = Array.isArray(data?.tasks) ? data.tasks : (Array.isArray(data) ? data : []);
  const tasks = tasksRaw.map((task) => normalizeTask(task));
  const summaries = Array.isArray(data?.stageSummary) ? data.stageSummary : [];
  const summaryMap = new Map(summaries.map((s) => [Number(s.stageNumber), s]));
  const grouped = new Map();
  for (let i = 1; i <= 6; i += 1) grouped.set(i, []);

  tasks.forEach((task) => {
    const safeStage = task.stageNumber >= 1 && task.stageNumber <= 6 ? task.stageNumber : 6;
    grouped.get(safeStage).push(task);
  });

  return Array.from({ length: 6 }, (_, idx) => {
    const stageNumber = idx + 1;
    const stageTasks = (grouped.get(stageNumber) || []).slice().sort(compareLnoTasks);

    const s = summaryMap.get(stageNumber);
    const stageCounts = {
      delayed: Number(s?.delayed ?? stageTasks.length ?? 0),
      lnoLeverage: Number(
        s?.lnoLeverage ?? stageTasks.filter((t) => t.lnoTier === 'L').length
      ),
      lnoNeutral: Number(s?.lnoNeutral ?? stageTasks.filter((t) => t.lnoTier === 'N').length),
      lnoOverhead: Number(s?.lnoOverhead ?? stageTasks.filter((t) => t.lnoTier === 'O').length),
      lnoUnparsed: Number(
        s?.lnoUnparsed ?? stageTasks.filter((t) => !t.lnoTier).length
      ),
    };

    const typeCounts = stageTasks.reduce((acc, task) => {
      const key = task.blockerType || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const topBlockerType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';

    const status = stageTasks.length === 0 ? 'upcoming' : stageHeatFromLnoTasks(stageTasks);

    return {
      stageNumber,
      status,
      taskCount: stageTasks.length,
      tasks: stageTasks,
      title: AMS_STAGE_NAMES[stageNumber],
      stageCounts,
      topBlockerType,
    };
  });
}

const ArrowDown = () => (
  <div className="relative h-8 w-full flex items-center justify-center">
    <div className="h-full w-0.5 bg-white/35" />
    <div className="absolute bottom-[2px] h-2 w-2 rotate-45 border-r-[1.5px] border-b-[1.5px] border-white/35" />
  </div>
);

function getPsStage(stages, num) {
  return (
    stages.find((s) => s.stageNumber === num) || {
      stageNumber: num,
      status: 'upcoming',
      taskCount: 0,
      tasks: [],
      title: `Stage ${num}`,
    }
  );
}

/** PS chart: orange if stage has any mapped tasks; otherwise neutral (ignore legacy completed/green). */
function psStageHeatStatus(stage) {
  const n = Number(stage?.taskCount ?? stage?.tasks?.length ?? 0);
  return n > 0 ? 'active' : 'upcoming';
}

function PsDownArrow({ label }) {
  return (
    <div className="relative flex flex-col items-center justify-center w-full h-4 shrink-0">
      <div className="w-0.5 h-full bg-white/30" />
      <div className="absolute bottom-[-1px] w-1.5 h-1.5 border-r-[1.5px] border-b-[1.5px] border-white/30 transform rotate-45 z-10" />
      {label && (
        <span className="absolute left-[calc(50%+5px)] top-1/2 -translate-y-1/2 text-[0.5rem] font-bold text-completed">
          {label}
        </span>
      )}
    </div>
  );
}

function PsUpArrow({ label }) {
  return (
    <div className="relative flex flex-col items-center justify-center w-full h-4 shrink-0">
      <div className="w-0.5 h-full bg-white/30" />
      <div className="absolute top-[1px] w-1.5 h-1.5 border-t-[1.5px] border-l-[1.5px] border-white/30 transform rotate-45 z-10" />
      {label && (
        <span className="absolute left-[calc(50%+5px)] top-1/2 -translate-y-1/2 text-[0.5rem] font-bold text-completed">
          {label}
        </span>
      )}
    </div>
  );
}

function PsDiamondPlaceholder({ label }) {
  return (
    <div className="relative flex justify-center py-[6px] w-full">
      <div className="relative flex items-center justify-center h-[4.25rem] w-[4.25rem]">
        <div className="absolute inset-0 m-auto h-14 w-14 rotate-45 border-2 border-border bg-[#111]" />
        <span className="relative z-10 max-w-[4.5rem] text-center text-[0.42rem] font-medium leading-tight text-text-secondary">
          {label}
        </span>
      </div>
    </div>
  );
}

function PsNode({ num, stages, onMouseEnter, onMouseLeave }) {
  const stage = getPsStage(stages, num);
  const heat = psStageHeatStatus(stage);
  const config = psWorkflowStatusConfig[heat] || psWorkflowStatusConfig.upcoming;
  return (
    <div className="relative flex justify-center py-[5px] w-full animate-fade-up" style={{ animationDelay: `${num * 0.04}s` }}>
      <button
        type="button"
        className={`relative z-10 cursor-pointer group w-44 border-2 rounded-md px-2.5 py-2 text-center transition-all duration-300 hover:-translate-y-0.5 ${config.card}`}
        onMouseEnter={(e) => onMouseEnter(e, { ...stage, status: heat })}
        onMouseLeave={onMouseLeave}
      >
        <div className="text-[0.5rem] opacity-60 uppercase tracking-widest mb-0.5 font-bold">Stage {num}</div>
        <div className="text-[0.7rem] font-semibold leading-tight">{stage.title}</div>
      </button>
    </div>
  );
}

function PsDiamondNode({ stage, onMouseEnter, onMouseLeave }) {
  const heat = psStageHeatStatus(stage);
  const config = psWorkflowStatusConfig[heat] || psWorkflowStatusConfig.upcoming;
  const label =
    stage.stageNumber === 8
      ? 'Meets design expectations?'
      : stage.title || 'Decision';
  return (
    <div className="relative flex justify-center py-2 w-full animate-fade-up">
      <button
        type="button"
        className="group relative flex h-[5.25rem] w-[5.25rem] shrink-0 items-center justify-center"
        onMouseEnter={(e) => onMouseEnter(e, { ...stage, status: heat })}
        onMouseLeave={onMouseLeave}
        aria-label={label}
      >
        <div
          className={`absolute inset-0 m-auto h-[4.25rem] w-[4.25rem] rotate-45 border-2 transition-transform duration-300 group-hover:scale-[1.06] ${config.card}`}
        />
        <span className="relative z-10 max-w-[5rem] px-1 text-center text-[0.55rem] font-semibold leading-snug text-foreground">
          {label}
        </span>
      </button>
    </div>
  );
}

function StageBox({ stage, onMouseEnter, onMouseLeave }) {
  const config = statusConfig[stage.status] || statusConfig.upcoming;
  return (
    <div className="relative w-full flex justify-center">
      <button
        type="button"
        onMouseEnter={(event) => onMouseEnter(event, stage)}
        onMouseLeave={onMouseLeave}
        className={`w-[270px] border rounded-sm px-5 py-4 text-center transition-all duration-300 hover:-translate-y-0.5 ${config.card}`}
      >
        <div className="text-sm font-medium leading-tight">{stage.title}</div>
      </button>
    </div>
  );
}

export default function Pipeline({ data, teamLabel = 'AMS Team', teamKey = 'ams' }) {
  const [tooltip, setTooltip] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });
  const [subTooltip, setSubTooltip] = useState(null);
  const [subTooltipTop, setSubTooltipTop] = useState(12);
  const [subTooltipHeight, setSubTooltipHeight] = useState(360);
  const [subTooltipOnLeft, setSubTooltipOnLeft] = useState(false);
  const [subTooltipAnchorY, setSubTooltipAnchorY] = useState(0);
  const [tooltipLnoFilter, setTooltipLnoFilter] = useState('all');
  const [amsDeliveryModalOpen, setAmsDeliveryModalOpen] = useState(false);
  const timeoutRef = useRef(null);
  const tooltipRef = useRef(null);

  const subTooltipSchedule = useMemo(() => {
    if (!subTooltip || teamKey === 'ps') return null;
    return computeDelayScheduleAnalysis(subTooltip);
  }, [subTooltip, teamKey]);

  const subTooltipCommentsSorted = useMemo(() => {
    if (!subTooltip?.comments?.length) return [];
    return [...subTooltip.comments].sort((a, b) => Number(a.date || 0) - Number(b.date || 0));
  }, [subTooltip]);

  const stages = useMemo(() => {
    if (teamKey === 'ams') return mapAmsStages(data);
    if (teamKey === 'ps') {
      if (!Array.isArray(data?.stages)) return [];
      return data.stages.map((stage) => ({
        ...stage,
        title: stage.stageName || stage.title || `Stage ${stage.stageNumber}`,
        taskCount: Number(stage.taskCount || stage.tasks?.length || 0),
        tasks: Array.isArray(stage.tasks) ? stage.tasks.map((t) => normalizePsTask(t)) : [],
      }));
    }
    if (!Array.isArray(data?.stages)) return [];
    return data.stages.map((stage) => ({
      ...stage,
      title: stage.title || stage.stageName || `Stage ${stage.stageNumber}`,
      taskCount: Number(stage.taskCount || stage.tasks?.length || 0),
      tasks: Array.isArray(stage.tasks) ? stage.tasks.map((task) => normalizeTask(task)) : [],
      stageCounts: {
        delayed: Number(stage.taskCount || stage.tasks?.length || 0),
        lnoLeverage: 0,
        lnoNeutral: 0,
        lnoOverhead: 0,
        lnoUnparsed: 0,
      },
      topBlockerType: 'none',
    }));
  }, [data, teamKey]);

  const handleMouseEnter = (event, stage) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    const pad = 16;
    const width = 360;
    const height = 390;
    let left = event.clientX + pad;
    let top = event.clientY + pad;
    if (left + width > window.innerWidth) left = event.clientX - width - pad;
    if (top + height > window.innerHeight) top = Math.max(pad, window.innerHeight - height - pad);
    setTooltipPos({ left, top });
    setTooltip(stage);
    setSubTooltip(null);
    if (teamKey === 'ams') setTooltipLnoFilter('all');
  };

  const closeTooltips = (event) => {
    const nextTarget = event?.relatedTarget;
    const isDomNode =
      nextTarget &&
      (nextTarget instanceof Node ||
        (typeof nextTarget === 'object' && 'nodeType' in nextTarget));

    if (isDomNode && tooltipRef.current?.contains(nextTarget)) {
      return;
    }
    timeoutRef.current = setTimeout(() => {
      setTooltip(null);
      setSubTooltip(null);
    }, 320);
  };

  const keepTooltips = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const openSubTooltip = (event, task) => {
    const containerRect = tooltipRef.current?.getBoundingClientRect();
    const containerHeight = tooltipRef.current?.clientHeight || 0;
    const rowRect = event.currentTarget.getBoundingClientRect();
    const baseTop = containerRect ? rowRect.top - containerRect.top - 8 : 12;

    // Keep nested tooltip fully inside viewport and parent hover bounds.
    const viewportPad = 10;
    const desiredHeight = teamKey === 'ps' ? 360 : 440;
    const maxFromViewport = Math.max(220, window.innerHeight - (viewportPad * 2));
    const maxFromContainer = containerHeight ? Math.max(220, containerHeight - 16) : desiredHeight;
    const nestedHeight = Math.min(desiredHeight, maxFromViewport, maxFromContainer);
    setSubTooltipHeight(nestedHeight);

    const minTopViewport = containerRect ? Math.max(8, viewportPad - containerRect.top) : 8;
    const maxTopViewport = containerRect
      ? window.innerHeight - viewportPad - nestedHeight - containerRect.top
      : baseTop;
    const minTop = minTopViewport;
    const maxTopFromContainer = containerHeight
      ? containerHeight - nestedHeight - 8
      : baseTop;
    const maxTop = Math.max(minTop, Math.min(maxTopFromContainer, maxTopViewport));
    const clampedTop = Math.min(Math.max(baseTop, minTop), maxTop);

    setSubTooltipTop(clampedTop);
    setSubTooltipAnchorY(rowRect.top + rowRect.height / 2);
    setSubTooltip(task);
    setSubTooltipOnLeft(tooltipPos.left + 730 > window.innerWidth);
  };

  return (
    <section className="h-full w-full flex items-center justify-center p-4 overflow-hidden">
      <div className="w-full max-w-[980px] h-full flex flex-col bg-card border border-border rounded-2xl relative overflow-hidden">
        <h2 className="text-center text-[0.65rem] font-bold uppercase tracking-[0.15em] text-text-secondary pt-4 pb-2 shrink-0">
          {teamKey === 'ams' ? `${teamLabel} · AMS Workflow` : teamKey === 'ps' ? `${teamLabel} · Test Flow` : `${teamLabel} · Flowchart`}
        </h2>
        {teamKey === 'ams' && (
          <div className="px-4 pb-2 shrink-0 flex justify-center">
            <div className="flex flex-wrap items-center justify-center gap-2 text-[0.65rem] text-text-muted">
              <span className="px-2 py-0.5 rounded bg-blocked/15 text-blocked">L Leverage · red</span>
              <span className="px-2 py-0.5 rounded bg-accent/15 text-accent">N Neutral · orange</span>
              <span className="px-2 py-0.5 rounded bg-yellow-500/15 text-yellow-200">O Overhead · yellow</span>
              <span className="px-2 py-0.5 rounded bg-completed/15 text-completed">No tag · muted</span>
            </div>
          </div>
        )}

        <div className="flex-1 flex items-center justify-center px-2 sm:px-6 pb-6 min-h-0 overflow-auto">
          {teamKey === 'ps' ? (
            <div className="relative w-full max-w-[900px] py-2">
              <div className="flex items-end justify-center w-full gap-0 sm:gap-1">
                <div className="flex flex-col items-center w-[11.5rem] sm:w-48 shrink-0">
                  <PsNode num={1} stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                  <PsDownArrow />
                  <PsNode num={2} stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                  <PsDownArrow />
                  <PsNode num={3} stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                  <PsDownArrow />
                  <PsDiamondPlaceholder label="FW code required?" />
                  <PsDownArrow label="YES" />
                  <PsNode num={4} stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                  <PsDownArrow />
                  <PsDiamondPlaceholder label="Automation needed?" />
                  <PsDownArrow label="YES" />
                  <PsNode num={5} stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                </div>

                <div className="flex items-center shrink-0 w-6 sm:w-12 lg:w-20 h-[52px]">
                  <div className="w-full h-0.5 bg-white/30 relative">
                    <div className="absolute right-[1px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 border-r-[1.5px] border-t-[1.5px] border-white/30 transform rotate-45" />
                  </div>
                </div>

                <div className="flex flex-col items-center w-[11.5rem] sm:w-48 shrink-0">
                  <PsNode num={11} stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                  <PsUpArrow />
                  <PsNode num={10} stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                  <PsUpArrow />
                  <PsNode num={9} stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                  <PsUpArrow label="YES" />
                  <PsDiamondNode
                    stage={getPsStage(stages, 8)}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={closeTooltips}
                  />
                  <PsUpArrow />
                  <PsNode num={7} stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                  <PsUpArrow />
                  <PsNode num={6} stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                </div>
              </div>
            </div>
          ) : (
            <div className="relative w-[360px] flex flex-col items-center gap-2">
              {teamKey === 'ams' && (
                <button
                  type="button"
                  onClick={() => setAmsDeliveryModalOpen(true)}
                  className="shrink-0 text-[0.65rem] font-medium uppercase tracking-wider px-3 py-1 rounded-full border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/60 transition-colors"
                >
                  Performance
                </button>
              )}
              <div className="relative w-full">
                <div className="flex flex-col items-center gap-1">
                  {stages.map((stage, index) => (
                    <div key={stage.stageNumber} className="w-full">
                      <StageBox stage={stage} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
                      {index < stages.length - 1 && <ArrowDown />}
                    </div>
                  ))}
                </div>

                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  viewBox="0 0 360 760"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M330 300 C385 300, 385 210, 330 200"
                    fill="none"
                    stroke="rgba(255,255,255,0.35)"
                    strokeWidth="2"
                  />
                  <path
                    d="M330 680 C385 680, 385 590, 330 580"
                    fill="none"
                    stroke="rgba(255,255,255,0.35)"
                    strokeWidth="2"
                  />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>

      {tooltip && (
        <div
          className="fixed z-[9999] flex flex-col max-h-[min(390px,90vh)] w-[360px] max-w-[min(360px,calc(100vw-24px))] bg-[#111] border border-white/[0.08] rounded-xl p-4 shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
          style={{ left: tooltipPos.left, top: tooltipPos.top }}
          onMouseEnter={keepTooltips}
          onMouseLeave={closeTooltips}
          ref={tooltipRef}
        >
          <div className="flex flex-wrap items-center gap-2 mb-2 pb-2 border-b border-white/[0.08] shrink-0 min-w-0">
            <span
              className={`text-[0.6rem] font-semibold tracking-wider uppercase px-2 py-0.5 rounded max-w-full min-w-0 truncate ${
                teamKey === 'ps'
                  ? (psWorkflowStatusConfig[tooltip.status] || psWorkflowStatusConfig.upcoming).badge
                  : (statusConfig[tooltip.status] || statusConfig.upcoming).badge
              }`}
            >
              {teamKey === 'ps'
                ? `${(psWorkflowStatusConfig[tooltip.status] || psWorkflowStatusConfig.upcoming).icon} ${String(tooltip.status || 'upcoming').toUpperCase()}`
                : `${(statusConfig[tooltip.status] || statusConfig.upcoming).icon} ${
                    teamKey === 'ams'
                      ? AMS_TOOLTIP_BADGE_TEXT[tooltip.status] || String(tooltip.status || 'upcoming').toUpperCase()
                      : String(tooltip.status || 'upcoming').toUpperCase()
                  }`}
            </span>
            <span className="text-xs text-text-secondary shrink-0">Stage {tooltip.stageNumber}</span>
          </div>
          <div className="text-sm font-semibold mb-2 shrink-0 min-w-0 break-words leading-snug">{tooltip.title}</div>
          {teamKey === 'ams' && (
            <div className="flex flex-wrap gap-1.5 mb-2 text-[0.62rem] shrink-0 min-w-0">
              <div className="rounded px-1.5 py-1 border border-white/10 text-text-muted shrink-0">
                Delayed: {tooltip.stageCounts?.delayed ?? 0}
              </div>
              <div className="rounded px-1.5 py-1 border border-blocked/35 text-blocked shrink-0">
                L: {tooltip.stageCounts?.lnoLeverage ?? 0}
              </div>
              <div className="rounded px-1.5 py-1 border border-accent/35 text-accent shrink-0">
                N: {tooltip.stageCounts?.lnoNeutral ?? 0}
              </div>
              <div className="rounded px-1.5 py-1 border border-yellow-500/35 text-yellow-200 shrink-0">
                O: {tooltip.stageCounts?.lnoOverhead ?? 0}
              </div>
              <div className="rounded px-1.5 py-1 border border-white/10 text-text-muted shrink-0 min-w-0">
                No tag: {tooltip.stageCounts?.lnoUnparsed ?? 0}
              </div>
            </div>
          )}
          {teamKey !== 'ps' && teamKey !== 'ams' && (
            <div className="grid grid-cols-3 gap-1 mb-2 text-[0.65rem] shrink-0 min-w-0">
              <div className="rounded px-1.5 py-1 border border-white/10 text-text-muted min-w-0">Tasks: {tooltip.taskCount || 0}</div>
              <div className="rounded px-1.5 py-1 border border-white/10 text-text-muted truncate col-span-2 min-w-0">
                Top: {tooltip.topBlockerType || 'none'}
              </div>
            </div>
          )}
          <div className="text-[0.7rem] text-text-muted mb-2 shrink-0">{tooltip.taskCount} task(s)</div>
          {teamKey === 'ams' && (
            <div className="flex flex-wrap gap-1 mb-2 shrink-0 min-w-0">
              {[
                { key: 'all', label: 'All' },
                { key: 'L', label: 'L' },
                { key: 'N', label: 'N' },
                { key: 'O', label: 'O' },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setTooltipLnoFilter(f.key)}
                  onMouseEnter={keepTooltips}
                  className={`text-[0.62rem] px-2 py-1 rounded border transition-colors shrink-0 ${
                    tooltipLnoFilter === f.key
                      ? 'border-accent bg-accent/20 text-accent'
                      : 'border-border text-text-secondary hover:border-accent/40'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto pr-1 -mr-1 custom-scrollbar">
            {teamKey === 'ps' && tooltip.tasks.length === 0 && (
              <div className="text-text-muted text-sm">No tasks in this stage.</div>
            )}
            {teamKey === 'ps' &&
              tooltip.tasks.map((task) => (
                <div
                  key={task.id}
                  className="relative py-2.5 border-b border-white/[0.05] last:border-b-0 cursor-default min-w-0"
                >
                  <div className="min-w-0 max-w-full">
                    <div className="text-sm text-foreground/95 truncate">{task.name}</div>
                    <div className="text-xs text-accent-soft/80 mt-0.5 truncate">{task.owner}</div>
                    {task.detail ? (
                      <div className="text-xs text-foreground/75 mt-1.5 leading-relaxed whitespace-pre-wrap break-words overflow-x-hidden max-w-full">
                        {task.detail}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            {teamKey === 'ams' && tooltip.tasks.length === 0 && (
              <div className="text-text-muted text-sm">No tasks in this stage.</div>
            )}
            {teamKey === 'ams' &&
              (() => {
                const sections = buildAmsTooltipSections(tooltip.tasks, tooltipLnoFilter);
                if (sections.length === 0) {
                  return <div className="text-text-muted text-sm">No tasks match this filter.</div>;
                }
                return sections.map((section) => (
                  <div key={section.key} className="mb-3 last:mb-0 min-w-0">
                    <div
                      className={`text-[0.6rem] font-semibold uppercase tracking-wide mb-1.5 pl-2 border-l-2 min-w-0 break-words pr-1 ${section.barClass}`}
                    >
                      {section.title} · {section.tasks.length}
                    </div>
                    {section.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="relative py-2 border-b border-white/[0.05] last:border-b-0 cursor-default min-w-0"
                        onMouseEnter={(event) => openSubTooltip(event, task)}
                      >
                        <div className="min-w-0 max-w-full">
                          <div className="flex items-start gap-2 min-w-0 max-w-full">
                            <span
                              className={`text-[0.6rem] px-1.5 py-0.5 rounded shrink-0 ${lnoBadgeClass(task.lnoTier)}`}
                            >
                              {task.lnoLabel || '—'}
                            </span>
                            <div className="text-sm text-foreground/95 min-w-0 flex-1 truncate leading-snug">
                              {task.name}
                            </div>
                          </div>
                          <div className="text-xs text-accent-soft/80 mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                            <span className="min-w-0 max-w-full truncate">{task.owner}</span>
                            <span
                              className={`min-w-0 max-w-full break-words ${task.delayedLabel === 'Yes' ? 'text-blocked' : 'text-completed'}`}
                            >
                              Delay: {task.delayDetails}
                              {task.delayedLabel === 'Yes' && task.delayDuration !== null ? ` (${task.delayDuration}d)` : ''}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ));
              })()}
            {teamKey !== 'ps' && teamKey !== 'ams' && tooltip.tasks.length === 0 && (
              <div className="text-text-muted text-sm">No tasks in this stage.</div>
            )}
            {teamKey !== 'ps' &&
              teamKey !== 'ams' &&
              tooltip.tasks.map((task) => (
                <div
                  key={task.id}
                  className="relative py-2.5 border-b border-white/[0.05] last:border-b-0 cursor-default min-w-0"
                  onMouseEnter={(event) => openSubTooltip(event, task)}
                >
                  <div className="min-w-0 max-w-full">
                    <div className="flex items-start gap-2 min-w-0 max-w-full">
                      <span className={`text-[0.6rem] px-1.5 py-0.5 rounded shrink-0 ${lnoBadgeClass(task.lnoTier)}`}>
                        {task.lnoLabel || '—'}
                      </span>
                      <div className="text-sm text-foreground/95 min-w-0 flex-1 truncate leading-snug">{task.name}</div>
                    </div>
                    <div className="text-xs text-accent-soft/80 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 min-w-0">
                      <span className="min-w-0 max-w-full truncate">{task.owner}</span>
                      <span
                        className={`min-w-0 max-w-full break-words ${task.delayedLabel === 'Yes' ? 'text-blocked' : 'text-completed'}`}
                      >
                        Delay: {task.delayDetails}
                        {task.delayedLabel === 'Yes' && task.delayDuration !== null ? ` (${task.delayDuration}d)` : ''}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
          </div>

          {subTooltip && teamKey !== 'ps' && subTooltipSchedule && (
            <div
              className={`absolute min-w-0 w-[min(380px,calc(100vw-36px))] max-w-[calc(100vw-36px)] bg-[#0d0d0d] border border-white/[0.14] rounded-xl p-3.5 shadow-[0_16px_42px_rgba(0,0,0,0.55)] overflow-x-hidden overflow-y-auto overscroll-contain custom-scrollbar ${
                subTooltipOnLeft ? 'right-[calc(100%+2px)]' : 'left-[calc(100%+2px)]'
              }`}
              style={{ top: subTooltipTop, height: subTooltipHeight }}
              onMouseEnter={keepTooltips}
              onMouseLeave={closeTooltips}
            >
              {/* Bridge removes hover gap between parent and nested cards */}
              <div
                className={`absolute top-0 h-full w-3 ${subTooltipOnLeft ? '-right-3' : '-left-3'}`}
                style={{ pointerEvents: 'auto' }}
                onMouseEnter={keepTooltips}
              />
              <div
                className={`pointer-events-none absolute top-1/2 -translate-y-1/2 h-2.5 w-2.5 rotate-45 border border-white/[0.12] bg-[#0d0d0d] ${
                  subTooltipOnLeft ? '-right-[5px]' : '-left-[5px]'
                }`}
                style={{
                  top: subTooltipAnchorY
                    ? `${Math.max(16, Math.min(subTooltipAnchorY - tooltipPos.top, 300))}px`
                    : '50%',
                }}
              />

              <div className="flex items-start justify-between gap-2 mb-1.5 min-w-0">
                <div className="text-sm font-semibold leading-snug min-w-0 break-words pr-1">{subTooltip.name}</div>
                <span className={`text-[0.6rem] px-2 py-0.5 rounded shrink-0 ${lnoBadgeClass(subTooltip.lnoTier)}`}>
                  {subTooltip.lnoLabel || '—'}
                </span>
              </div>

              {subTooltip.projectName ? (
                <div className="text-[0.65rem] text-text-muted mb-2 truncate" title={subTooltip.projectName}>
                  <span className="text-text-secondary/90">Project:</span> {subTooltip.projectName}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs mb-3 pb-3 border-b border-white/[0.08]">
                <div className="min-w-0">
                  <div className="text-[0.6rem] uppercase tracking-wide text-text-muted">Owner</div>
                  <div className="text-foreground/95 truncate mt-0.5">{subTooltip.owner}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[0.6rem] uppercase tracking-wide text-text-muted">Start date</div>
                  <div className="text-foreground/95 mt-0.5">{formatDate(subTooltip.startDate)}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[0.6rem] uppercase tracking-wide text-text-muted">Due date</div>
                  <div className="text-foreground/95 mt-0.5">{formatDate(subTooltip.dueDate)}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[0.6rem] uppercase tracking-wide text-text-muted">Date done</div>
                  <div className="text-foreground/95 mt-0.5">{formatDate(subTooltip.dateDone)}</div>
                </div>
              </div>

              <div className="mb-3">
                <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-text-secondary mb-1.5">
                  Delay category
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {subTooltipSchedule.delays.length === 0 ? (
                    <span className="text-[0.62rem] px-2 py-1 rounded-md border border-white/12 text-text-muted leading-snug">
                      {subTooltipSchedule.hasFullSet
                        ? 'No start, length, or completion pattern from these dates'
                        : 'Need planned start & due, start date, and date done'}
                    </span>
                  ) : (
                    subTooltipSchedule.delays.map((kind) => (
                      <span
                        key={kind}
                        className={`text-[0.62rem] px-2 py-1 rounded-md border leading-snug ${delayTypeChipClass(kind)}`}
                      >
                        {DELAY_TYPE_LABEL[kind] || kind}
                      </span>
                    ))
                  )}
                </div>
                <DelayTimelineBars analysis={subTooltipSchedule} />
              </div>

              <div className="mb-3">
                <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-text-secondary mb-1">Reasoning</div>
                <p className="text-xs leading-relaxed text-foreground/90 rounded-md border border-white/10 bg-white/[0.03] px-2 py-2 break-words">
                  {subTooltip.blockerReason}
                </p>
              </div>

              <div>
                <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-text-secondary mb-1.5">Comments</div>
                <div className="pr-1 -mr-1 space-y-2">
                  {subTooltipCommentsSorted.length === 0 ? (
                    <div className="text-xs text-text-muted">No comments yet.</div>
                  ) : (
                    subTooltipCommentsSorted.map((comment, index) => (
                      <div
                        key={`${subTooltip.id}-c-${index}-${comment.date || index}`}
                        className="text-xs rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5"
                      >
                        <div className="text-text-secondary text-[0.65rem]">
                          {comment.author || 'Unknown'} · {formatDate(comment.date)}
                        </div>
                        <div className="text-foreground/90 mt-1 break-words whitespace-pre-wrap">
                          {comment.comment || comment.text || ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <AmsDeliveryInsightModal
        open={amsDeliveryModalOpen}
        onClose={() => setAmsDeliveryModalOpen(false)}
      />
    </section>
  );
}
