/**
 * PS “What went wrong”: completed tasks only, Delayed = Yes (excludes open / in progress).
 * Writes ps_wrong_folder_tasks_<chip>.json for analyze_ps_workflow.js (wrong output).
 *
 * Usage: node extract_ps_wrong_folder_tasks.js
 * Requires: CLICKUP_API_TOKEN in .env
 */

import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';

dotenv.config();

const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const headers = { Authorization: API_TOKEN };

/** Same roster as extract_ps_folder_tasks.js */
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
    outFile: 'dashboard/data/extracts/ps_wrong_folder_tasks_qs222.json',
  },
  {
    id: 'qs223',
    label: 'QS223',
    folderId: '90172523095',
    outFile: 'dashboard/data/extracts/ps_wrong_folder_tasks_qs223.json',
  },
  {
    id: 'qs127',
    label: 'QS127',
    folderId: '90172600045',
    outFile: 'dashboard/data/extracts/ps_wrong_folder_tasks_qs127.json',
  },
];

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function taskMatchesPsMember(task) {
  const assignees = task.assignees || [];
  return assignees.some((a) => {
    const un = String(a.username || '').toLowerCase();
    return PS_ASSIGNEES.some((m) => un.includes(m.toLowerCase()) || m.toLowerCase().includes(un));
  });
}

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

function isCompletedTask(task) {
  const type = String(task.status?.type || '').toLowerCase();
  if (type === 'closed' || type === 'done') return true;
  const name = String(task.status?.status || '').trim();
  return /^(complete|completed|done|closed)$/i.test(name);
}

function parseDelayedMetadataFull(customFields = []) {
  const delayedField = customFields.find(
    (field) => String(field?.name || '').trim().toLowerCase() === 'delayed'
  );
  const delayDurationField = customFields.find(
    (field) => String(field?.name || '').trim().toLowerCase() === 'delay duration'
  );
  let delayedFlag = 'unknown';
  if (delayedField) {
    const value = delayedField.value;
    const options = delayedField?.type_config?.options || [];
    const byOrder = options.find((opt) => Number(opt?.orderindex) === Number(value));
    const byId = options.find((opt) => String(opt?.id) === String(value));
    const selectedName = String(byOrder?.name || byId?.name || '').toLowerCase();
    if (selectedName === 'yes' || value === 0 || value === '0') delayedFlag = 'yes';
    else if (selectedName === 'no' || value === 1 || value === '1') delayedFlag = 'no';
  }
  let delayDurationDays = null;
  if (
    delayDurationField &&
    delayDurationField.value !== undefined &&
    delayDurationField.value !== null &&
    delayDurationField.value !== ''
  ) {
    const parsedDuration = Number(delayDurationField.value);
    delayDurationDays = Number.isFinite(parsedDuration) ? parsedDuration : null;
  }
  return { delayedFlag, delayDurationDays };
}

function isDelayedYes(task) {
  const customFields = task.custom_fields || [];
  const { delayedFlag, delayDurationDays } = parseDelayedMetadataFull(customFields);
  
  // 1. Explicit flag
  if (delayedFlag === 'yes') return true;
  
  // 2. Positive delay duration field
  if (delayDurationDays !== null && delayDurationDays > 0) return true;
  
  // 3. Date comparison: completion vs due
  if (task.date_done && task.due_date) {
    if (Number(task.date_done) > Number(task.due_date)) return true;
  }
  
  return false;
}

function findCustomFieldMs(customFields, names) {
  const want = new Set(names.map((n) => String(n).trim().toLowerCase()));
  const field = (customFields || []).find((f) => want.has(String(f?.name || '').trim().toLowerCase()));
  if (!field || field.value == null || field.value === '') return null;
  const n = Number(field.value);
  return Number.isFinite(n) ? n : null;
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, { headers, ...options });
      return res;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        await sleep((i + 1) * 2000);
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

async function getTaskCommentsRaw(taskId) {
  const res = await fetchWithRetry(`https://api.clickup.com/api/v2/task/${taskId}/comment`);
  if (!res?.data?.comments) return [];
  return res.data.comments.map((c) => ({
    text: c.comment_text,
    author: c.user?.username,
    date: c.date,
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
  console.log('   Filter: PS assignees + completed + Delayed=Yes only (include_closed=true)');

  const outTasks = [];
  const seen = new Set();

  for (let li = 0; li < lists.length; li++) {
    const list = lists[li];
    console.log(`  ▸ List ${li + 1}/${lists.length} "${list.name}" (${list.id})`);

    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const tasksRes = await fetchWithRetry(`https://api.clickup.com/api/v2/list/${list.id}/task`, {
        params: {
          subtasks: true,
          include_closed: true,
          include_markdown_description: true,
          page,
        },
      });

      if (!tasksRes?.data?.tasks?.length) {
        break;
      }

      const rootRows = tasksRes.data.tasks;
      const pageTasks = flattenTasksIncludingNestedSubtasks(rootRows);

      for (const task of pageTasks) {
        if (!taskMatchesPsMember(task)) continue;
        if (!isCompletedTask(task)) continue;
        if (!isDelayedYes(task)) continue;
        if (seen.has(task.id)) continue;
        seen.add(task.id);

        process.stdout.write(
          `       comments "${(task.name || '').slice(0, 45)}${(task.name || '').length > 45 ? '…' : ''}" … `
        );
        const comments = await getTaskCommentsRaw(task.id);
        await sleep(150);
        console.log('ok');

        const customFields = task.custom_fields || [];
        const delayMeta = parseDelayedMetadataFull(customFields);
        const plannedStartMs = findCustomFieldMs(customFields, ['Planned Start date', 'Planned start date']);
        const plannedDueMs = findCustomFieldMs(customFields, ['Planned Due date', 'Planned due date']);
        const toStoredMs = (ms) => (ms == null || !Number.isFinite(ms) ? null : String(ms));

        outTasks.push({
          id: task.id,
          name: task.name,
          description: task.markdown_description || task.description,
          status: task.status?.status,
          statusType: task.status?.type,
          priority: task.priority?.priority,
          assignees: (task.assignees || []).map((a) => ({
            id: a.id,
            username: a.username,
            email: a.email,
          })),
          creator: task.creator?.username,
          plannedStartDate: toStoredMs(plannedStartMs),
          plannedDueDate: toStoredMs(plannedDueMs),
          actualStartDate: task.start_date ?? null,
          actualCompletionDate: task.date_done ?? task.date_closed ?? null,
          dueDate: task.due_date,
          startDate: task.start_date,
          dateCreated: task.date_created,
          dateUpdated: task.date_updated,
          tags: task.tags?.map((t) => t.name),
          parent: task.parent,
          subtasks: task.subtasks || [],
          dependencies: task.dependencies || [],
          linkedTasks: task.linked_tasks || [],
          customFields,
          delayedFlag: delayMeta.delayedFlag,
          delayDurationDays: delayMeta.delayDurationDays,
          listId: list.id,
          listName: list.name,
          comments,
        });
      }

      hasMore = rootRows.length === 100;
      page += 1;
    }
  }

  return outTasks;
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
      extractMode: 'ps_assignee_completed_delayed_yes',
      taskCount: tasks.length,
      tasks,
    };
    fs.mkdirSync('dashboard/data/extracts', { recursive: true });
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
