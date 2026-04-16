'use client';

import { Fragment } from 'react';

export default function AmsTaskNestedDetail({
  task,
  schedule,
  commentsSorted,
  formatDate,
  formatCalendarDayCount,
  DelayTimelineBars,
  delayTypeChipClass,
  DELAY_TYPE_LABEL,
}) {
  if (!task) return null;

  const toMs = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const formatScheduleDate = (value) => {
    const ms = toMs(value);
    if (ms == null) return '—';
    return new Date(ms).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: '2-digit',
    });
  };

  const plannedStartMs = toMs(schedule?.anchorMs?.pStart);
  const plannedDueMs = toMs(schedule?.anchorMs?.pDue);
  const finalStartMs = toMs(
    task.actualStartDate ?? task.startDate ?? task.start_date ?? task?.raw?.startDate ?? task?.raw?.start_date
  );
  const finalDueMs = toMs(
    task.dueDate ?? task.due_date ?? task?.raw?.dueDate ?? task?.raw?.due_date
  );
  const dateDoneMs = toMs(
    task.dateDone ??
      task.actualCompletionDate ??
      task.date_done ??
      task.date_closed ??
      task?.raw?.dateDone ??
      task?.raw?.actualCompletionDate ??
      task?.raw?.date_done ??
      task?.raw?.date_closed
  );

  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const plannedDurationDays = schedule?.plannedWindowCalendarDays;
  const actualDurationDays = 
    finalStartMs != null && finalDueMs != null
      ? Math.max(0, Math.round((finalDueMs - finalStartMs) / ONE_DAY_MS))
      : null;

  const completionDelayDays = schedule?.completionDelayDays;

  const GridRow = ({ icon, label, children, colSpan = false }) => (
    <div className={`flex flex-col gap-1.5 py-3 border-b border-white/[0.04] ${colSpan ? 'sm:col-span-2' : ''}`}>
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-6 h-6 rounded bg-white/[0.05] text-[0.6rem] font-bold text-text-muted border border-white/[0.08]">
          {icon}
        </div>
        <div className="text-[0.65rem] font-bold uppercase tracking-[0.12em] text-text-muted/60">{label}</div>
      </div>
      <div className="pl-8 text-[0.75rem] font-medium text-foreground/90">
        {children}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d] text-foreground overflow-hidden">
      {/* Header Info */}
      <div className="px-5 pt-5 pb-3 bg-gradient-to-b from-white/[0.02] to-transparent">
        <div className="flex items-center gap-2 text-[0.65rem] text-text-muted mb-2 font-medium">
          <span className="w-2 h-2 rounded-full bg-completed" />
          <span>Task</span>
          {task.parent && <span className="opacity-60">· Subtask of {task.parent}</span>}
        </div>
        <h2 className="text-lg font-bold tracking-tight text-white leading-tight mb-4">
          {task.name || 'Untitled task'}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-6 custom-scrollbar space-y-6">
        {/* Fields Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 border-t border-white/[0.08]">
          {/* Status */}
          <GridRow icon="○" label="Status">
            <span className="inline-flex px-2 py-0.5 rounded bg-completed text-white text-[0.65rem] font-black tracking-wider shadow-[0_0_12px_rgba(63,185,80,0.3)]">
              {String(task.statusLabel || 'Active').toUpperCase()}
            </span>
          </GridRow>

          {/* Assignees */}
          <GridRow icon="A" label="Assignees">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-[0.6rem] font-bold text-accent">
                {task.owner ? task.owner.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'U'}
              </div>
              <span className="text-text-secondary">{task.owner}</span>
            </div>
          </GridRow>

          {/* Final Dates */}
          <GridRow icon="D" label="Final Dates">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-white font-mono">
                <span>{formatScheduleDate(finalStartMs)}</span>
                <span className="text-text-muted opacity-40">—</span>
                <span>{formatScheduleDate(finalDueMs)}</span>
              </div>
              <div className="text-[0.65rem] font-bold">
                <span className="text-text-muted">({plannedDurationDays}d</span>
                {completionDelayDays > 0 && (
                  <span className="text-rose-500 ml-1">+{completionDelayDays}d (completion delay)</span>
                )}
                <span className="text-text-muted">)</span>
              </div>
            </div>
          </GridRow>

          {/* Planned Dates */}
          <GridRow icon="P" label="Planned Dates">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-accent/90 font-mono">
                <span>{formatScheduleDate(plannedStartMs)}</span>
                <span className="text-text-muted opacity-40">—</span>
                <span>{formatScheduleDate(plannedDueMs)}</span>
              </div>
              <div className="text-[0.65rem] font-bold text-text-muted">
                ({plannedDurationDays}d)
              </div>
            </div>
          </GridRow>

          {/* Date Done */}
          <GridRow icon="C" label="Date Done">
            <span className="text-completed font-bold font-mono text-[0.8rem]">
              {formatScheduleDate(dateDoneMs)}
            </span>
          </GridRow>

          {/* Delay Duration */}
          <GridRow icon="T" label="Delay Duration">
            <div className="flex items-baseline gap-2">
              <span className={`font-black text-[0.85rem] ${completionDelayDays > 0 ? 'text-rose-500' : 'text-text-muted'}`}>
                {completionDelayDays > 0 ? `+${completionDelayDays} days` : '0 days'}
              </span>
              <span className="text-[0.6rem] text-text-muted">(date done - final due date)</span>
            </div>
          </GridRow>

          {/* Delay Analysis */}
          <GridRow icon="DA" label="Delay Analysis" colSpan>
            <div className="flex flex-col gap-4 w-full">
              <div className="flex-1 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-2">
                <div className="flex justify-between items-center text-[0.65rem]">
                  <span className="flex items-center gap-2 text-text-muted"><span className="w-2 h-2 rounded-full bg-zinc-500/50" /> Starting Delay</span>
                  <span className="font-bold">{schedule?.startDelayDays || 0} days</span>
                </div>
                <div className="flex justify-between items-center text-[0.65rem]">
                  <span className="flex items-center gap-2 text-text-muted"><span className="w-2 h-2 rounded-full bg-rose-500" /> Project Length Delay</span>
                  <span className="font-bold">{schedule?.lengthDelayDays || 0} days</span>
                </div>
                <div className="flex justify-between items-center text-[0.65rem]">
                  <span className="flex items-center gap-2 text-text-muted"><span className="w-2 h-2 rounded-full bg-amber-500" /> Completion Delay</span>
                  <span className="font-bold text-amber-500">{completionDelayDays || 0} days</span>
                </div>
              </div>
            </div>
          </GridRow>
          
          <div className="sm:col-span-2 mt-4 mb-2">
             <DelayTimelineBars analysis={schedule} />
          </div>



        </div>


        {/* Comments Section */}
        <div className="pt-6 border-t border-white/[0.08]">
          <div className="text-[0.6rem] font-bold uppercase tracking-[0.15em] text-text-muted/60 mb-3">Comments ({task.comments?.length || 0})</div>
          <div className="space-y-3">
             {commentsSorted.length > 0 ? (
               commentsSorted.map((c, i) => (
                 <div key={i} className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[0.65rem] font-bold text-accent">{c.author || 'User'}</span>
                      <span className="text-[0.55rem] text-text-muted uppercase">{formatDate(c.date)}</span>
                    </div>
                    <div className="text-[0.7rem] text-foreground/90 leading-relaxed">{c.text || c.comment}</div>
                 </div>
               ))
             ) : (
               <div className="text-[0.65rem] text-text-muted italic px-2">No comments available.</div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
}
