/**
 * Extract PS-relevant tasks from two ClickUp folders (projects).
 * Keeps only tasks assigned to at least one PS team member.
 * Output: slim JSON (name, description, comments) for AI stage mapping.
 *
 * PS filter: keeps tasks and subtasks where at least one assignee matches PS_ASSIGNEES.
 * Work-state filter: only active / in-progress work — excludes closed and done-like statuses
 * (include_closed=false, plus client-side checks on status.type and status name).
 * Optional: PS_EXTRACT_STATUSES="In Progress,In Review" (comma-separated, case-insensitive)
 *           — if set, only those exact ClickUp status names are kept (still PS-assignee filtered).
 * Set PS_EXTRACT_INCLUDE_CLOSED=1 to pass include_closed=true to the API (not recommended).
 *
 * List requests use subtasks=true; we also walk nested task.subtasks so nested subtasks
 * are never skipped when the API nests them under parents.
 *
 * Usage: node extract_ps_folder_tasks.js
 * Requires: CLICKUP_API_TOKEN in .env
 */

import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';

dotenv.config();

const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const headers = { Authorization: API_TOKEN };

/** Same roster as member.js PS team */
const PS_ASSIGNEES = [
  
  'sumon',
  
  'Vinayak Agrawal',
  'Kumaresh Dhotrad',
  'Sarat Anumula',
  'Tomin Jose',

  'Anish Saha',
  'Deepthi Kammath',
  'Ashutosh Nahar',
];

const PROJECTS = [
  {
    id: 'qs222',
    label: 'QS222',
    folderId: '90172530829',
    outFile: 'data/extracts/ps_folder_tasks_qs222.json',
  },
  {
    id: 'qs223',
    label: 'QS223',
    folderId: '90172523095',
    outFile: 'data/extracts/ps_folder_tasks_qs223.json',
  },
  {
    id: 'qs127',
    label: 'QS127',
    folderId: '90172600045',
    outFile: 'data/extracts/ps_folder_tasks_qs127.json',
  },
];

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const INCLUDE_CLOSED_API =
  process.env.PS_EXTRACT_INCLUDE_CLOSED === '1' || process.env.PS_EXTRACT_INCLUDE_CLOSED === 'true';

/** If set, only tasks whose ClickUp status name matches one of these (case-insensitive). */
const STATUS_WHITELIST = (process.env.PS_EXTRACT_STATUSES || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const DONE_STATUS_NAME = /^(complete|completed|done|closed|cancelled|canceled)$/i;
const IN_PROGRESS_STATUS_NAME = /^in[\s-]?progress$/i;

function taskMatchesPsMember(task) {
  const assignees = task.assignees || [];
  return assignees.some((a) => {
    const un = String(a.username || '').toLowerCase();
    return PS_ASSIGNEES.some((m) => un.includes(m.toLowerCase()) || m.toLowerCase().includes(un));
  });
}

/**
 * ClickUp may return subtasks (a) as rows in the main `tasks` array with `parent` set, and/or
 * (b) nested under `task.subtasks`. Merge both so we evaluate PS assignees on every node.
 */
function flattenTasksIncludingNestedSubtasks(rootTasks) {
  const dedupe = new Set();
  const out = [];
  function walk(t) {
    if (!t?.id) return;
    if (dedupe.has(t.id)) return;
    dedupe.add(t.id);
    out.push(t);
    const subs = t.subtasks;
    if (Array.isArray(subs) && subs.length) {
      for (const s of subs) walk(s);
    }
  }
  for (const t of rootTasks) walk(t);
  return out;
}

/**
 * Keep only work that is still open / in progress — not closed or terminal done states.
 * ClickUp: status.type "closed" = done; date_closed set = closed; some lists use custom names.
 */
function isInProgressTask(task) {
  if (!task) return false;
  if (task.date_closed || task.dateClosed) return false;

  const st = task.status;
  const type = typeof st === 'object' && st ? st.type : null;
  if (type === 'closed' || type === 'done') return false;

  let name = '';
  if (typeof st === 'string') name = st;
  else if (st && typeof st === 'object') name = String(st.status ?? '');
  name = name.trim();
  if (name && DONE_STATUS_NAME.test(name)) return false;

  if (STATUS_WHITELIST.length > 0) {
    return STATUS_WHITELIST.includes(name.toLowerCase());
  }

  // Default strict mode: keep only explicit "In Progress" tasks.
  return IN_PROGRESS_STATUS_NAME.test(name);
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, { headers, ...options });
      return res;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        const waitMs = (i + 1) * 2000;
        console.log(`  Rate limited. Waiting ${waitMs}ms...`);
        await sleep(waitMs);
      } else if (status === 401 || status === 403) {
        console.error('Auth error — check CLICKUP_API_TOKEN');
        process.exit(1);
      } else {
        console.error(`  Error ${status} on ${url}:`, err.response?.data || err.message);
        return null;
      }
    }
  }
  return null;
}

async function getTaskComments(taskId) {
  const res = await fetchWithRetry(`https://api.clickup.com/api/v2/task/${taskId}/comment`);
  if (!res?.data?.comments) return [];
  return res.data.comments.map((c) => ({
    text: c.comment_text || '',
    author: c.user?.username || 'Unknown',
    date: c.date ? new Date(Number(c.date)).toISOString() : null,
  }));
}

async function extractFolder(project) {
  const listsRes = await fetchWithRetry(`https://api.clickup.com/api/v2/folder/${project.folderId}/list`);
  if (!listsRes?.data?.lists) {
    console.error(`No lists for folder ${project.folderId}`);
    return [];
  }

  const lists = listsRes.data.lists;
  console.log(`\n📁 ${project.label} (${project.folderId}): ${lists.length} list(s)`);
  console.log(
    `   Filter: PS assignees + in-progress only (include_closed=${INCLUDE_CLOSED_API}${STATUS_WHITELIST.length ? `; statuses=${STATUS_WHITELIST.join('|')}` : ''})`
  );
  console.log('   (Paginating each list, then one comment request per matching task — progress below.)\n');

  const slimTasks = [];
  const seen = new Set();

  for (let li = 0; li < lists.length; li++) {
    const list = lists[li];
    console.log(`  ▸ List ${li + 1}/${lists.length} "${list.name}" (${list.id})`);

    let page = 0;
    let hasMore = true;
    let listPsHits = 0;

    while (hasMore) {
      process.stdout.write(`     page ${page} … `);
      const t0 = Date.now();
      const tasksRes = await fetchWithRetry(`https://api.clickup.com/api/v2/list/${list.id}/task`, {
        params: {
          subtasks: true,
          include_closed: INCLUDE_CLOSED_API,
          include_markdown_description: true,
          page,
        },
      });

      if (!tasksRes?.data?.tasks?.length) {
        console.log(`0 tasks (${Date.now() - t0}ms)`);
        break;
      }

      const rootRows = tasksRes.data.tasks;
      const pageTasks = flattenTasksIncludingNestedSubtasks(rootRows);
      const psOnPage = [];

      let skippedNotPs = 0;
      let skippedNotActive = 0;
      for (const task of pageTasks) {
        if (!taskMatchesPsMember(task)) {
          skippedNotPs += 1;
          continue;
        }
        if (!isInProgressTask(task)) {
          skippedNotActive += 1;
          continue;
        }
        if (seen.has(task.id)) continue;
        seen.add(task.id);
        psOnPage.push(task);
      }

      console.log(
        `${rootRows.length} root row(s) → ${pageTasks.length} nodes (${Date.now() - t0}ms); ` +
          `PS+active: ${psOnPage.length} (skip ~${skippedNotPs} non-PS, ~${skippedNotActive} closed/done)`
      );

      for (let pi = 0; pi < psOnPage.length; pi++) {
        const task = psOnPage[pi];
        process.stdout.write(
          `       comments ${pi + 1}/${psOnPage.length} "${(task.name || '').slice(0, 50)}${(task.name || '').length > 50 ? '…' : ''}" … `
        );
        const comments = await getTaskComments(task.id);
        await sleep(150);
        console.log('ok');

        const description =
          task.markdown_description || task.description || '';

        slimTasks.push({
          id: task.id,
          name: task.name,
          description,
          assignees: (task.assignees || []).map((a) => a.username || '').filter(Boolean),
          /** Needed for dashboard member-stats (same Delayed field as AMS / wrong pipeline). */
          custom_fields: task.custom_fields || [],
          parentId: task.parent ?? null,
          listId: list.id,
          listName: list.name,
          comments,
        });
        listPsHits += 1;
      }

      hasMore = rootRows.length === 100;
      page += 1;
    }

    if (listPsHits > 0) {
      console.log(`     → ${listPsHits} PS task(s) kept from this list`);
    }
  }

  return slimTasks;
}

async function main() {
  if (!API_TOKEN) {
    console.error('Missing CLICKUP_API_TOKEN');
    process.exit(1);
  }

  const summary = {};

  for (const project of PROJECTS) {
    console.log(`\n${'='.repeat(60)}\n  ${project.label} — folder ${project.folderId}\n${'='.repeat(60)}`);
    const tasks = await extractFolder(project);
    const payload = {
      projectId: project.id,
      projectLabel: project.label,
      folderId: project.folderId,
      extractedAt: new Date().toISOString(),
      psAssigneeFilterCount: PS_ASSIGNEES.length,
      extractMode: 'ps_assignee_and_in_progress',
      includeClosedApi: INCLUDE_CLOSED_API,
      statusWhitelist: STATUS_WHITELIST.length ? STATUS_WHITELIST : null,
      taskCount: tasks.length,
      tasks,
    };
    fs.mkdirSync('data/extracts', { recursive: true });
    fs.writeFileSync(project.outFile, JSON.stringify(payload, null, 2));
    console.log(`\n💾 ${tasks.length} task(s) → ${project.outFile}`);
    summary[project.id] = tasks.length;
  }

  console.log(`\n✅ Done. Summary:`, summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
