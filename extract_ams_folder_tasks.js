/**
 * Extract AMS in-progress tasks (Where we are currently) from ClickUp folders (QS222, QS223, QS127).
 * Writes ams_current_folder_tasks_<chip>.json for analyze_ams_workflow.js.
 *
 * For completed+delayed only (What went wrong), use extract_ams_wrong_folder_tasks.js
 *
 * Usage: node extract_ams_folder_tasks.js
 * Requires: CLICKUP_API_TOKEN in .env
 */

import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';

dotenv.config();

const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const headers = { Authorization: API_TOKEN };

/** Same roster as test.js AMS extraction */
const AMS_MEMBERS = [
  'Subodh Kumar',
  'Shovan Maity',
  'sumon',
  'Ebin Abraham',
  'Anirudh Roy (Deactivated)',
  'Aniruddh Choudhary',
  'Sayemul Islam',
  'Arka Chowdhury',
  'Gulshan Poddar',
  'KiritkumarP',
  'hareesh th',
  'Irappa Bagodi',
  'Ayash Ashraf',
  'Manash Dey',
  'Samanway Pal',
];

const PROJECTS = [
  {
    id: 'qs222',
    label: 'QS222',
    folderId: '90172530829',
    outFile: 'data/extracts/ams_current_folder_tasks_qs222.json',
  },
  {
    id: 'qs223',
    label: 'QS223',
    folderId: '90172523095',
    outFile: 'data/extracts/ams_current_folder_tasks_qs223.json',
  },
  {
    id: 'qs127',
    label: 'QS127',
    folderId: '90172600045',
    outFile: 'data/extracts/ams_current_folder_tasks_qs127.json',
  },
];

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const INCLUDE_CLOSED_API =
  process.env.AMS_EXTRACT_INCLUDE_CLOSED === '1' || process.env.AMS_EXTRACT_INCLUDE_CLOSED === 'true';

const STATUS_WHITELIST = (process.env.AMS_EXTRACT_STATUSES || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const DONE_STATUS_NAME = /^(complete|completed|done|closed|cancelled|canceled)$/i;
const IN_PROGRESS_STATUS_NAME = /^in[\s-]?progress$/i;

function taskMatchesAmsMember(task) {
  const assignees = task.assignees || [];
  return assignees.some((a) => {
    const un = String(a.username || '').toLowerCase();
    return AMS_MEMBERS.some((m) => un.includes(m.toLowerCase()) || m.toLowerCase().includes(un));
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

  return IN_PROGRESS_STATUS_NAME.test(name);
}

function findCustomFieldMs(customFields, names) {
  const want = new Set(names.map((n) => String(n).trim().toLowerCase()));
  const field = (customFields || []).find((f) => want.has(String(f?.name || '').trim().toLowerCase()));
  if (!field || field.value == null || field.value === '') return null;
  const n = Number(field.value);
  return Number.isFinite(n) ? n : null;
}

function parseDelayedMetadata(customFields = []) {
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
  console.log(
    `   Filter: AMS assignees + in-progress only (include_closed=${INCLUDE_CLOSED_API}${
      STATUS_WHITELIST.length ? `; statuses=${STATUS_WHITELIST.join('|')}` : ''
    })`
  );

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
          include_closed: INCLUDE_CLOSED_API,
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
        if (!taskMatchesAmsMember(task)) continue;
        if (!isInProgressTask(task)) continue;
        if (seen.has(task.id)) continue;
        seen.add(task.id);

        process.stdout.write(
          `       comments "${(task.name || '').slice(0, 45)}${(task.name || '').length > 45 ? '…' : ''}" … `
        );
        const comments = await getTaskCommentsRaw(task.id);
        await sleep(150);
        console.log('ok');

        const customFields = task.custom_fields || [];
        const delayMeta = parseDelayedMetadata(customFields);

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
      amsAssigneeFilterCount: AMS_MEMBERS.length,
      extractMode: 'ams_assignee_and_in_progress',
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
