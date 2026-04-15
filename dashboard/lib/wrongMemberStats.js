/**
 * Aggregate assignee workload for PS/RTL dashboards.
 * Mirrors dashboard/app/api/ams-member-stats shape for shared UI.
 *
 * Delay detection matches AMS (`isAmsTaskDelayed`): ClickUp **Delayed** custom field on the task
 * (via `task.raw`, or `custom_fields` on folder extracts). Do not use `task.delayedLabel` alone —
 * the wrong pipeline sets that string to "Yes" on every enriched task for UI.
 */

import { isAmsTaskDelayed } from './amsDelayed.js';

const MIN_SAMPLE = 5;

/** Same delayed logic as ams-member-stats: custom field Delayed (Yes/No). */
function isPsRtlTaskDelayed(task) {
  const raw = task?.raw || task;
  return isAmsTaskDelayed(raw);
}

/**
 * @param {object} task
 * @returns {string[]}
 */
function collectAssigneeKeys(task) {
  const raw = task?.raw || task;
  const assignees = Array.isArray(raw.assignees)
    ? raw.assignees
    : Array.isArray(task.assignees)
      ? task.assignees
      : [];
  if (assignees.length === 0) return ['__unassigned__'];
  if (typeof assignees[0] === 'string') {
    const keys = assignees.map((a) => String(a).trim()).filter(Boolean);
    return keys.length ? keys : ['__unassigned__'];
  }
  const keys = assignees
    .map((a) => String(a.username || a.email || a.id || '').trim())
    .filter(Boolean);
  return keys.length ? keys : ['__unassigned__'];
}

/**
 * @param {object} task
 * @returns {Array<{ username?: string, email?: string | null, id?: string | number }>}
 */
function assigneesForLookup(task) {
  const raw = task?.raw || task;
  const assignees = Array.isArray(raw.assignees)
    ? raw.assignees
    : Array.isArray(task.assignees)
      ? task.assignees
      : [];
  if (assignees.length === 0) return [];
  if (typeof assignees[0] === 'string') {
    return assignees.map((u) => ({ username: String(u).trim() }));
  }
  return assignees;
}

function collectTasksFromWrongPayload(data) {
  const out = [];
  const stages = Array.isArray(data?.stages) ? data.stages : [];
  for (const stage of stages) {
    const tasks = Array.isArray(stage?.tasks) ? stage.tasks : [];
    for (const t of tasks) out.push(t);
  }
  return out;
}

/**
 * @param {object[]} tasks
 * @param {{ team: 'ps'|'rtl', project: string, sourceFile: string, workflowTitle?: string, statsScope?: string }} meta
 */
export function buildMemberStatsPayloadFromTasks(tasks, meta) {
  /** @type {Record<string, { username: string, email: string | null, total: number, delayed: number }>} */
  const byUser = {};

  for (const task of tasks) {
    const delayed = isPsRtlTaskDelayed(task);
    const keys = collectAssigneeKeys(task);
    const assignees = assigneesForLookup(task);

    for (const key of keys) {
      if (!byUser[key]) {
        if (key === '__unassigned__') {
          byUser[key] = { username: 'Unassigned', email: null, total: 0, delayed: 0 };
        } else {
          const a = assignees.find(
            (x) =>
              String(x.username || '').trim() === key ||
              String(x.email || '').trim() === key ||
              String(x.id) === key
          );
          byUser[key] = {
            username: a?.username || key,
            email: a?.email ?? null,
            total: 0,
            delayed: 0,
          };
        }
      }
      byUser[key].total += 1;
      if (delayed) byUser[key].delayed += 1;
    }
  }

  const members = Object.values(byUser)
    .map((m) => {
      const onTime = m.total - m.delayed;
      const onTimeRate = m.total > 0 ? Math.round((onTime / m.total) * 1000) / 10 : 0;
      return {
        username: m.username,
        email: m.email,
        totalTasks: m.total,
        delayedTasks: m.delayed,
        onTimeTasks: onTime,
        onTimeRate,
        sufficientSample: m.total >= MIN_SAMPLE,
      };
    })
    .filter((m) => m.totalTasks > 0);

  const ranked = [...members].filter((m) => m.sufficientSample);
  ranked.sort((a, b) => b.onTimeRate - a.onTimeRate);

  let pooledTotal = 0;
  let pooledDelayed = 0;
  for (const m of members) {
    pooledTotal += m.totalTasks;
    pooledDelayed += m.delayedTasks;
  }
  const teamOnTimeRate =
    pooledTotal > 0 ? Math.round(((pooledTotal - pooledDelayed) / pooledTotal) * 1000) / 10 : null;

  const teamLabel = meta.team === 'ps' ? 'PS Team' : 'RTL Team';
  const workflowTitle =
    meta.workflowTitle || (meta.team === 'ps' ? 'Test Flow' : 'RTL Pipeline');

  return {
    generatedAt: new Date().toISOString(),
    sourceFile: meta.sourceFile,
    minSampleForRanking: MIN_SAMPLE,
    teamKind: meta.team,
    projectId: meta.project,
    teamLabel,
    workflowTitle,
    statsScope: meta.statsScope || 'wrong_workflow',
    team: {
      totalTaskAssignments: pooledTotal,
      delayedAssignments: pooledDelayed,
      onTimeRate: teamOnTimeRate,
    },
    members,
    rankedBestToWorst: ranked.map((m, i) => ({ ...m, rank: i + 1 })),
    attentionNeeded: [...ranked].sort((a, b) => a.onTimeRate - b.onTimeRate).slice(0, 8),
    topPerformers: [...ranked].sort((a, b) => b.onTimeRate - a.onTimeRate).slice(0, 8),
    lowSample: members.filter((m) => !m.sufficientSample),
  };
}

/**
 * @param {object} data - Parsed output_ps_wrong_*.json or output_rtl_wrong_*.json
 * @param {{ team: 'ps'|'rtl', project: string, sourceFile: string }} meta
 */
export function buildWrongWorkflowMemberStatsPayload(data, meta) {
  const tasks = collectTasksFromWrongPayload(data);
  return buildMemberStatsPayloadFromTasks(tasks, {
    ...meta,
    workflowTitle: meta.team === 'ps' ? 'Test Flow' : 'RTL Pipeline',
    statsScope: 'wrong_workflow',
  });
}

/**
 * Member stats from folder extract (`ps_folder_tasks_*.json` / `rtl_folder_tasks_*.json`):
 * all PS/RTL-filtered in-progress tasks with assignee strings + `custom_fields` (after re-extract).
 *
 * @param {object} data - Parsed folder extract payload with `tasks[]`
 * @param {{ team: 'ps'|'rtl', project: string, sourceFile: string }} meta
 */
export function buildFolderMemberStatsPayload(data, meta) {
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  return buildMemberStatsPayloadFromTasks(tasks, {
    ...meta,
    workflowTitle:
      meta.team === 'ps'
        ? 'PS folder (in-progress tasks)'
        : 'RTL folder (in-progress tasks)',
    statsScope: 'folder_extract',
  });
}
