'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { compareLnoTasks, parseLnoFromName, stageHeatFromLnoTasks } from '../../../lno.js';
import AmsDeliveryInsightModal from './AmsDeliveryInsightModal';
import AmsTaskNestedDetail from './AmsTaskNestedDetail';

/** Task nested hover: fixed target height (capped by viewport), not tied to parent tooltip height. */
const NESTED_SUBTOOLTIP_HEIGHT_PX = 560;
/** Max width for delay-analysis nested panel (“what went wrong”) — keeps it on-screen beside the main tooltip. */
const NESTED_SUBTOOLTIP_MAX_WIDTH_PX = 520;

const STAGE_TOOLTIP_WIDTH_PX = 420;
const VIEWPORT_PAD_PX = 12;

/**
 * Simple fixed position for the stage tooltip: place beside the stage (right, else left),
 * align top with stage top, clamp so the box (up to max-h) stays in the viewport.
 */
function getSimpleStageTooltipPosition(event) {
  const pad = VIEWPORT_PAD_PX;
  const w = STAGE_TOOLTIP_WIDTH_PX;
  const maxH = Math.min(560, Math.floor(window.innerHeight * 0.88));
  const el = event?.currentTarget;
  const rect = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    const cx = Number(event?.clientX) || 0;
    const cy = Number(event?.clientY) || 0;
    let left = cx + 16;
    if (left + w > window.innerWidth - pad) left = cx - w - 16;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    let top = cy - 24;
    top = Math.max(pad, Math.min(top, window.innerHeight - maxH - pad));
    return { left, top };
  }

  let left = rect.right + pad;
  if (left + w > window.innerWidth - pad) {
    left = rect.left - w - pad;
  }
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));

  let top = rect.top;
  top = Math.max(pad, Math.min(top, window.innerHeight - pad - maxH));
  return { left, top };
}

const AMS_STAGE_NAMES = {
  1: 'Initial Module Spec',
  2: 'Mathematical Modeling of the Module',
  3: 'Mathematical Sim in Python',
  4: 'Circuit Implementation and Sim',
  5: 'Layout',
  6: 'Post Layout Sim',
};

/** RTL 11-stage workflow (matches analyze_rtl_workflow.js RTL_STAGE_NAMES) */
const RTL_STAGE_NAMES = [
  'Initial Spec Discussion',        // 1
  'Block Diagram Discussion',       // 2
  'RTL Implementation',             // 3
  'Test Case Creation & Discussion',// 4
  'Lint and CDC Check',             // 5
  'Regression and Corner Sim',      // 6
  'Code Coverage',                  // 7
  'Constraints and UPF File Creation',// 8
  'Doc Creation',                   // 9
  'Release to PD, Floor Planning',  // 10
  'SDF and NLP Sim',                // 11
];

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
  if (n === 0) return '0 days';
  return `${n} day${n === 1 ? '' : 's'}`;
}

function formatSignedDayDelta(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return '0 days';
  const abs = Math.abs(n);
  return `${n > 0 ? '+' : '-'}${abs} day${abs === 1 ? '' : 's'}`;
}

function formatTimelineDate(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  return new Date(Number(ms)).toLocaleDateString('en-US', {
    timeZone: DISPLAY_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
  const root = taskRoot(task);
  // Per AMS classified payload: planned start is task Start date.
  const n = Number(
    root.startDate ??
      root.start_date ??
      task.startDate ??
      task.start_date ??
      findCustomFieldMs(task, ['planned start', 'planned start date'])
  );
  return Number.isFinite(n) ? n : null;
}

function plannedDueMsFromTask(task) {
  const root = taskRoot(task);
  // Per AMS classified payload: planned due is plannedDueDate.
  const n = Number(
    root.plannedDueDate ??
      root.planned_due_date ??
      task.plannedDueDate ??
      task.planned_due_date ??
      root.dueDate ??
      root.due_date ??
      task.dueDate ??
      task.due_date ??
      findCustomFieldMs(task, ['planned due', 'planned due date'])
  );
  return Number.isFinite(n) ? n : null;
}

/** Actual end: Date Done (date_done) preferred; then closed; last resort native due (deadline). */
function actualEndMsFromTask(task) {
  const root = taskRoot(task);
  const n = Number(
    // Per AMS classified payload: actual completed date is actualCompletionDate.
    task.actualCompletionDate ??
      root.actualCompletionDate ??
      task.dateDone ??
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

/** Actual due date from ClickUp (not the planned one from custom fields). */
function actualDueMsFromTask(task) {
  const root = taskRoot(task);
  const n = Number(
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
      // Per AMS classified payload: actual start is actualStartDate.
      task.actualStartDate ??
        root.actualStartDate ??
        task.actual_start_date ??
        root.actual_start_date ??
        task.startDate ??
        root.startDate ??
        root.start_date ??
        task.start_date
    ) || null;
  const doneMs = actualEndMsFromTask(task);
  const actualDueMs = actualDueMsFromTask(task);

  const plannedDurationDays = calendarDaysSpanIST(pStart, pDue);
  // Use actual due date for length delay as per user request
  const finalDurationDays = calendarDaysSpanIST(aStart, actualDueMs ?? doneMs);
  
  const startDelayDays = pStart != null && aStart != null ? calendarDaysSpanIST(pStart, aStart) : null;
  const lengthDelayDays =
    plannedDurationDays != null && finalDurationDays != null
      ? finalDurationDays - plannedDurationDays
      : null;
  
  // Completion delay remains based on doneMs (date closed) vs planned due
  const completionDelayDays = pDue != null && doneMs != null ? calendarDaysSpanIST(pDue, doneMs) : null;

  const delays = [];
  const dateKey = (ms) => (ms != null && Number.isFinite(Number(ms)) ? toScheduleDayLabel(ms) : '');
  if (pStart && pDue && aStart && doneMs) {
    const pk = dateKey(pStart);
    const ak = dateKey(aStart);
    const dk = dateKey(pDue);
    const doneKey = dateKey(doneMs);
    if (ak > pk) delays.push('start');
    if (lengthDelayDays != null && lengthDelayDays > 0) delays.push('length');
    if (doneKey > dk && completionDelayDays != null && completionDelayDays > 0) delays.push('completion');
  }

  const ps = snapToNoonIST(pStart);
  const pd = snapToNoonIST(pDue);
  const asSnap = snapToNoonIST(aStart);
  const doneSnap = snapToNoonIST(doneMs);
  const candidates = [ps, pd, asSnap, doneSnap].filter((x) => x != null && Number.isFinite(x));
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

    const milestonesMap = new Map();
    const addM = (rawMs, key) => {
      const snap = snapToNoonIST(rawMs);
      if (snap == null || !Number.isFinite(snap)) return;
      const dayKey = toScheduleDayLabel(rawMs) || String(snap);
      const existing = milestonesMap.get(dayKey);
      if (existing) {
        existing.keys.push(key);
        return;
      }
      milestonesMap.set(dayKey, {
        key,
        keys: [key],
        left: clampPct(pctRaw(snap)),
        date: dayKey,
        ms: rawMs,
      });
    };
    addM(pStart, 'ps');
    addM(pDue, 'pd');
    addM(aStart, 'fs');
    addM(doneMs, 'dn');
    const milestones = Array.from(milestonesMap.values());

    const delayZones = [];
    if (pStart && pDue && aStart && doneMs && ps != null && pd != null && asSnap != null && doneSnap != null) {
      const pk = dateKey(pStart);
      const ak = dateKey(aStart);
      const dueKey = dateKey(pDue);
      const doneKey = dateKey(doneMs);

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
      if (doneKey > dueKey && completionDelayDays != null && completionDelayDays > 0 && doneSnap != null) {
        const g = seg(pd, doneSnap);
        delayZones.push({
          key: 'owner',
          label: 'Completion delay: finished after planned due',
          shortLegend: 'Completion delay',
          left: g.left,
          width: g.width,
          startMs: pd,
          endMs: doneSnap,
          durationCalendarDays: completionDelayDays,
          barClass:
            'bg-blocked/55 border-2 border-blocked/90 shadow-[0_0_14px_rgba(239,68,68,0.3)]',
          swatchClass: 'bg-blocked shadow-sm ring-1 ring-blocked/45',
        });
      }
      if (lengthDelayDays != null && lengthDelayDays > 0 && plannedDurationDays != null) {
        const plannedEndOnFinalTrack = asSnap + plannedDurationDays * ONE_DAY_MS;
        if (doneSnap > plannedEndOnFinalTrack) {
          const g = seg(plannedEndOnFinalTrack, doneSnap);
          delayZones.push({
            key: 'length',
            label: 'Length delay: final duration exceeded planned duration',
            shortLegend: 'Length delay',
            left: g.left,
            width: g.width,
            startMs: plannedEndOnFinalTrack,
            endMs: doneSnap,
            durationCalendarDays: lengthDelayDays,
            barClass:
              'bg-accent/50 border-2 border-accent/90 shadow-[0_0_14px_rgba(255,99,33,0.28)]',
            swatchClass: 'bg-accent shadow-sm ring-1 ring-accent/50',
          });
        }
      }
    }

    timeline = {
      planned: ps != null && pd != null ? seg(ps, pd) : null,
      final: asSnap != null && doneSnap != null ? seg(asSnap, doneSnap) : null,
      delayZones,
      milestones,
    };
  }

  return {
    delays,
    hasFullSet: Boolean(pStart && pDue && aStart && doneMs),
    plannedStartLabel: toScheduleDayLabel(pStart) || 'Missing',
    plannedDueLabel: toScheduleDayLabel(pDue) || 'Missing',
    finalStartLabel: toScheduleDayLabel(aStart) || 'Not set',
    doneLabel: toScheduleDayLabel(doneMs) || 'Not set',
    plannedWindowCalendarDays: plannedDurationDays,
    finalWindowCalendarDays: finalDurationDays,
    startDelayDays,
    lengthDelayDays,
    completionDelayDays,
    anchorMs: { pStart, pDue, aStart, doneMs },
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

function DelayTimelineBars({ analysis }) {
  const {
    timeline,
    plannedWindowCalendarDays,
    finalWindowCalendarDays,
    anchorMs,
    startDelayDays,
    lengthDelayDays,
    completionDelayDays,
  } = analysis;

  if (!timeline || (!timeline.planned && !timeline.final)) {
    return (
      <div className="text-[0.65rem] text-text-muted rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 leading-snug min-w-0 max-w-full">
        Add Planned Start/Due (custom fields), task Start date, and Date done in ClickUp to see a schedule comparison.
      </div>
    );
  }

  const zones = timeline.delayZones || [];
  const milestones = timeline.milestones || [];
  const startZone = zones.find((z) => z.key === 'leader') || null;
  const lengthZone = zones.find((z) => z.key === 'length') || null;
  const completionZone = zones.find((z) => z.key === 'owner') || null;

  const plannedStartMs = anchorMs?.pStart;
  const plannedDueMs = anchorMs?.pDue;
  const finalStartMs = anchorMs?.aStart;

  const milestoneEntries = [...milestones].sort((a, b) => Number(a.left) - Number(b.left));

  const timelineDateLabel = (p) => (p?.ms ? formatTimelineDate(p.ms) : '—');

  /** Lane 1: Actual execution bar (thin gray/green line). */
  const actualBar = timeline.final ? (
    <div className="absolute z-[2] top-[14px] h-[6px] w-full" style={scheduleLaneStyle(timeline.final)}>
      <div className="h-full w-full rounded-full bg-completed/60 border border-completed/40 shadow-[0_0_8px_rgba(63,185,80,0.25)]" />
    </div>
  ) : null;

  /** Lane 2: Delay bar with colored segments. */
  const delayBar = (
    <div className="absolute z-[3] top-[34px] h-[6px] w-full pointer-events-none">
      {startZone && (
        <div
          className="absolute h-full rounded-full bg-warning/45 border border-warning/30 border-dashed animate-pulse"
          style={{ left: `${startZone.left}%`, width: `${startZone.width}%` }}
        />
      )}
      {lengthZone && (
        <div
          className="absolute h-full rounded-full bg-rose-500/50 border border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.2)]"
          style={{ left: `${lengthZone.left}%`, width: `${lengthZone.width}%` }}
        />
      )}
      {completionZone && (
        <div
          className="absolute h-full rounded-full bg-amber-500/50 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.2)]"
          style={{ left: `${completionZone.left}%`, width: `${completionZone.width}%` }}
        />
      )}
    </div>
  );

  return (
    <div className="min-w-0 max-w-full rounded-xl border border-white/[0.08] bg-black/40 px-3 py-4 overflow-visible space-y-4 shadow-inner">

      <div className="relative w-full h-[64px] bg-white/[0.02] rounded-lg border border-white/[0.04]">
        {/* Timeline Axis Background */}
        <div className="absolute inset-x-0 top-[17px] h-px bg-white/5" />
        <div className="absolute inset-x-0 top-[37px] h-px bg-white/5" />

        {/* Lane 1: Planned Background (Ghost Bar) */}
        {timeline.planned && (
          <div className="absolute z-[1] top-[14px] h-[6px] w-full" style={scheduleLaneStyle(timeline.planned)}>
            <div className="h-full w-full rounded-full bg-white/[0.05] border border-white/[0.1] border-dashed" />
          </div>
        )}

        {actualBar}
        {delayBar}

        {/* Milestones / Dates - Using alternating top/bottom and collision detection if possible, or just wider spacing */}
        {milestoneEntries.map((p, i) => {
          // Calculate if we should put the label at top or bottom to avoid collision
          // For 4 points, alternating 0, 1, 0, 1 is usually okay if they aren't extremely close
          const isUpper = i % 2 === 0;
          
          return (
            <div
              key={`${p.key || 'pt'}-${i}`}
              className="absolute group h-full"
              style={{ left: `${p.left}%`, top: '0' }}
            >
              <div className="absolute left-0 top-0 bottom-0 w-px bg-white/[0.12] group-hover:bg-accent/40 shadow-[0_0_4px_rgba(255,255,255,0.1)] transition-colors" />
              <div 
                className="absolute left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-[#1a1a1a]/90 backdrop-blur-md border border-white/10 text-[0.5rem] font-medium text-text-secondary whitespace-nowrap shadow-xl z-10"
                style={{ 
                  top: isUpper ? '-20px' : '44px',
                }}
              >
                {timelineDateLabel(p)}
              </div>
            </div>
          );
        })}
      </div>
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

function formatTaskDescription(value) {
  if (!value) return '';
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain description for AMS “Where we are” tooltips (matches PS-style list). */
function amsTaskDescriptionForSimpleList(task) {
  const raw = task?.raw || task;
  const text = raw?.description || raw?.markdown_description || '';
  return formatTaskDescription(text);
}

function amsOwnerDisplay(task) {
  const raw = task?.raw;
  const list = raw?.assignees;
  if (Array.isArray(list) && list.length > 0) {
    const joined = list
      .map((a) => (typeof a === 'string' ? a : a?.username || a?.name || ''))
      .filter(Boolean)
      .join(', ');
    if (joined) return joined;
  }
  return task.owner || 'Unassigned';
}

function normalizePsTask(task) {
  const root = task.raw || task;
  const ownerFromAssignees = Array.isArray(task.assignees) && task.assignees.length > 0
    ? task.assignees
        .map((a) => (typeof a === 'string' ? a : a?.username || a?.name || ''))
        .filter(Boolean)
        .join(', ')
    : Array.isArray(root.assignees) && root.assignees.length > 0
      ? root.assignees
          .map((a) => (typeof a === 'string' ? a : a?.username || a?.name || ''))
          .filter(Boolean)
          .join(', ')
      : '';
  const lno = parseLnoFromName(task.name);
  const dateDone = root.date_done || root.dateDone || null;
  
  return {
    id: task.name || task.id || `task-${Math.random().toString(36).slice(2)}`,
    name: task.name || 'Untitled task',
    owner:
      typeof task.assignee === 'string'
        ? task.assignee
        : task.assignee?.username || task.owner || ownerFromAssignees || 'Unassigned',
    detail: '',
    comments: Array.isArray(task.comments) ? task.comments : [],
    description: formatTaskDescription(task.description || ''),
    statusLabel: '—',
    blockerSeverity: 'low',
    blockerType: 'workflow',
    blockerReason: task.blockerReason || '',
    delayedLabel: task.delayedLabel || '—',
    delayDetails: task.delayDetails || '—',
    delayDuration: task.delayDuration ?? null,
    projectName: task.projectName || root.listName,
    isPsTask: true,
    lnoTier: lno.tier,
    lnoLabel: lno.label,
    startDate: root.start_date || root.startDate || null,
    dueDate: root.due_date || root.dueDate || null,
    dateDone,
    completionDate: dateDone || root.date_closed || root.dateClosed || null,
    raw: root,
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

function toWrongTaskTimeMs(v) {
  if (v == null) return null;
  const x = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(x)) return null;
  if (x > 1e12) return x;
  if (x > 1e9 && x < 1e12) return x * 1000;
  return null;
}

/** Best-effort “when did this delay matter” timestamp for wrong-view filtering (ms). */
function getWrongTaskReferenceTimeMs(rawTask) {
  const t = rawTask;
  if (!t) return null;
  const r = t.raw || t;
  const candidates = [
    toWrongTaskTimeMs(t.dateDone),
    toWrongTaskTimeMs(t.actualCompletionDate),
    toWrongTaskTimeMs(t.actual_completion_date),
    toWrongTaskTimeMs(t.completionDate),
    toWrongTaskTimeMs(r.dateDone),
    toWrongTaskTimeMs(r.actualCompletionDate),
    toWrongTaskTimeMs(r.dateUpdated),
    toWrongTaskTimeMs(r.dateCreated),
    toWrongTaskTimeMs(r.date_created),
    toWrongTaskTimeMs(t.dateUpdated),
    toWrongTaskTimeMs(t.date_updated),
    toWrongTaskTimeMs(t.dateCreated),
    toWrongTaskTimeMs(t.date_created),
  ];
  let best = candidates.find(Boolean);
  if (!best && Array.isArray(t.comments)) {
    const dates = t.comments.map((c) => toWrongTaskTimeMs(c.date)).filter(Boolean);
    best = dates.length ? Math.max(...dates) : null;
  }
  return best;
}

function taskInWrongDateWindow(rawTask, cutoffMs) {
  const ts = getWrongTaskReferenceTimeMs(rawTask);
  if (ts == null) return false;
  return ts >= cutoffMs;
}

function getWrongDateCutoffMs(filterId) {
  if (filterId === 'all') return null;
  const now = Date.now();
  const DAY = 86400000;
  switch (filterId) {
    case 'last7':
      return now - 7 * DAY;
    case 'month':
      return now - 30 * DAY;
    case 'quarter':
      return now - 90 * DAY;
    case 'year':
      return now - 365 * DAY;
    default:
      return null;
  }
}

/** Client-side filter for “What went wrong” payloads (PS/RTL: per-stage tasks; AMS: top-level tasks). */
function filterWrongViewPayload(data, teamKey, cutoffMs) {
  if (cutoffMs == null || !data) return data;
  const clone = { ...data };
  if (teamKey === 'ams') {
    const tasksRaw = Array.isArray(data.tasks) ? data.tasks : [];
    const filtered = tasksRaw.filter((t) => taskInWrongDateWindow(t, cutoffMs));
    return { ...clone, tasks: filtered, stageSummary: [] };
  }
  if (Array.isArray(data.stages)) {
    const stages = data.stages.map((stage) => {
      const tasks = Array.isArray(stage.tasks)
        ? stage.tasks.filter((t) => taskInWrongDateWindow(t, cutoffMs))
        : [];
      return { ...stage, tasks, taskCount: tasks.length };
    });
    return { ...clone, stages };
  }
  return data;
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
    // Recalculate counts directly from tasks for accuracy as requested
    const lnoLeverage = stageTasks.filter((t) => t.lnoTier === 'L').length;
    const lnoNeutral = stageTasks.filter((t) => t.lnoTier === 'N').length;
    const lnoOverhead = stageTasks.filter((t) => t.lnoTier === 'O').length;
    const lnoUnparsed = stageTasks.filter((t) => !t.lnoTier).length;
    const delayed = stageTasks.filter((t) => 
      t.delayedLabel === 'Yes' || 
      (t.delayDuration !== null && t.delayDuration > 0) ||
      (t.dateDone && t.dueDate && Number(t.dateDone) > Number(t.dueDate))
    ).length;

    const stageCounts = {
      delayed,
      lnoLeverage,
      lnoNeutral,
      lnoOverhead,
      lnoUnparsed,
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

// ─── RTL Flowchart Components ─────────────────────────────────────────────────

function getRtlStage(stages, num) {
  return (
    stages.find((s) => s.stageNumber === num) || {
      stageNumber: num,
      status: 'upcoming',
      taskCount: 0,
      tasks: [],
      title: RTL_STAGE_NAMES[num - 1] || `Stage ${num}`,
    }
  );
}

function rtlStageHeatStatus(stage) {
  const n = Number(stage?.taskCount ?? stage?.tasks?.length ?? 0);
  return n > 0 ? 'active' : 'upcoming';
}

/** A standard RTL stage box node */
function RtlNode({ num, stages, onMouseEnter, onMouseLeave }) {
  const stage = getRtlStage(stages, num);
  const heat = rtlStageHeatStatus(stage);
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

/** Horizontal right-pointing arrow connector between columns */
function RtlHArrow({ label }) {
  return (
    <div className="flex items-center justify-center w-10 shrink-0 h-[52px]">
      <div className="relative w-full h-0.5 bg-white/30">
        <div className="absolute right-[1px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 border-r-[1.5px] border-t-[1.5px] border-white/30 transform rotate-45" />
        {label && (
          <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[0.48rem] font-bold text-completed whitespace-nowrap">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Full RTL 3-column flowchart:
 *
 * Col-L (down):  1 → 2 → 3 → 4
 *                             ↓ (horizontal to col-M bottom)
 * Col-M (up):    9 ← 8 ← 7 ← 6 ← 5 (← from col-L at stage 4)
 *                    ↘ (horizontal to col-R from stage 8)
 * Col-R (down):  10 → 11
 *
 * Loop back: stage 6 → stage 3 (rendered via SVG)
 */
function RtlFlowchart({ stages, onMouseEnter, onMouseLeave }) {
  return (
    <div className="relative w-full max-w-[960px] py-2 overflow-auto">
      <div className="flex items-start justify-center gap-0">

        {/* ── Column Left: stages 1→2→3→4 (downward) ── */}
        {/* 68px spacer at top so Stage 4 bottom aligns with Stage 5 in middle col */}
        <div className="flex flex-col items-center w-[11.5rem] sm:w-48 shrink-0">
          <div aria-hidden="true" className="w-full shrink-0" style={{ height: '68px' }} />
          <RtlNode num={1} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
          <PsDownArrow />
          <RtlNode num={2} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
          <PsDownArrow />
          <RtlNode num={3} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
          <PsDownArrow />
          <RtlNode num={4} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
        </div>

        {/* ── Horizontal arrow: col-L → col-M at Stage 4 / Stage 5 level ── */}
        {/* paddingTop = 68px spacer + 3 stage-slots (3×68) = 68+204 = 272px; center at +26px = 298px. Adding 24px to move it lower = 296px padding */}
        <div className="flex flex-col items-end shrink-0 w-12" style={{ paddingTop: '296px' }}>
          <RtlHArrow />
        </div>

        {/* ── Column Middle: stages 9←8←7←6←5 (data flows upward) ── */}
        {/* Stage 9 at top, Stage 5 at bottom — Stage 5 at center 298px from top */}
        <div className="flex flex-col items-center w-[11.5rem] sm:w-48 shrink-0">
          <RtlNode num={9} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
          <PsUpArrow />
          <RtlNode num={8} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
          <PsUpArrow />
          <RtlNode num={7} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
          <PsUpArrow />
          <RtlNode num={6} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
          <PsUpArrow />
          <RtlNode num={5} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
        </div>

        {/* ── Horizontal arrow: col-M → col-R at Stage 8 / Stage 10 level ── */}
        <div className="flex flex-col items-center shrink-0 w-12" style={{ paddingTop: '94px' }}>
          <RtlHArrow />
        </div>

        {/* ── Column Right: stages 10→11 (downward) ── */}
        <div className="flex flex-col items-center w-[11.5rem] sm:w-48 shrink-0">
          <div aria-hidden="true" className="w-full shrink-0" style={{ height: '68px' }} />
          <RtlNode num={10} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
          <PsDownArrow />
          <RtlNode num={11} stages={stages} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} />
        </div>

      </div>
    </div>
  );
}

export default function Pipeline({
  data,
  teamLabel = 'AMS Team',
  teamKey = 'ams',
  viewTab,
  wrongDateFilter = 'all',
  psProject = 'qs222',
  rtlProject = 'qs222',
  amsProject = 'qs222',
}) {
  const [tooltip, setTooltip] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });
  const [subTooltip, setSubTooltip] = useState(null);

  /** 'Current' view (Where we are) = simplified flat list across all teams. */
  const isCurrentView = viewTab === 'current';
  
  /** 
   * Enable nested detailed hover for 'What went wrong' views.
   */
  const showDelayNestedDetail = !isCurrentView;

  /** Fixed viewport position for nested panel (set after parent is laid out). */
  const [subTooltipFixedPos, setSubTooltipFixedPos] = useState(null);
  const [subTooltipHeight, setSubTooltipHeight] = useState(NESTED_SUBTOOLTIP_HEIGHT_PX);
  const [tooltipLnoFilter, setTooltipLnoFilter] = useState('all');
  const [leaderBoardModalOpen, setLeaderBoardModalOpen] = useState(false);
  const timeoutRef = useRef(null);
  const tooltipRef = useRef(null);
  const nestedRef = useRef(null);

  useEffect(() => {
    if (isCurrentView) setSubTooltip(null);
  }, [isCurrentView]);

  useEffect(() => {
    if (viewTab === 'current' && (teamKey === 'ps' || teamKey === 'rtl')) setSubTooltip(null);
  }, [viewTab, teamKey]);

  useEffect(() => {
    if (viewTab !== 'wrong') setLeaderBoardModalOpen(false);
  }, [viewTab]);

  /** PS/RTL: folder extracts (`*_folder_tasks_*.json`) match AMS — full per-member task counts + Delayed field. Wrong-only JSON is too narrow for team accuracy. */
  const leaderBoardStatsUrl = useMemo(() => {
    if (viewTab !== 'wrong') return null;
    if (teamKey === 'ams') {
      return `/api/ams-member-stats?project=${encodeURIComponent(amsProject)}`;
    }
    if (teamKey === 'ps') {
      return `/api/ps-member-stats?project=${encodeURIComponent(psProject)}`;
    }
    if (teamKey === 'rtl') {
      return `/api/rtl-member-stats?project=${encodeURIComponent(rtlProject)}`;
    }
    return null;
  }, [viewTab, teamKey, psProject, rtlProject, amsProject]);

  const showLeaderBoardButton = leaderBoardStatsUrl != null;

  const subTooltipSchedule = useMemo(() => {
    if (!subTooltip || isCurrentView) return null;
    if (!showDelayNestedDetail) return null;
    return computeDelayScheduleAnalysis(subTooltip);
  }, [subTooltip, isCurrentView, showDelayNestedDetail]);

  const subTooltipCommentsSorted = useMemo(() => {
    if (!subTooltip?.comments?.length) return [];
    return [...subTooltip.comments].sort((a, b) => Number(a.date || 0) - Number(b.date || 0));
  }, [subTooltip]);

  const viewData = useMemo(() => {
    if (viewTab !== 'wrong' || wrongDateFilter === 'all' || !data) return data;
    const cutoff = getWrongDateCutoffMs(wrongDateFilter);
    if (cutoff == null) return data;
    return filterWrongViewPayload(data, teamKey, cutoff);
  }, [data, viewTab, wrongDateFilter, teamKey]);

  const stages = useMemo(() => {
    if (teamKey === 'ams') return mapAmsStages(viewData);
    if (teamKey === 'ps') {
      return viewData.stages.map((stage) => {
        const stageTasks = Array.isArray(stage.tasks) ? stage.tasks.map((t) => normalizePsTask(t)) : [];
        return {
          ...stage,
          title: stage.stageName || stage.title || `Stage ${stage.stageNumber}`,
          taskCount: Number(stage.taskCount || stageTasks.length || 0),
          tasks: stageTasks,
          stageCounts: (() => {
            const delayed = stageTasks.filter((t) => 
              t.delayedLabel === 'Yes' || 
              (t.delayDuration !== null && t.delayDuration > 0) ||
              (t.dateDone && t.dueDate && Number(t.dateDone) > Number(t.dueDate))
            ).length;
            
            return {
              delayed,
              lnoLeverage: stageTasks.filter((t) => t.lnoTier === 'L').length,
              lnoNeutral: stageTasks.filter((t) => t.lnoTier === 'N').length,
              lnoOverhead: stageTasks.filter((t) => t.lnoTier === 'O').length,
              lnoUnparsed: stageTasks.filter((t) => !t.lnoTier).length,
            };
          })(),
          topBlockerType: 'none',
        };
      });
    }
    if (teamKey === 'rtl') {
      return viewData.stages.map((stage, idx) => {
        const stageTasks = Array.isArray(stage.tasks) ? stage.tasks.map((t) => normalizePsTask(t)) : [];
        return {
          ...stage,
          title: RTL_STAGE_NAMES[idx] || stage.stageName || stage.title || `Stage ${stage.stageNumber}`,
          taskCount: Number(stage.taskCount || stageTasks.length || 0),
          tasks: stageTasks,
          stageCounts: (() => {
            const delayed = stageTasks.filter((t) => 
              t.delayedLabel === 'Yes' || 
              (t.delayDuration !== null && t.delayDuration > 0) ||
              (t.dateDone && t.dueDate && Number(t.dateDone) > Number(t.dueDate))
            ).length;
            
            return {
              delayed,
              lnoLeverage: stageTasks.filter((t) => t.lnoTier === 'L').length,
              lnoNeutral: stageTasks.filter((t) => t.lnoTier === 'N').length,
              lnoOverhead: stageTasks.filter((t) => t.lnoTier === 'O').length,
              lnoUnparsed: stageTasks.filter((t) => !t.lnoTier).length,
            };
          })(),
          topBlockerType: 'none',
        };
      });
    }
    if (!Array.isArray(viewData?.stages)) return [];
    return viewData.stages.map((stage) => ({
      ...stage,
      title: stage.title || stage.stageName || `Stage ${stage.stageNumber}`,
      taskCount: Number(stage.taskCount || stage.tasks?.length || 0),
      tasks: Array.isArray(stage.tasks) ? stage.tasks.map((task) => normalizeTask(task)) : [],
      stageCounts: (() => {
        const stageTasks = Array.isArray(stage.tasks) ? stage.tasks.map((task) => normalizeTask(task)) : [];
        const delayed = stageTasks.filter((t) => 
          t.delayedLabel === 'Yes' || 
          (t.delayDuration !== null && t.delayDuration > 0) ||
          (t.dateDone && t.dueDate && Number(t.dateDone) > Number(t.dueDate))
        ).length;
        
        return {
          delayed,
          lnoLeverage: stageTasks.filter((t) => t.lnoTier === 'L').length,
          lnoNeutral: stageTasks.filter((t) => t.lnoTier === 'N').length,
          lnoOverhead: stageTasks.filter((t) => t.lnoTier === 'O').length,
          lnoUnparsed: stageTasks.filter((t) => !t.lnoTier).length,
        };
      })(),
      topBlockerType: 'none',
    }));
  }, [viewData, teamKey]);

  const handleMouseEnter = (event, stage) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setTooltipPos(getSimpleStageTooltipPosition(event));
    setTooltip(stage);
    setSubTooltip(null);
    setSubTooltipFixedPos(null);
    if (teamKey === 'ams' && !isCurrentView) setTooltipLnoFilter('all');
  };

  const closeTooltips = (event) => {
    const nextTarget = event?.relatedTarget;
    const isDomNode =
      nextTarget &&
      (nextTarget instanceof Node ||
        (typeof nextTarget === 'object' && 'nodeType' in nextTarget));

    if (
      isDomNode &&
      (tooltipRef.current?.contains(nextTarget) || nestedRef.current?.contains(nextTarget))
    ) {
      return;
    }
    timeoutRef.current = setTimeout(() => {
      setTooltip(null);
      setSubTooltip(null);
      setSubTooltipFixedPos(null);
    }, 320);
  };

  const keepTooltips = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const openSubTooltip = (event, task) => {
    if (viewTab === 'current') return;
    // Removed the restriction that blocked PS/RTL from showing nested tooltips in 'current' view

    const viewportPad = 10;
    const maxByViewport = Math.max(220, window.innerHeight - viewportPad * 2);
    const cap92vh = Math.floor(window.innerHeight * 0.92);
    const nestedHeight = Math.min(NESTED_SUBTOOLTIP_HEIGHT_PX, cap92vh, maxByViewport);
    const nestedWidth = Math.min(NESTED_SUBTOOLTIP_MAX_WIDTH_PX, window.innerWidth - 24);
    const screenPad = VIEWPORT_PAD_PX;
    const gap = 2;

    setSubTooltipHeight(nestedHeight);
    setSubTooltip(task);
    setSubTooltipFixedPos(null);

    queueMicrotask(() => {
      const pr = tooltipRef.current?.getBoundingClientRect();
      if (!pr) return;

      const mainRight = pr.right;
      const freeRight = window.innerWidth - (mainRight + gap) - screenPad;
      const freeLeft = pr.left - gap - screenPad;
      const canFitRight = freeRight >= nestedWidth;
      const canFitLeft = freeLeft >= nestedWidth;
      let placeLeft = false;
      if (canFitRight) placeLeft = false;
      else if (canFitLeft) placeLeft = true;
      else placeLeft = freeLeft > freeRight;

      let left = placeLeft ? pr.left - nestedWidth - gap : pr.right + gap;
      left = Math.max(screenPad, Math.min(left, window.innerWidth - nestedWidth - screenPad));

      let top = pr.top;
      top = Math.max(screenPad, Math.min(top, window.innerHeight - nestedHeight - screenPad));

      setSubTooltipFixedPos({ left, top });
    });
  };

  return (
    <section className="h-full min-h-0 w-full flex flex-col p-3 sm:p-4 box-border overflow-hidden">
      <div className="w-full max-w-[980px] mx-auto flex flex-1 min-h-0 flex-col bg-card border border-border rounded-2xl relative overflow-hidden">
        <h2 className="text-center text-[0.65rem] font-bold uppercase tracking-[0.15em] text-text-secondary pt-4 pb-2 shrink-0">
          {teamKey === 'ams'
            ? `${teamLabel} · AMS Workflow${isCurrentView ? ' · In progress' : ''}`
            : teamKey === 'ps'
              ? `${teamLabel} · Test Flow`
              : teamKey === 'rtl'
                ? `${teamLabel} · RTL Pipeline`
                : `${teamLabel} · Flowchart`}
        </h2>
        {showLeaderBoardButton && (
          <button
            type="button"
            onClick={() => setLeaderBoardModalOpen(true)}
            className="absolute bottom-4 right-4 z-20 text-[0.62rem] font-medium uppercase tracking-wider px-3 py-1 rounded-full border border-accent/45 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/65 transition-colors"
          >
            Leader Board View
          </button>
        )}

        <div
          className={`flex-1 flex min-h-0 px-2 sm:px-6 pb-4 ${
            teamKey === 'ps' || isCurrentView
              ? 'overflow-hidden items-center justify-center'
              : 'overflow-auto items-center justify-center pb-6'
          }`}
        >
          {teamKey === 'ps' ? (
            <div className="h-full w-full min-h-0 max-h-full flex items-center justify-center overflow-hidden">
              {/* zoom reflows layout (unlike transform:scale), so the diagram fits without an inner scroll */}
              <div className="max-h-full max-w-full min-h-0 flex items-center justify-center [zoom:0.65] sm:[zoom:0.72] md:[zoom:0.78] lg:[zoom:0.84] xl:[zoom:0.88] 2xl:[zoom:0.92]">
                <div className="relative w-full max-w-[900px] py-1 shrink-0">
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
              </div>
            </div>
          ) : teamKey === 'rtl' ? (
            /* ── RTL Flowchart: 3-column layout matching the diagram ── */
            <RtlFlowchart stages={stages} onMouseEnter={handleMouseEnter} onMouseLeave={closeTooltips} />
          ) : (
            <div className="relative w-[360px] flex flex-col items-center gap-2">
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

      {tooltip &&
        createPortal(
          <>
          <div
            className="fixed z-[9999] box-border flex max-h-[min(560px,88vh)] w-[420px] max-w-[min(420px,calc(100vw-24px))] flex-col overflow-hidden bg-[#111] border border-white/[0.08] rounded-xl p-4 shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
            style={{
              left: tooltipPos.left,
              top: tooltipPos.top,
            }}
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
          {((teamKey === 'ams' && !isCurrentView) || teamKey === 'ps' || teamKey === 'rtl') && (
            <div className="flex flex-wrap gap-1.5 mb-2 text-[0.62rem] shrink-0 min-w-0">
              <div className="rounded px-2 py-1 border border-white/10 text-white font-bold shrink-0">
                Total: {tooltip.tasks.length}
              </div>
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
          {teamKey !== 'ps' && teamKey !== 'ams' && teamKey !== 'rtl' && (
            <div className="grid grid-cols-3 gap-1 mb-2 text-[0.65rem] shrink-0 min-w-0">
              <div className="rounded px-1.5 py-1 border border-white/10 text-text-muted min-w-0">Tasks: {tooltip.taskCount || 0}</div>
              <div className="rounded px-1.5 py-1 border border-white/10 text-text-muted truncate col-span-2 min-w-0">
                Top: {tooltip.topBlockerType || 'none'}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 mb-2 shrink-0 min-w-0">
             <div className="text-[0.7rem] text-text-muted">{tooltip.taskCount} task(s)</div>
          </div>
          {((teamKey === 'ams' && !isCurrentView) || teamKey === 'ps' || teamKey === 'rtl') && (
            <div className="flex gap-1 mb-2 shrink-0 min-w-0 w-full">
              {[
                { key: 'all', label: 'All' },
                { key: 'L', label: 'Leverage' },
                { key: 'N', label: 'Neutral' },
                { key: 'O', label: 'Overhead' },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setTooltipLnoFilter(f.key)}
                  onMouseEnter={keepTooltips}
                  className={`flex-1 text-[0.6rem] px-1 py-1 rounded border transition-colors shrink-0 font-bold uppercase tracking-tighter ${
                    tooltipLnoFilter === f.key
                      ? 'border-accent bg-accent/20 text-accent'
                      : 'border-white/10 text-text-muted hover:border-white/20'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto pr-1 -mr-1 custom-scrollbar">
            {isCurrentView ? (
              <>
                {tooltip.tasks.length === 0 && <div className="text-text-muted text-sm px-2">No tasks in this stage.</div>}
                {tooltip.tasks.map((task) => {
                  const owner = teamKey === 'ams' ? amsOwnerDisplay(task) : task.owner;
                  return (
                    <div
                      key={task.id}
                      className="relative py-2.5 border-b border-white/[0.05] last:border-b-0 cursor-default min-w-0 px-2"
                    >
                      <div className="min-w-0 max-w-full">
                        <div className="text-sm font-medium text-foreground/95 truncate">{task.name}</div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 min-w-0">
                          <div className="text-xs text-accent-soft/80 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                            <span className="min-w-0 max-w-full truncate">{owner}</span>
                            <span
                              className={`min-w-0 max-w-full break-words ${
                                task.delayedLabel === 'Yes' ||
                                (task.delayDuration !== null && task.delayDuration > 0) ||
                                (task.dateDone && task.dueDate && Number(task.dateDone) > Number(task.dueDate))
                                  ? 'text-blocked'
                                  : 'text-completed'
                              }`}
                            >
                              Delay:{' '}
                              {task.delayedLabel === 'Yes' ||
                              (task.delayDuration !== null && task.delayDuration > 0) ||
                              (task.dateDone && task.dueDate && Number(task.dateDone) > Number(task.dueDate))
                                ? 'Yes'
                                : 'No'}
                            </span>
                          </div>
                          {(() => {
                            const analysis = computeDelayScheduleAnalysis(task);
                            if (analysis.plannedWindowCalendarDays == null) return null;
                            return (
                              <div className="text-[0.5rem] font-bold text-text-muted shrink-0 bg-white/[0.04] px-1.2 py-0.5 rounded border border-white/[0.05]">
                                P {analysis.plannedWindowCalendarDays}d · E {analysis.finalWindowCalendarDays}d
                                {analysis.completionDelayDays > 0 && (
                                  <span className="text-amber-500"> + C {analysis.completionDelayDays}d</span>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              (() => {
                const sections = buildAmsTooltipSections(tooltip.tasks, tooltipLnoFilter);
                if (sections.length === 0) {
                  return <div className="text-text-muted text-sm px-2">No tasks match this filter.</div>;
                }
                return sections.map((section) => (
                  <div key={section.key} className="mb-3 last:mb-0 min-w-0">
                    {section.key !== 'other' && (
                        <div
                        className={`text-[0.6rem] font-semibold uppercase tracking-wide mb-1.5 pl-2 border-l-2 min-w-0 break-words pr-1 ${section.barClass}`}
                        >
                        {section.title} · {section.tasks.length}
                        </div>
                    )}
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
                          <div className="mt-0.5 flex items-center justify-between gap-2 min-w-0">
                            <div className="text-xs text-accent-soft/80 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                                <span className="min-w-0 max-w-full truncate">{task.owner}</span>
                                <span
                                className={`min-w-0 max-w-full break-words ${
                                    (task.delayedLabel === 'Yes' || 
                                    (task.delayDuration !== null && task.delayDuration > 0) ||
                                    (task.dateDone && task.dueDate && Number(task.dateDone) > Number(task.dueDate))) 
                                    ? 'text-blocked' 
                                    : 'text-completed'
                                }`}
                                >
                                Delay: {(task.delayedLabel === 'Yes' || 
                                        (task.delayDuration !== null && task.delayDuration > 0) ||
                                        (task.dateDone && task.dueDate && Number(task.dateDone) > Number(task.dueDate))) ? 'Yes' : 'No'}
                                </span>
                            </div>
                            {(() => {
                              const analysis = computeDelayScheduleAnalysis(task);
                              if (analysis.plannedWindowCalendarDays == null) return null;
                              return (
                                <div className="text-[0.5rem] font-bold text-text-muted shrink-0 bg-white/[0.04] px-1.2 py-0.5 rounded border border-white/[0.05]">
                                  P {analysis.plannedWindowCalendarDays}d · E {analysis.finalWindowCalendarDays}d
                                  {analysis.completionDelayDays > 0 && <span className="text-amber-500"> + C {analysis.completionDelayDays}d</span>}
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ));
              })()
            )}
          </div>
        </div>

          {subTooltip && showDelayNestedDetail && subTooltipFixedPos && (
            <div
              ref={nestedRef}
              className="fixed z-[10000] flex min-h-0 min-w-0 max-h-[min(560px,88vh)] flex-col overflow-hidden rounded-xl border border-white/[0.14] bg-[#0d0d0d] p-3.5 shadow-[0_16px_42px_rgba(0,0,0,0.55)]"
              style={{
                left: subTooltipFixedPos.left,
                top: subTooltipFixedPos.top,
                height: subTooltipHeight,
                width: `min(${NESTED_SUBTOOLTIP_MAX_WIDTH_PX}px, calc(100vw - 24px))`,
                maxWidth: `min(${NESTED_SUBTOOLTIP_MAX_WIDTH_PX}px, calc(100vw - 24px))`,
              }}
              onMouseEnter={keepTooltips}
              onMouseLeave={closeTooltips}
            >
              <div
                className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border border-white/[0.12] bg-[#0d0d0d]"
                style={{
                  ...(subTooltipFixedPos.left >= tooltipPos.left + STAGE_TOOLTIP_WIDTH_PX - 8
                    ? { left: -5 }
                    : { right: -5 }),
                }}
              />

              {teamKey !== 'ams' && (
                <div className="shrink-0 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1.5 min-w-0">
                    <div className="text-sm font-semibold leading-snug min-w-0 break-words pr-1 text-accent">{subTooltip.name}</div>
                  </div>

                  {subTooltip.projectName ? (
                    <div className="text-[0.65rem] text-text-muted mb-2 truncate" title={subTooltip.projectName}>
                      <span className="text-text-secondary/90">Project:</span> {subTooltip.projectName}
                    </div>
                  ) : null}

                  {(teamKey === 'ps' || teamKey === 'rtl') && (
                    <div className="text-[0.65rem] text-text-muted mb-2 truncate">
                      <span className="text-text-secondary/90">Owner:</span> {subTooltip.owner || 'Unassigned'}
                    </div>
                  )}
                </div>
              )}

              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <AmsTaskNestedDetail
                  task={subTooltip}
                  schedule={subTooltipSchedule}
                  commentsSorted={subTooltipCommentsSorted}
                  formatDate={formatDate}
                  formatCalendarDayCount={formatCalendarDayCount}
                  DelayTimelineBars={DelayTimelineBars}
                  delayTypeChipClass={delayTypeChipClass}
                  DELAY_TYPE_LABEL={DELAY_TYPE_LABEL}
                />
              </div>
            </div>
          )}
          </>,
        document.body
        )}

      <AmsDeliveryInsightModal
        open={leaderBoardModalOpen}
        onClose={() => setLeaderBoardModalOpen(false)}
        statsUrl={leaderBoardStatsUrl ?? '/api/ams-member-stats'}
      />
    </section>
  );
}
