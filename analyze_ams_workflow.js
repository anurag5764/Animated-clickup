/**
 * Per-project AMS workflow JSON for the dashboard.
 * - current: in-progress tasks → output_ams_current_<chip>.json ("Where we are currently")
 * - wrong: completed + Delayed=Yes → output_ams_wrong_<chip>.json ("What went wrong")
 *
 * Prereq: node extract_ams_folder_tasks.js && node extract_ams_wrong_folder_tasks.js
 * Requires: Ollama (OLLAMA_URL / default http://localhost:11434)
 *
 * Usage: node analyze_ams_workflow.js
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { parseLnoFromName } from './lno.js';
import {
  PIPELINE_STAGES,
  classifyTask,
  normalizeClassification,
  refineStageFromTaskContent,
  applyGroundedReason,
  isDelayedTask,
  inferStageFromKeywords,
  NEUTRAL_DELAY_REASON,
} from './classify.js';

dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

const CHIPS = ['qs222', 'qs223', 'qs127'];

/** One job per chip × view */
const JOBS = CHIPS.flatMap((id) => [
  {
    id,
    kind: 'current',
    tasksFile: `data/extracts/ams_current_folder_tasks_${id}.json`,
    outputFile: `data/outputs/output_ams_current_${id}.json`,
  },
  {
    id,
    kind: 'wrong',
    tasksFile: `data/extracts/ams_wrong_folder_tasks_${id}.json`,
    outputFile: `data/outputs/output_ams_wrong_${id}.json`,
  },
]);

function resolveInputFile(filePath) {
  if (fs.existsSync(filePath)) return filePath;
  const legacy = path.basename(filePath);
  if (fs.existsSync(legacy)) return legacy;
  return filePath;
}

function buildAmsProjectPayload(tasksWithClassification, projectId, totalInputTasks, modeLabel) {
  const stageSummary = {};
  for (let i = 1; i <= 6; i++) {
    stageSummary[i] = {
      stageNumber: i,
      stageName: PIPELINE_STAGES.find((s) => s.id === i)?.name || `Stage ${i}`,
      total: 0,
      delayed: 0,
      lnoLeverage: 0,
      lnoNeutral: 0,
      lnoOverhead: 0,
      lnoUnparsed: 0,
    };
  }

  const blockerTypeBreakdown = {
    dependency: 0,
    technical: 0,
    review: 0,
    resource: 0,
    requirement: 0,
    unknown: 0,
  };

  let delayedTotal = 0;

  for (const task of tasksWithClassification) {
    const stage = Number(task.classification?.stage);
    if (!Number.isFinite(stage) || stage < 1 || stage > 6) continue;

    const bucket = stageSummary[stage];
    bucket.total += 1;

    const delayed = isDelayedTask(task);
    if (delayed) {
      delayedTotal += 1;
      bucket.delayed += 1;
    }

    const { tier } = parseLnoFromName(task.name);
    if (tier === 'L') bucket.lnoLeverage += 1;
    else if (tier === 'N') bucket.lnoNeutral += 1;
    else if (tier === 'O') bucket.lnoOverhead += 1;
    else bucket.lnoUnparsed += 1;

    const type = String(task.classification?.blockerType || 'unknown').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(blockerTypeBreakdown, type)) {
      blockerTypeBreakdown[type] += 1;
    } else {
      blockerTypeBreakdown.unknown += 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: modeLabel,
    project: projectId,
    totalTasks: totalInputTasks,
    delayedTasksClassified: delayedTotal,
    stageSummary: Object.values(stageSummary),
    blockerTypeBreakdown,
    tasks: tasksWithClassification,
  };
}

/** wrong extract: every task is delayed — always full LLM classify */
async function classifyOneAmsTask(task, kind) {
  const forceFull = kind === 'wrong';
  if (forceFull || isDelayedTask(task)) {
    let classification = normalizeClassification(await classifyTask(task));
    classification = refineStageFromTaskContent(task, classification);
    classification = applyGroundedReason(task, classification);
    return { ...task, classification };
  }

  const hint = inferStageFromKeywords(task);
  const stage = hint != null && hint >= 1 && hint <= 6 ? hint : 3;
  const stageName = PIPELINE_STAGES.find((s) => s.id === stage)?.name || 'Circuit Implementation and Sim';

  return {
    ...task,
    classification: {
      stage,
      stageName,
      confidence: 0.45,
      reasoning: 'Keyword routing (task not marked Delayed = Yes)',
      isBlocker: false,
      blockerType: 'unknown',
      blockerReason: NEUTRAL_DELAY_REASON,
    },
  };
}

async function ollamaReachable() {
  try {
    const res = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 4000 });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function analyzeJob(job) {
  const modeLabel =
    job.kind === 'wrong' ? 'completed-delayed' : 'current-in-progress';

  console.log(`\n${'='.repeat(60)}\n  AMS ${job.kind} · ${job.id}\n${'='.repeat(60)}`);

  if (!fs.existsSync(job.tasksFile)) {
    console.warn(
      `⚠️  Skip — missing ${job.tasksFile}\n   Run: node extract_ams_folder_tasks.js and/or node extract_ams_wrong_folder_tasks.js`
    );
    return;
  }

  const raw = JSON.parse(fs.readFileSync(resolveInputFile(job.tasksFile), 'utf-8'));
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  console.log(`📋 ${tasks.length} task(s) in ${job.tasksFile}`);

  const out = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    process.stdout.write(`  [${i + 1}/${tasks.length}] "${String(t.name || '').slice(0, 48)}"… `);
    try {
      const done = await classifyOneAmsTask(t, job.kind);
      out.push(done);
      console.log(`→ stage ${done.classification.stage}`);
    } catch (e) {
      console.log(`\n  ❌ ${e.message}`);
      const hint = inferStageFromKeywords(t) || 3;
      out.push({
        ...t,
        classification: {
          stage: hint,
          stageName: PIPELINE_STAGES.find((s) => s.id === hint)?.name || 'Circuit Implementation and Sim',
          confidence: 0,
          reasoning: 'Fallback after error',
          isBlocker: false,
          blockerType: 'unknown',
          blockerReason: NEUTRAL_DELAY_REASON,
        },
      });
    }
  }

  const payload = buildAmsProjectPayload(out, job.id, tasks.length, modeLabel);
  fs.mkdirSync(path.dirname(job.outputFile), { recursive: true });
  fs.writeFileSync(job.outputFile, JSON.stringify(payload, null, 2));
  console.log(`\n✓ Saved ${job.outputFile}`);

  const pub = path.join('dashboard', 'public', path.basename(job.outputFile));
  try {
    fs.mkdirSync(path.dirname(pub), { recursive: true });
    fs.copyFileSync(job.outputFile, pub);
    console.log(`✓ Copied to ${pub}`);
  } catch (err) {
    console.warn(`⚠️  Could not copy to dashboard/public: ${err.message}`);
  }
}

async function main() {
  const ok = await ollamaReachable();
  if (!ok) {
    console.error(`❌ Ollama not reachable at ${OLLAMA_URL}. Start: ollama serve`);
    process.exit(1);
  }
  console.log(`✓ Ollama OK at ${OLLAMA_URL}`);

  for (const job of JOBS) {
    await analyzeJob(job);
  }

  console.log(`\n${'='.repeat(60)}\n  ✓ AMS analysis (current + wrong) complete\n${'='.repeat(60)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
