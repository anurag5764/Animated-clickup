import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { isAmsTaskDelayed } from '../../../lib/amsDelayed';

const MIN_SAMPLE = 5;

function resolveTasksFile() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, '..', 'ams_tasks.json'),
    path.join(cwd, 'ams_tasks.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function GET() {
  const abs = resolveTasksFile();
  if (!abs) {
    return NextResponse.json(
      {
        error: 'Missing ams_tasks.json',
        hint: 'Place ams_tasks.json in the repo root (parent of dashboard/).',
      },
      { status: 404 }
    );
  }

  try {
    const raw = fs.readFileSync(abs, 'utf-8');
    const tasks = JSON.parse(raw);
    if (!Array.isArray(tasks)) {
      return NextResponse.json({ error: 'ams_tasks.json must be a JSON array' }, { status: 500 });
    }

    /** @type {Record<string, { username: string, email: string | null, total: number, delayed: number }>} */
    const byUser = {};

    for (const task of tasks) {
      const delayed = isAmsTaskDelayed(task);
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
      sourceFile: path.basename(abs),
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
    };

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to build member stats', detail: String(e.message) },
      { status: 500 }
    );
  }
}
