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

// Rate limit: ClickUp allows ~100 req/min — add a small delay between calls
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(url, { headers, ...options });
      return res;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        // Rate limited — wait and retry
        const waitMs = (i + 1) * 2000;
        console.log(`  ⚠️  Rate limited. Waiting ${waitMs}ms...`);
        await sleep(waitMs);
      } else if (status === 401 || status === 403) {
        console.error('Auth error — check your API token');
        process.exit(1);
      } else {
        console.error(`  ❌ Error ${status} on ${url}:`, err.response?.data);
        return null; // skip this task rather than crashing
      }
    }
  }
  return null;
}

async function getAllTasksInFolder() {
  // Step 1: Get all lists
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
        const assigneeNames = task.assignees.map(a => a.username);
        const isAMSTask = assigneeNames.some(name =>
          AMS_MEMBERS.some(m => name.toLowerCase().includes(m.toLowerCase()))
        );
        if (!isAMSTask) continue;

        listTaskCount++;
        process.stdout.write(`  🔄 Fetching comments for: "${task.name.slice(0, 40)}"...`);

        const commentsRes = await fetchWithRetry(
          `https://api.clickup.com/api/v2/task/${task.id}/comment`
        );
        await sleep(200); // small delay to avoid rate limiting

        process.stdout.write(' ✓\n');

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
          dueDate: task.due_date,
          startDate: task.start_date,
          dateCreated: task.date_created,
          dateUpdated: task.date_updated,
          tags: task.tags?.map(t => t.name),
          parent: task.parent,
          subtasks: task.subtasks || [],
          dependencies: task.dependencies || [],
          linkedTasks: task.linked_tasks || [],
          customFields: task.custom_fields || [],
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
  .then(tasks => {
    console.log(`\n🎉 Total AMS tasks fetched: ${tasks.length}`);
    fs.writeFileSync('ams_tasks.json', JSON.stringify(tasks, null, 2));
    console.log('💾 Saved to ams_tasks.json');

    // Quick summary
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