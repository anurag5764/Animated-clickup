'use client';

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
    if (ms == null) return 'Not set';
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
  const completionDelayDays = schedule?.completionDelayDays;
  const formatDurationDays = (days) => {
    if (typeof days !== 'number' || !Number.isFinite(days)) return 'Not set';
    if (days === 0) return '0 days';
    if (days === 1) return '1 day';
    return `${days} days`;
  };
  const plannedDurationLabel = formatDurationDays(schedule?.plannedWindowCalendarDays);
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const finalBaseDurationDays =
    finalStartMs != null && finalDueMs != null
      ? Math.max(0, Math.round((finalDueMs - finalStartMs) / ONE_DAY_MS))
      : null;
  const finalBaseDurationLabel = formatDurationDays(finalBaseDurationDays);
  const completionDelayCompactLabel =
    typeof completionDelayDays === 'number'
      ? `${completionDelayDays >= 0 ? '+' : ''}${completionDelayDays}d (completion delay)`
      : null;
  const delayDurationLabel =
    typeof completionDelayDays === 'number'
      ? `${completionDelayDays >= 0 ? '+' : ''}${completionDelayDays} days`
      : 'Not set';

  return (
    <div className="flex flex-1 min-h-0 min-w-0 h-full flex-col sm:flex-row gap-2 sm:gap-0 mt-1 pt-2 border-t border-white/[0.08]">
      <div className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar sm:pr-2">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3 gap-y-2 text-xs mb-2 min-w-0 max-w-full">
          <div className="min-w-0 sm:col-span-3">
            <div className="text-[0.6rem] uppercase tracking-wide text-text-muted">Task name</div>
            <div className="text-foreground/95 truncate mt-0.5">{task.name || 'Untitled task'}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[0.6rem] uppercase tracking-wide text-text-muted">Assignee</div>
            <div className="text-foreground/95 truncate mt-0.5">{task.owner}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[0.6rem] uppercase tracking-wide text-text-muted">Planned duration</div>
            <div className="text-foreground/95 mt-0.5">
              {plannedDurationLabel}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-text-secondary mb-1">Timeline</div>
          {schedule ? (
            <div className="min-w-0 max-w-full mb-2">
              <DelayTimelineBars analysis={schedule} />
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[0.68rem] mb-2">
            <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-2 shadow-[0_0_0_1px_rgba(251,113,133,0.08)_inset]">
              <div className="text-[0.58rem] uppercase tracking-wide text-rose-200 mb-1 font-semibold">Final Dates</div>
              <div className="text-rose-100/90">Start</div>
              <div className="text-foreground font-medium">{formatScheduleDate(finalStartMs)}</div>
              <div className="text-rose-200/70 mt-0.5">to</div>
              <div className="text-rose-100/90">Due</div>
              <div className="text-foreground font-medium">{formatScheduleDate(finalDueMs)}</div>
              <div className="text-rose-200 mt-1 font-medium">
                ({finalBaseDurationLabel}
                {completionDelayCompactLabel ? ` ${completionDelayCompactLabel}` : ''})
              </div>
            </div>

            <div className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-2 shadow-[0_0_0_1px_rgba(34,211,238,0.08)_inset]">
              <div className="text-[0.58rem] uppercase tracking-wide text-cyan-200 mb-1 font-semibold">Planned Dates</div>
              <div className="text-cyan-100/90">Plan Start</div>
              <div className="text-foreground font-medium">{formatScheduleDate(plannedStartMs)}</div>
              <div className="text-cyan-200/70 mt-0.5">to</div>
              <div className="text-cyan-100/90">Plan Due</div>
              <div className="text-foreground font-medium">{formatScheduleDate(plannedDueMs)}</div>
              <div className="text-cyan-200 mt-1 font-medium">({plannedDurationLabel})</div>
            </div>
          </div>

          <div className="rounded-md border border-amber-400/35 bg-amber-500/10 px-2 py-2 text-[0.68rem] mb-2 shadow-[0_0_0_1px_rgba(251,191,36,0.08)_inset]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <div className="text-[0.58rem] uppercase tracking-wide text-amber-200 font-semibold">Date Done</div>
                <div className="text-foreground font-medium mt-0.5">{formatScheduleDate(dateDoneMs)}</div>
              </div>
              <div>
                <div className="text-[0.58rem] uppercase tracking-wide text-amber-200 font-semibold">Delay Duration</div>
                <div className="text-amber-100 font-semibold mt-0.5">{delayDurationLabel}</div>
                <div className="text-amber-200/80 text-[0.58rem] mt-0.5">(date done - final due date)</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-2">
            {!schedule || schedule.delays.length === 0 ? (
              <span className="text-[0.62rem] px-2 py-1 rounded-md border border-white/12 text-text-muted leading-snug">
                {schedule?.hasFullSet
                  ? 'No start, length, or completion delay'
                  : 'Need planned start/due, final start, and date done'}
              </span>
            ) : (
              schedule.delays.map((kind) => (
                <span
                  key={kind}
                  className={`text-[0.62rem] px-2 py-1 rounded-md border leading-snug ${delayTypeChipClass(kind)}`}
                >
                  {DELAY_TYPE_LABEL[kind] || kind}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div
        className="flex min-h-0 min-w-0 flex-1 basis-0 flex-col gap-3 overflow-y-auto overflow-x-hidden overscroll-contain custom-scrollbar sm:border-l sm:border-white/[0.1] sm:pl-3"
        aria-label="Delay reason and comments"
      >
        <div className="min-w-0 max-w-full shrink-0">
          <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-text-secondary mb-1">
            Delay reason (from comments)
          </div>
          <p className="text-xs leading-relaxed text-foreground/90 rounded-md border border-white/10 bg-white/[0.03] px-2 py-2 break-words whitespace-pre-wrap [overflow-wrap:anywhere] max-w-full">
            {task.blockerReason}
          </p>
        </div>

        <div className="min-w-0 max-w-full pb-0.5">
          <div className="text-[0.6rem] font-semibold uppercase tracking-wide text-text-secondary mb-1.5">
            Comments
          </div>
          <div className="space-y-2 min-w-0 max-w-full">
            {task.comments && task.comments.length > 0 ? (
              task.comments.map((comment, index) => (
                <div
                  key={`${task.id}-c-${index}`}
                  className="text-[0.65rem] rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 min-w-0 max-w-full overflow-hidden"
                >
                  <div className="text-text-secondary text-[0.6rem] break-words mb-0.5">
                    {comment.author} {comment.date && `· ${formatDate(comment.date)}`}
                  </div>
                  <div className="text-foreground/90 break-words whitespace-pre-wrap [overflow-wrap:anywhere] max-w-full">
                    {comment.text || comment.comment}
                  </div>
                </div>
              ))
            ) : commentsSorted.length === 0 ? (
              <div className="text-xs text-text-muted">No comments found.</div>
            ) : (
              commentsSorted.map((comment, index) => (
                <div
                  key={`${task.id}-c-${index}-${comment.date || index}`}
                  className="text-xs rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 min-w-0 max-w-full overflow-hidden"
                >
                  <div className="text-text-secondary text-[0.65rem] break-words">
                    {comment.author || 'Unknown'} · {formatDate(comment.date)}
                  </div>
                  <div className="text-foreground/90 mt-1 break-words whitespace-pre-wrap [overflow-wrap:anywhere] max-w-full">
                    {comment.comment || comment.text || ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
