/**
 * AMS folder → ams_tasks.json for classify.js / dashboard.
 * Includes only completed/closed ClickUp tasks (excludes in-progress and open).
 */
import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import fs from 'fs';

const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const FOLDER_ID = '90172523095';
const headers = { Authorization: API_TOKEN };

const AMS_MEMBERS = [
  "Subodh Kumar", "Shovan Maity", "sumon", "Ebin Abraham",
  "Anirudh Roy (Deactivated)", "Aniruddh Choudhary", "Sayemul Islam",
  "Arka Chowdhury", "Gulshan Poddar", "KiritkumarP", "hareesh th",
  "Irappa Bagodi", "Ayash Ashraf", "Manash Dey", "Samanway Pal"
];

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

/** Keep only tasks that are finished in ClickUp (not open / in progress). */
function isCompletedTask(task) {
  const type = String(task.status?.type || '').toLowerCase();
  if (type === 'closed') return true;
  const name = String(task.status?.status || '').trim();
  return /^(complete|completed|done|closed)$/i.test(name);
}

/** ClickUp custom date fields → ms (API value is usually a numeric string). */
function findCustomFieldMs(customFields, names) {
  const want = new Set(names.map((n) => String(n).trim().toLowerCase()));
  const field = (customFields || []).find((f) =>
    want.has(String(f?.name || '').trim().toLowerCase())
  );
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
  if (delayDurationField && delayDurationField.value !== undefined && delayDurationField.value !== null && delayDurationField.value !== '') {
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
        console.log(`  ⚠️  Rate limited. Waiting ${waitMs}ms...`);
        await sleep(waitMs);
      } else if (status === 401 || status === 403) {
        console.error('Auth error — check your API token');
        process.exit(1);
      } else {
        console.error(`  ❌ Error ${status} on ${url}:`, err.response?.data);
        return null;
      }
    }
  }
  return null;
}

async function getAllTasksInFolder() {
  const listsRes = await fetchWithRetry(
    `https://api.clickup.com/api/v2/folder/${FOLDER_ID}/list`
  );
  const lists = listsRes.data.lists;
  console.log(`✅ Found ${lists.length} lists: ${lists.map(l => l.name).join(', ')}`);

  const allTasks = [];

  for (const list of lists) {
    console.log(`\n📋 Fetching list: "${list.name}" (${list.id})`);
    let page = 0;
    let hasMore = true;
    let listTaskCount = 0;

    while (hasMore) {
      const tasksRes = await fetchWithRetry(
        `https://api.clickup.com/api/v2/list/${list.id}/task`,
        {
          params: {
            subtasks: true,
            include_closed: true,
            include_markdown_description: true,
            page,
          },
        }
      );

      if (!tasksRes) break;
      const tasks = tasksRes.data.tasks;
      if (!tasks || tasks.length === 0) { hasMore = false; break; }

      console.log(`  Page ${page}: ${tasks.length} tasks fetched`);

      for (const task of tasks) {
        if (!isCompletedTask(task)) continue;

        // AMS member filter
        const assigneeNames = (task.assignees || []).map((a) => a.username);
        const isAMSTask = assigneeNames.some((name) =>
          AMS_MEMBERS.some((m) => name.toLowerCase().includes(m.toLowerCase()))
        );
        if (!isAMSTask) continue;

        listTaskCount++;
        process.stdout.write(`  🔄 Fetching comments for: "${task.name.slice(0, 40)}"...`);

        const commentsRes = await fetchWithRetry(
          `https://api.clickup.com/api/v2/task/${task.id}/comment`
        );
        await sleep(200);

        process.stdout.write(' ✓\n');

        const customFields = task.custom_fields || [];
        const delayMeta = parseDelayedMetadata(customFields);

        const plannedStartMs = findCustomFieldMs(customFields, [
          'Planned Start date',
          'Planned start date',
        ]);
        const plannedDueMs = findCustomFieldMs(customFields, [
          'Planned Due date',
          'Planned due date',
        ]);
        const toStoredMs = (ms) => (ms == null || !Number.isFinite(ms) ? null : String(ms));

        /**
         * Date fields (ClickUp → JSON, ms as strings):
         * - plannedStartDate / plannedDueDate: custom fields "Planned Start/Due date" (not native start/due).
         * - startDate / actualStartDate: native Start date column (= actual start; there is no separate "actual start" field).
         * - dueDate: native Due date (target / deadline).
         * - actualCompletionDate: Date Done (API date_done), then date_closed if needed.
         */
        allTasks.push({
          id: task.id,
          name: task.name,
          description: task.markdown_description || task.description,
          status: task.status?.status,
          statusType: task.status?.type,
          priority: task.priority?.priority,
          assignees: task.assignees.map(a => ({
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
          tags: task.tags?.map(t => t.name),
          parent: task.parent,
          subtasks: task.subtasks || [],
          dependencies: task.dependencies || [],
          linkedTasks: task.linked_tasks || [],
          customFields,
          delayedFlag: delayMeta.delayedFlag,
          delayDurationDays: delayMeta.delayDurationDays,
          listId: list.id,
          listName: list.name,
          comments: commentsRes?.data.comments?.map(c => ({
            text: c.comment_text,
            author: c.user?.username,
            date: c.date,
          })) || [],
        });
      }

      hasMore = tasks.length === 100;
      page++;
    }

    console.log(`  ✅ ${listTaskCount} AMS tasks found in "${list.name}"`);
  }

  return allTasks;
}

getAllTasksInFolder()
  .then((tasks) => {
    console.log(`\n🎉 Total AMS completed tasks fetched: ${tasks.length} (in-progress / open excluded)`);
    fs.writeFileSync('ams_tasks.json', JSON.stringify(tasks, null, 2));
    console.log('💾 Saved to ams_tasks.json');

    const byMember = {};
    tasks.forEach(t => {
      t.assignees.forEach(a => {
        byMember[a.username] = (byMember[a.username] || 0) + 1;
      });
    });
    console.log('\n📊 Tasks per member:');
    Object.entries(byMember)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => console.log(`  ${name}: ${count}`));
  })
  .catch(console.error);