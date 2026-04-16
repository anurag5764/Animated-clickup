/**
 * AMS Leaderboard Stats: completed tasks only.
 * Calculates total completed vs delayed tasks per member.
 * Writes leaderboard_ams_qs222.json etc. directly for the dashboard.
 *
 * Usage: node extract_ams_leaderboard_stats.js
 * Requires: CLICKUP_API_TOKEN in .env
 */

import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

dotenv.config();

const API_TOKEN = process.env.CLICKUP_API_TOKEN;
const headers = { Authorization: API_TOKEN };

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
    outFile: 'dashboard/data/extracts/leaderboard_ams_qs222.json',
  },
  {
    id: 'qs223',
    label: 'QS223',
    folderId: '90172523095',
    outFile: 'dashboard/data/extracts/leaderboard_ams_qs223.json',
  },
  {
    id: 'qs127',
    label: 'QS127',
    folderId: '90172600045',
    outFile: 'dashboard/data/extracts/leaderboard_ams_qs127.json',
  },
];

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

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

async function extractFolderStats(project) {
  const listsRes = await fetchWithRetry(`https://api.clickup.com/api/v2/folder/${project.folderId}/list`);
  if (!listsRes?.data?.lists) {
    console.error(`No lists for folder ${project.folderId}`);
    return {};
  }

  const lists = listsRes.data.lists;
  console.log(`\n📁 ${project.label} (${project.folderId}): ${lists.length} list(s)`);
  console.log('   Filter: AMS assignees + completed + calculating delay ratios');

  const byUser = {};
  const seen = new Set();
  let totalProcessed = 0;

  for (let li = 0; li < lists.length; li++) {
    const list = lists[li];
    console.log(`  ▸ List ${li + 1}/${lists.length} "${list.name}" (${list.id})`);

    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const tasksRes = await fetchWithRetry(`https://api.clickup.com/api/v2/list/${list.id}/task`, {
        params: {
          subtasks: true,
          include_closed: true, // We want completed tasks
          include_markdown_description: false, // Don't need descriptions for stats
          page,
        },
      });

      if (!tasksRes?.data?.tasks?.length) break;

      const rootRows = tasksRes.data.tasks;
      const pageTasks = flattenTasksIncludingNestedSubtasks(rootRows);

      for (const task of pageTasks) {
        if (!taskMatchesAmsMember(task)) continue;
        if (!isCompletedTask(task)) continue;
        if (seen.has(task.id)) continue;
        seen.add(task.id);

        totalProcessed++;
        const delayed = isDelayedYes(task);
        const assignees = Array.isArray(task.assignees) ? task.assignees : [];
        let keys = assignees
          .map((a) => String(a.username || a.email || a.id || '').trim())
          .filter(Boolean);
        
        if (keys.length === 0) keys = ['__unassigned__'];

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
                email: a?.email || null,
                total: 0,
                delayed: 0,
              };
            }
          }
          byUser[key].total += 1;
          if (delayed) byUser[key].delayed += 1;
        }
      }

      hasMore = rootRows.length === 100;
      page += 1;
    }
  }

  console.log(`  ✓ Processed ${totalProcessed} assigned completed tasks`);
  return { byUser, totalProcessed };
}

async function main() {
  if (!API_TOKEN) {
    console.error('Missing CLICKUP_API_TOKEN');
    process.exit(1);
  }

  const MIN_SAMPLE = 5;
  const summary = {};

  for (const project of PROJECTS) {
    console.log(`\n${'='.repeat(60)}\n  ${project.label} — folder ${project.folderId}\n${'='.repeat(60)}`);
    const { byUser = {}, totalProcessed = 0 } = await extractFolderStats(project);
    
    // Format the payload identically to what the dashboard components expect
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

    const payload = {
      generatedAt: new Date().toISOString(),
      teamKind: 'ams',
      teamLabel: 'AMS Team',
      workflowTitle: 'Leaderboard Stats',
      projectId: project.id,
      minSampleForRanking: MIN_SAMPLE,
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
      rawTasksProcessed: totalProcessed
    };

    fs.mkdirSync(path.dirname(project.outFile), { recursive: true });
    fs.writeFileSync(project.outFile, JSON.stringify(payload, null, 2));

    const pub = `./dashboard/public/${path.basename(project.outFile)}`;
    try {
      fs.mkdirSync('./dashboard/public', { recursive: true });
      fs.copyFileSync(project.outFile, pub);
    } catch (err) {
      console.warn(`⚠️  Could not copy to dashboard/public`);
    }

    console.log(`\n💾 Payload saved for ${Object.keys(byUser).length} members → ${project.outFile}`);
    summary[project.id] = totalProcessed;
  }

  console.log(`\n✅ Done. Summary:`, summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
