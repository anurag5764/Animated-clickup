/**
 * Map RTL folder tasks (slim JSON) to the RTL 10-stage workflow JSON for the dashboard.
 *
 * RTL Workflow Stages (from the diagram):
 *  1. Initial Spec Discussion
 *  2. Block Diagram Discussion
 *  3. RTL Implementation
 *  4. Test Case Creation and Discussion
 *  5. Lint and CDC Check
 *  6. Regression and Corner Sim
 *  7. Code Coverage
 *  8. Constraints and UPF File Creation
 *  9. Doc Creation
 * 10. Release to PD, Floor Planning
 * 11. SDF and NLP Sim  (post-PD)
 *
 * Prereq: run `node extract_rtl_folder_tasks.js`
 *
 * LLM backends (default: local Ollama):
 *   (default)            → Ollama at OLLAMA_URL (requires `ollama serve` / Ollama app)
 *   RTL_USE_OPENROUTER=1 → OpenRouter first (needs OPENROUTER_API_KEY); 402 → fallback to Ollama
 *
 * Env:
 *   OLLAMA_MODEL             default llama3.2
 *   OLLAMA_URL               default http://localhost:11434
 *   RTL_OLLAMA_BATCH_SIZE    default 10 tasks per Ollama call
 *   OPENROUTER_API_KEY       only when using OpenRouter
 *
 * Usage: node analyze_rtl_workflow.js
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { inferWrongViewDelayReason } from './wrong_delay_reason_infer.js';

dotenv.config();

const STRATEGIES = [
  {
    tasksFile: 'dashboard/data/extracts/rtl_folder_tasks_qs222.json',
    outputFile: 'dashboard/data/outputs/output_rtl_qs222.json',
  },
  {
    tasksFile: 'dashboard/data/extracts/rtl_folder_tasks_qs223.json',
    outputFile: 'dashboard/data/outputs/output_rtl_qs223.json',
  },
  {
    tasksFile: 'dashboard/data/extracts/rtl_folder_tasks_qs127.json',
    outputFile: 'dashboard/data/outputs/output_rtl_qs127.json',
  },
];

const WRONG_PROJECTS = [
  {
    tasksFile: 'dashboard/data/extracts/rtl_wrong_folder_tasks_qs222.json',
    outputFile: 'dashboard/data/outputs/output_rtl_wrong_qs222.json',
  },
  {
    tasksFile: 'dashboard/data/extracts/rtl_wrong_folder_tasks_qs223.json',
    outputFile: 'dashboard/data/outputs/output_rtl_wrong_qs223.json',
  },
  {
    tasksFile: 'dashboard/data/extracts/rtl_wrong_folder_tasks_qs127.json',
    outputFile: 'dashboard/data/outputs/output_rtl_wrong_qs127.json',
  },
];

const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const USE_OPENROUTER_FIRST =
  (process.env.RTL_USE_OPENROUTER === 'true' || process.env.RTL_USE_OPENROUTER === '1') &&
  Boolean(OPENROUTER_KEY);

function resolveInputFile(filePath) {
  if (fs.existsSync(filePath)) return filePath;
  const legacy = path.basename(filePath);
  if (fs.existsSync(legacy)) return legacy;
  return filePath;
}

// ─── RTL Stage Definitions ──────────────────────────────────────────────────

/** Must match exactly the 11 stages from the RTL workflow diagram. */
const RTL_STAGE_NAMES = [
  'Initial Spec Discussion',
  'Block Diagram Discussion',
  'RTL Implementation',
  'Test Case Creation and Discussion',
  'Lint and CDC Check',
  'Regression and Corner Sim',
  'Code Coverage',
  'Constraints and UPF File Creation',
  'Doc Creation',
  'Release to PD, Floor Planning',
  'SDF and NLP Sim',
];

const RTL_SYSTEM_PROMPT = `Map RTL IC design tasks to workflow stages 1-11. Return JSON only.

Stages:
1=Initial Spec Discussion (SB/SD/SS/SM)
2=Block Diagram Discussion (AG/SD/AC) - 1 week max
3=RTL Implementation (AG/SD/AC)
4=Test Case Creation and Discussion (AG/SD/AC) - 1 day
5=Lint and CDC Check (AG/SD/AC)
6=Regression and Corner Sim (AS/SS/UD)
7=Code Coverage (AS/SS/UD)
8=Constraints and UPF File Creation (AG/SD/AC) - 1 day
9=Doc Creation (3-4 days) (AG/SD/AC)
10=Release to PD, Floor Planning (PD)
11=SDF and NLP Sim (AS/SS/UD)

Keywords to look for:
- "spec", "specification", "requirement", "initial", "discuss", "scope" → 1
- "block diagram", "architecture", "block", "hierarchy" → 2
- "rtl", "implement", "verilog", "systemverilog", "sv", "hdl", "code", "logic", "module", "design" → 3
- "test case", "testbench", "tb", "testplan", "test plan", "test vector" → 4
- "lint", "cdc", "clock domain", "structural", "naming", "rule check" → 5
- "regression", "sim", "simulation", "corner", "coverage driven" → 6
- "code coverage", "toggle", "branch", "statement coverage", "coverage closure" → 7
- "constraint", "upf", "timing constraint", "sdc", "power intent", "cpf" → 8
- "doc", "documentation", "write", "report", "readme" → 9
- "release", "pd", "physical design", "floor plan", "handoff", "tapeout" → 10
- "sdf", "nlp", "back annotation", "timing sim", "post synthesis" → 11

Return format:
{"assignments":[{"idx":0,"stage":3},...]}\n
IMPORTANT: Return ALL tasks with their idx numbers.`;

// ─── Progress Utilities ──────────────────────────────────────────────────────

class ProgressDisplay {
  constructor() {
    this.spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.currentFrame = 0;
    this.intervalId = null;
    this.lastMessage = '';
  }

  start(message) {
    this.lastMessage = message;
    this.currentFrame = 0;
    process.stdout.write(`${this.spinnerFrames[0]} ${message}`);
    this.intervalId = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.spinnerFrames.length;
      if (process.stdout.isTTY) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(`${this.spinnerFrames[this.currentFrame]} ${this.lastMessage}`);
      }
    }, 80);
  }

  update(message) {
    this.lastMessage = message;
  }

  stop(finalMessage, symbol = '✓') {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (process.stdout.isTTY) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    }
    console.log(`${symbol} ${finalMessage}`);
  }
}

function printProgressBar(current, total, label = '') {
  const barLength = 30;
  const percentage = Math.min(100, Math.round((current / total) * 100));
  const filled = Math.round((barLength * current) / total);
  const empty = barLength - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const statusLine = `${label} [${bar}] ${percentage}% (${current}/${total})`;
  if (process.stdout.isTTY) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(statusLine);
  } else if (current === total) {
    console.log(statusLine);
  }
  if (current === total) process.stdout.write('\n');
}

// ─── LLM Helpers ────────────────────────────────────────────────────────────

async function ollamaReachable() {
  try {
    const res = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 4000 });
    return res.status === 200;
  } catch {
    return false;
  }
}

function isOpenRouterCreditsError(err) {
  const status = err.response?.status;
  const body = err.response?.data;
  const msg = typeof body === 'string' ? body : JSON.stringify(body || '');
  if (status === 402) return true;
  if (/insufficient credits|never purchased credits|payment required/i.test(msg)) return true;
  return false;
}

function normalizeJsonText(text) {
  return String(text)
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'");
}

function parseJsonFromText(text) {
  const cleaned = normalizeJsonText(text)
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON object in model output');
    return JSON.parse(normalizeJsonText(m[0]));
  }
}

function safeParse(text) {
  try {
    return parseJsonFromText(text);
  } catch {
    return null;
  }
}

function num(x, fallback = NaN) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function extractAssignmentsArray(parsed) {
  if (!parsed || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.assignments)) return parsed.assignments;
  if (Array.isArray(parsed.data?.assignments)) return parsed.data.assignments;
  if (Array.isArray(parsed.results)) return parsed.results;
  if (Array.isArray(parsed.tasks)) return parsed.tasks;
  return [];
}

function normalizeBatchAssignments(chunk, parsed) {
  const raw = extractAssignmentsArray(parsed);
  const nameToIdx = new Map();
  for (const c of chunk) {
    const key = String(c.name || '').trim().toLowerCase();
    if (key && !nameToIdx.has(key)) nameToIdx.set(key, c.idx);
  }
  const byIdx = new Map();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    let idx = num(r.idx, NaN);
    if (!Number.isFinite(idx)) idx = num(r.taskIndex, NaN);
    if (!Number.isFinite(idx)) idx = num(r.index, NaN);
    if (!Number.isFinite(idx) && r.name) {
      const k = String(r.name).trim().toLowerCase();
      if (nameToIdx.has(k)) idx = nameToIdx.get(k);
    }
    if (!Number.isFinite(idx)) continue;

    let sn = num(r.stageNumber, NaN);
    if (!Number.isFinite(sn)) sn = num(r.stage, NaN);
    if (!Number.isFinite(sn)) sn = 3; // default: RTL Implementation
    sn = Math.min(11, Math.max(1, sn));

    byIdx.set(idx, { idx, stageNumber: sn });
  }
  return Array.from(byIdx.values());
}

function batchCoverageCount(chunk, normalized) {
  const got = new Set(normalized.map((a) => a.idx));
  return chunk.filter((c) => got.has(c.idx)).length;
}

async function ollamaApiPost(body) {
  const ms = Number(process.env.OLLAMA_TIMEOUT_MS || 3600000);
  try {
    const res = await axios.post(`${OLLAMA_URL}/api/chat`, body, {
      timeout: ms > 0 ? ms : 3600000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: { 'Content-Type': 'application/json' },
    });
    return res.data;
  } catch (err) {
    const detail =
      err.cause?.message ||
      err.code ||
      (typeof err.response?.data === 'string'
        ? err.response.data
        : JSON.stringify(err.response?.data || '')) ||
      err.message;
    throw new Error(`Ollama request failed: ${detail}`);
  }
}

async function callOllamaAssignments(userMsg) {
  const body = {
    model: OLLAMA_MODEL,
    stream: false,
    format: 'json',
    options: { temperature: 0.1, num_predict: 4096 },
    messages: [
      { role: 'system', content: RTL_SYSTEM_PROMPT },
      { role: 'user', content: userMsg },
    ],
  };
  const data = await ollamaApiPost(body);
  return data.message?.content || '';
}

async function callOpenRouterAssignments(userMsg) {
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_API_KEY required');
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: 'openrouter/auto',
      messages: [
        { role: 'system', content: RTL_SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.1,
    },
    {
      timeout: Number(process.env.OPENROUTER_TIMEOUT_MS || 600000),
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'RTL Workflow Analyzer',
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data.choices[0].message.content;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function assigneeDisplayFromTask(t) {
  if (!Array.isArray(t.assignees) || t.assignees.length === 0) return '';
  return t.assignees
    .map((a) => (typeof a === 'string' ? a : a?.username || a?.name || ''))
    .filter(Boolean)
    .join(', ');
}

/** Keyword-based stage guess for a task — RTL specific. */
function simplifyTaskForLLM(task, idx) {
  const text = `${task.name || ''} ${task.description || ''}`.toLowerCase();

  let suggestedStage = 3; // default: RTL Implementation

  if (/\b(spec|requirement|initial|scope)\b/.test(text)) suggestedStage = 1;
  else if (/\b(block\s*diagram|architecture|block|hierarchy)\b/.test(text)) suggestedStage = 2;
  else if (/\b(rtl|verilog|systemverilog|\bsv\b|hdl|module|logic)\b/.test(text)) suggestedStage = 3;
  else if (/\b(test\s*case|testbench|\btb\b|testplan|test\s*plan|test\s*vector)\b/.test(text)) suggestedStage = 4;
  else if (/\b(lint|cdc|clock\s*domain|rule\s*check|structural)\b/.test(text)) suggestedStage = 5;
  else if (/\b(regression|corner|sim|simulation)\b/.test(text)) suggestedStage = 6;
  else if (/\b(coverage|toggle|branch|statement)\b/.test(text)) suggestedStage = 7;
  else if (/\b(constraint|upf|sdc|power\s*intent|cpf)\b/.test(text)) suggestedStage = 8;
  else if (/\b(doc|documentation|write|report|readme)\b/.test(text)) suggestedStage = 9;
  else if (/\b(release|floor\s*plan|pd|physical|handoff|tapeout)\b/.test(text)) suggestedStage = 10;
  else if (/\b(sdf|nlp|back\s*annotation|timing\s*sim|post\s*synthesis)\b/.test(text)) suggestedStage = 11;

  const first = Array.isArray(task.assignees) && task.assignees.length > 0 ? task.assignees[0] : null;
  const assigneeStr =
    !first ? 'Unassigned' : typeof first === 'string' ? first : first.username || first.name || 'Unassigned';

  return {
    idx,
    name: String(task.name || '').slice(0, 100),
    description: String(task.description || '').slice(0, 300),
    comments: (task.comments || []).map((c) => c.text).join(' ').slice(0, 300),
    assignee: assigneeStr,
    suggested: suggestedStage,
  };
}

// ─── Output Builder ──────────────────────────────────────────────────────────

function buildFinalOutput(slim, assignments) {
  const byIdx = new Map();
  for (const a of assignments) {
    if (!a) continue;
    const idx = num(a.idx, NaN);
    if (Number.isFinite(idx)) byIdx.set(idx, { ...a, idx, stageNumber: num(a.stageNumber, 3) });
  }

  const byStage = Array.from({ length: 11 }, () => []);
  for (let idx = 0; idx < slim.length; idx++) {
    const t = slim[idx];
    const a = byIdx.get(idx);
    const sn = a ? Math.min(11, Math.max(1, num(a.stageNumber, 3))) : 3;
    const assignee = assigneeDisplayFromTask(t) || 'Unassigned';

    byStage[sn - 1].push({ 
      id: t.id || `idx-${idx}`, 
      name: t.name, 
      owner: assignee, 
      description: (t.description || '').trim()
    });
  }

  const stageRows = RTL_STAGE_NAMES.map((stageName, i) => ({
    stageNumber: i + 1,
    stageName,
    status: 'upcoming',
    taskCount: byStage[i].length,
    tasks: byStage[i],
  }));

  const counts = stageRows.map((s) => s.taskCount);
  const hasAny = counts.some((c) => c > 0);

  if (!hasAny) {
    return {
      currentPosition: {
        stageNumber: 1,
        stageName: RTL_STAGE_NAMES[0],
        summary: 'No RTL tasks found in extract.',
      },
      stages: stageRows.map((s) => ({ ...s, status: 'upcoming' })),
      blockers: [],
      nextStep: 'No tasks to analyze.',
    };
  }

  const stages = stageRows.map((s) => ({
    ...s,
    status: s.taskCount > 0 ? 'active' : 'upcoming',
  }));

  const activeIdx = counts.reduce((best, c, i) => (c > counts[best] ? i : best), 0);
  return {
    currentPosition: {
      stageNumber: activeIdx + 1,
      stageName: RTL_STAGE_NAMES[activeIdx],
      summary: `Currently focused on stage ${activeIdx + 1} with ${counts[activeIdx]} active task${
        counts[activeIdx] !== 1 ? 's' : ''
      }.`,
    },
    stages,
    blockers: [],
    nextStep: `Complete tasks in "${RTL_STAGE_NAMES[activeIdx]}" and prepare for downstream stages.`,
  };
}

function commentsForUiFromExtract(comments) {
  if (!Array.isArray(comments)) return [];
  return comments.map((c) => ({
    text: c.text || c.comment || '',
    author: c.author || c.commentBy || 'Unknown',
    date: Number(c.date) || 0,
  }));
}

async function enrichRtlWrongTasksFromSlim(parsed, slim) {
  const byId = new Map(slim.map((t) => [String(t.id), t]));
  for (const stage of parsed.stages) {
    for (const task of stage.tasks) {
      const src = byId.get(String(task.id));
      if (!src) continue;
      const commentsUi = commentsForUiFromExtract(src.comments);
      task.comments = commentsUi;
      task.blockerReason = await inferWrongViewDelayReason(
        { ...src, comments: commentsUi, description: src.description || task.description },
        { team: 'rtl' }
      );
      task.plannedStartDate = src.plannedStartDate;
      task.plannedDueDate = src.plannedDueDate;
      task.actualStartDate = src.actualStartDate;
      task.actualCompletionDate = src.actualCompletionDate;
      task.startDate = src.startDate;
      task.dueDate = src.dueDate;
      task.dateDone = src.actualCompletionDate;
      task.delayedLabel = 'Yes';
      task.delayDetails = 'Yes';
      task.delayDuration = src.delayDurationDays ?? null;
      task.projectName = src.listName;
      task.raw = src;
    }
  }
  parsed.mode = 'completed-delayed';
  return parsed;
}

// ─── Batch Processing ────────────────────────────────────────────────────────

async function mapTasksWithOllamaBatches(slim) {
  const batchSize = Math.max(5, Math.min(15, parseInt(process.env.RTL_OLLAMA_BATCH_SIZE || '10', 10)));
  const simplified = slim.map((t, idx) => simplifyTaskForLLM(t, idx));
  const chunks = chunkArray(simplified, batchSize);
  const allAssignments = [];

  console.log(
    `\n📊 Processing ${slim.length} tasks in ${chunks.length} batch${chunks.length !== 1 ? 'es' : ''} (${batchSize} tasks/batch)...`
  );

  for (let bi = 0; bi < chunks.length; bi++) {
    const chunk = chunks[bi];

    const taskList = chunk
      .map((t) => `idx:${t.idx} name:"${t.name}" desc:"${t.description}"`)
      .join('\n');

    const userMsg = `Map these RTL tasks to stages 1-11 based on their name and description. Return JSON format: {"assignments":[{"idx":NUMBER,"stage":NUMBER}]}\n\nTasks:\n${taskList}`;

    const progress = new ProgressDisplay();
    progress.start(`Batch ${bi + 1}/${chunks.length}: Processing ${chunk.length} tasks...`);

    let normalized = [];
    let bestCoverage = 0;
    let bestNormalized = [];

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const lastText = await callOllamaAssignments(userMsg);
        progress.update(`Batch ${bi + 1}/${chunks.length}: Parsing response...`);

        const parsed = safeParse(lastText);
        normalized = normalizeBatchAssignments(chunk, parsed);
        const cov = batchCoverageCount(chunk, normalized);

        if (cov > bestCoverage) {
          bestCoverage = cov;
          bestNormalized = normalized;
        }

        if (cov === chunk.length) {
          progress.stop(`Batch ${bi + 1}/${chunks.length}: ✓ Mapped ${cov}/${chunk.length} tasks`);
          break;
        }

        if (attempt < 2) {
          progress.update(`Batch ${bi + 1}/${chunks.length}: Retry ${attempt + 2}/3 (got ${cov}/${chunk.length})...`);
        }
      } catch (err) {
        progress.update(`Batch ${bi + 1}/${chunks.length}: Error on attempt ${attempt + 1}/3...`);
      }
    }

    if (bestCoverage > 0 && bestCoverage < chunk.length) {
      normalized = bestNormalized;
      progress.stop(
        `Batch ${bi + 1}/${chunks.length}: ⚠ Mapped ${bestCoverage}/${chunk.length} tasks (${chunk.length - bestCoverage} use fallback)`,
        '⚠'
      );
      const got = new Set(normalized.map((a) => a.idx));
      for (const t of chunk) {
        if (!got.has(t.idx)) {
          normalized.push({ idx: t.idx, stageNumber: t.suggested });
        }
      }
    } else if (bestCoverage === 0) {
      progress.stop(`Batch ${bi + 1}/${chunks.length}: ⚠ No valid JSON, using keyword fallback`, '⚠');
      for (const t of chunk) {
        normalized.push({ idx: t.idx, stageNumber: t.suggested });
      }
    }

    allAssignments.push(...normalized);
    printProgressBar(bi + 1, chunks.length, 'Overall');
  }

  console.log();
  return buildFinalOutput(slim, allAssignments);
}

async function mapTasksWithOpenRouterBatches(slim) {
  const batchSize = Math.max(10, Math.min(25, parseInt(process.env.RTL_OLLAMA_BATCH_SIZE || '20', 10)));
  const simplified = slim.map((t, idx) => simplifyTaskForLLM(t, idx));
  const chunks = chunkArray(simplified, batchSize);
  const allAssignments = [];

  console.log(`\n📊 Processing ${slim.length} tasks in ${chunks.length} batch${chunks.length !== 1 ? 'es' : ''} via OpenRouter...`);

  for (let bi = 0; bi < chunks.length; bi++) {
    const chunk = chunks[bi];
    const taskList = chunk.map(t => 
      `idx:${t.idx} name:"${t.name}" desc:"${t.description}"`
    ).join('\n');
    
    const userMsg = `Map these tasks to workflow stages 1-11 based on their name and description. Return JSON format: {"assignments":[{"idx":NUMBER,"stage":NUMBER}]}\n\nTasks:\n${taskList}`;
    
    const progress = new ProgressDisplay();
    progress.start(`Batch ${bi + 1}/${chunks.length}: Processing ${chunk.length} tasks...`);

    try {
      const lastText = await callOpenRouterAssignments(userMsg);
      const parsed = safeParse(lastText);
      const normalized = normalizeBatchAssignments(chunk, parsed);
      const cov = batchCoverageCount(chunk, normalized);
      progress.stop(`Batch ${bi + 1}/${chunks.length}: ✓ Mapped ${cov}/${chunk.length} tasks`);
      allAssignments.push(...normalized);
    } catch (err) {
      progress.stop(`Batch ${bi + 1}/${chunks.length}: ✗ Failed - ${err.message}`, '✗');
      throw err;
    }

    printProgressBar(bi + 1, chunks.length, 'Overall');
  }

  console.log();
  return buildFinalOutput(slim, allAssignments);
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateRtlWorkflowOutput(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const cp = obj.currentPosition;
  if (!cp || typeof cp.stageNumber !== 'number' || cp.stageNumber < 1 || cp.stageNumber > 11) return false;
  if (typeof cp.stageName !== 'string' || typeof cp.summary !== 'string') return false;
  const stages = obj.stages;
  if (!Array.isArray(stages) || stages.length !== 11) return false;
  const seen = new Set();
  for (const s of stages) {
    if (!s || typeof s.stageNumber !== 'number') return false;
    seen.add(s.stageNumber);
    if (!['completed', 'active', 'upcoming', 'blocked'].includes(s.status)) return false;
    if (typeof s.taskCount !== 'number' || !Array.isArray(s.tasks)) return false;
  }
  for (let n = 1; n <= 11; n++) {
    if (!seen.has(n)) return false;
  }
  if (!Array.isArray(obj.blockers)) return false;
  if (typeof obj.nextStep !== 'string') return false;
  return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function analyzeProject(project, kind = 'current') {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  📁 ${kind === 'wrong' ? 'WRONG · ' : ''}Project: ${project.tasksFile}`);
  console.log(`  📤 Output:  ${project.outputFile}`);
  console.log(`${'='.repeat(70)}`);

  if (!fs.existsSync(project.tasksFile)) {
    console.warn(`⚠️  Skip — file not found: ${project.tasksFile}`);
    console.warn(
      kind === 'wrong'
        ? `   Run: node extract_rtl_wrong_folder_tasks.js`
        : `   Run: node extract_rtl_folder_tasks.js`
    );
    return;
  }

  const raw = JSON.parse(fs.readFileSync(resolveInputFile(project.tasksFile), 'utf-8'));
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];

  console.log(`📋 Loaded ${tasks.length} task${tasks.length !== 1 ? 's' : ''}`);

  const useOllama = !USE_OPENROUTER_FIRST;
  console.log(`🤖 Backend: ${useOllama ? `Ollama (${OLLAMA_MODEL})` : 'OpenRouter'}`);

  let parsed;
  if (tasks.length === 0) {
    parsed = buildFinalOutput([], []);
    console.log('⚠️  No tasks to process');
  } else if (useOllama) {
    parsed = await mapTasksWithOllamaBatches(tasks);
  } else {
    try {
      parsed = await mapTasksWithOpenRouterBatches(tasks);
    } catch (err) {
      if (isOpenRouterCreditsError(err)) {
        const ok = await ollamaReachable();
        if (ok) {
          console.warn('\n⚠️  OpenRouter credits error — falling back to Ollama...\n');
          parsed = await mapTasksWithOllamaBatches(tasks);
        } else {
          console.error('\n❌ OpenRouter has no credits and Ollama is not reachable.\n');
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  if (kind === 'wrong') {
    console.log('\n🧩 Enriching wrong-view tasks (delay reasons + dates)…');
    await enrichRtlWrongTasksFromSlim(parsed, tasks);
  }

  if (!validateRtlWorkflowOutput(parsed)) {
    console.error('❌ Output validation failed.');
    return;
  }

  fs.mkdirSync(path.dirname(project.outputFile), { recursive: true });
  fs.writeFileSync(project.outputFile, JSON.stringify(parsed, null, 2));
  console.log(`\n✓ Saved ${project.outputFile}`);

  const pub = `./dashboard/public/${path.basename(project.outputFile)}`;
  try {
    fs.mkdirSync('./dashboard/public', { recursive: true });
    fs.copyFileSync(project.outputFile, pub);
    console.log(`✓ Copied to ${pub}`);
  } catch (err) {
    console.warn(`⚠️  Could not copy to dashboard/public: ${err.message}`);
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Current Stage: ${parsed.currentPosition.stageNumber} - ${parsed.currentPosition.stageName}`);
  console.log(`   Total Tasks: ${tasks.length}`);

  console.log(`\n   Stage Distribution:`);
  parsed.stages.forEach((s) => {
    if (s.taskCount > 0) {
      const bar = '█'.repeat(Math.min(20, Math.round(s.taskCount / 2)));
      console.log(`   ${s.stageNumber.toString().padStart(2)}. ${s.taskCount.toString().padStart(3)} tasks ${bar}`);
    }
  });
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         RTL Workflow Analyzer - 11-Stage RTL Pipeline             ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  if (USE_OPENROUTER_FIRST) {
    if (!OPENROUTER_KEY) {
      console.error('\n❌ RTL_USE_OPENROUTER is set but OPENROUTER_API_KEY is missing.');
      process.exit(1);
    }
    console.log('\n🌐 Using OpenRouter (cloud-based LLM)');
  } else {
    const ok = await ollamaReachable();
    if (!ok) {
      console.error(
        `\n❌ Ollama not reachable at ${OLLAMA_URL}\n` +
          '   Start Ollama: `ollama serve` or open Ollama app\n' +
          '   Or use cloud: RTL_USE_OPENROUTER=1 OPENROUTER_API_KEY=... node analyze_rtl_workflow.js'
      );
      process.exit(1);
    }
    console.log(`\n✓ Ollama reachable at ${OLLAMA_URL} (model: ${OLLAMA_MODEL})`);
  }

  for (const project of CURRENT_PROJECTS) {
    try {
      await analyzeProject(project, 'current');
    } catch (err) {
      console.error(
        `\n❌ Error processing ${project.tasksFile}:`,
        err.response?.data || err.cause?.message || err.message
      );
    }
  }

  console.log(`\n${'='.repeat(70)}\n  RTL “What went wrong” (completed + delayed)\n${'='.repeat(70)}`);
  for (const project of WRONG_PROJECTS) {
    try {
      await analyzeProject(project, 'wrong');
    } catch (err) {
      console.error(
        `\n❌ Error processing ${project.tasksFile}:`,
        err.response?.data || err.cause?.message || err.message
      );
    }
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('  ✓ RTL workflow analysis complete (current + wrong)');
  console.log(`${'='.repeat(70)}\n`);
}

main();
