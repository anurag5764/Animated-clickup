import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseLnoFromName } from './lno.js';

const PIPELINE_STAGES = [
  {
    id: 1,
    name: 'Initial Module Spec',
    description:
      'Requirements/spec docs, architecture definition, interface/config register planning, feature definition, design notes and review docs before heavy analysis or implementation',
  },
  {
    id: 2,
    name: 'Mathematical Modeling',
    description:
      'Equation-level and theory-level work: derivations, transfer-function analysis, control/loop math, hand calculations, feasibility modeling without implementation/schematic ownership',
  },
  {
    id: 3,
    name: 'Mathematical Sim in Python',
    description:
      'Behavioral/algorithm simulation in Python/Matlab-style code, numerical experiments, scripts/notebooks for verification at model level (not transistor/schematic signoff)',
  },
  {
    id: 4,
    name: 'Circuit Implementation and Sim',
    description:
      'Schematic/transistor-level design and simulation in Cadence/SPICE/LTspice, implementation/debug of analog blocks, pre-layout circuit verification (before physical layout)',
  },
  {
    id: 5,
    name: 'Layout',
    description:
      'Physical layout work: floorplan, placement, routing, polygon editing, GDS/stream-out, layout DRC/LVS at the layout database level — not parasitic extraction or post-layout simulation',
  },
  {
    id: 6,
    name: 'Post Layout Sim',
    description:
      'After layout: parasitic extraction (PEX/RCX/DSPF), post-layout simulation, parasitic-aware SPICE, corner/correlation vs pre-layout, post-layout signoff and tapeout readiness',
  },
];

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const BLOCKER_TYPES = ['dependency', 'technical', 'review', 'resource', 'requirement', 'unknown'];
const NON_REASON_VALUES = new Set(['', 'none', 'n/a', 'na', 'null', 'unknown', '-', '--']);

/** When comments lack a usable delay narrative — keep in sync with prompt + isNeutralDelayReasonPhrase */
const NEUTRAL_DELAY_REASON = `Delay Reason @pm:

1. Summary:
No valid delay reason found from comments.

2. Technical:
No work-related delay cause could be inferred from the comment thread.`;

function sanitizeDelayReason(reason) {
  let s = String(reason || '').trim();
  if (!s) return '';
  s = s
    .replace(/^from comments:\s*/gim, '')
    .replace(/^from task details:\s*/gim, '')
    .trim();
  s = s
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!s) return '';
  const flatOneLine = s.replace(/\s+/g, ' ').toLowerCase();
  if (NON_REASON_VALUES.has(flatOneLine)) return '';
  return s;
}

function hasDelayReasonPmFormat(text) {
  const t = String(text || '').toLowerCase();
  return t.includes('delay reason @pm') && t.includes('summary') && t.includes('technical');
}

function canResumeFromCheckpoint(tasks, checkpoint) {
  if (!Array.isArray(checkpoint) || checkpoint.length === 0) return false;
  if (checkpoint.length > tasks.length) return false;

  for (let i = 0; i < checkpoint.length; i++) {
    if (!checkpoint[i]?.id || checkpoint[i].id !== tasks[i]?.id) {
      return false;
    }
  }
  return true;
}

async function classifyTask(task) {
  const commentThread = formatCommentThreadForPrompt(task);
  const subtaskNames = (task.subtasks || [])
    .slice(0, 5)
    .map((s) => s.name || s.id || '')
    .filter(Boolean)
    .join(', ');

  const prompt = `You assist an Analog/Mixed-Signal (AMS) IC design team. This task is marked DELAYED in ClickUp.

Two jobs only (ignore L/N/O priority tags in the task name):

(1) PIPELINE STAGE — choose exactly ONE stage ID 1–6 and the matching stageName from the list. Use ALL of: task NAME, DESCRIPTION, and COMMENT thread. Do NOT default everything to stage 4 — only use stage 4 when the work is clearly schematic/transistor/circuit-level Cadence/SPICE-type implementation or pre-layout circuit simulation.

(2) DELAY ANALYSIS (blockerReason) — You are an expert project analyst. Your job is to analyze the ClickUp COMMENT THREAD and extract the REAL delay reason.

STRICT INSTRUCTIONS:
1. NEVER copy comments verbatim (no pasted comment text, no "NAME wrote:" followed by full quotes).
2. NEVER output phrases like "verbatim excerpts", "grounded fallback", "fallback", or raw logs.
3. ALWAYS summarize and interpret the comments in your own words.
4. If multiple comments conflict: ignore statements like "not my delay", denial, or blame shifting. Prioritize comments that describe actual work, blockers, dependencies, or scope changes.
5. Extract ONLY the most relevant delay cause.
6. Convert messy comments into one clean explanation.
7. Read ALL comments; when newer comments update older ones, prefer the newer narrative. Ignore greetings and off-topic chat.
8. Evidence: use COMMENT THREAD first; task title/description only as supporting context. Do not invent causes, people, or meetings not in the thread.
9. COMMENT LINES look like "[N] DATE — written by AUTHOR: text". Use AUTHOR only to understand viewpoint — do not echo the line verbatim.

OUTPUT FORMAT (MANDATORY) — blockerReason must be EXACTLY this shape (same headings and numbering; line breaks as shown):

Delay Reason @pm:

1. Summary:
<Clear, simple, non-technical reason; max 2 short lines.>

2. Technical:
<One explanation of the actual root cause: dependency, technical issue, review, ECO, resource, requirement gap, tool flow, etc. Combine all relevant inputs into one coherent paragraph — interpreted, not quoted.>

If there is NO real delay reason (nothing substantive about blockers, dependencies, slips, reviews, timeline, or work scope in the comments), use this EXACT blockerReason:

Delay Reason @pm:

1. Summary:
No valid delay reason found from comments.

2. Technical:
No work-related delay cause could be inferred from the comment thread.

Stage list (IDs must match):
${PIPELINE_STAGES.map((s) => `${s.id}. ${s.name}: ${s.description}`).join('\n')}

Task:
- Name: ${task.name}
- Status: ${task.status}
- Description: ${normalizeText(task.description || '').slice(0, 900)}
- Tags: ${(task.tags || []).join(', ') || 'none'}
- Subtasks: ${subtaskNames || 'none'}
- Delayed field: ${task.delayedFlag || 'unknown'}
- Delay duration (days): ${task.delayDurationDays ?? 'unknown'}

Comment thread (newest first; AUTHOR = writer of that line):
${commentThread}

Stage decision order (first strong match wins; Layout and Post Layout Sim are DIFFERENT):
6) Post-layout parasitic extraction, PEX/RCX/DSPF, post-layout simulation, parasitic-aware SPICE, post-layout corners/correlation, tapeout signoff after layout → Stage 6 Post Layout Sim
5) Physical layout: floorplan, placement, routing, polygons, GDS, layout DRC/LVS on the layout cell (not post-layout extracted sim) → Stage 5 Layout
4) Schematic/transistor-level design, Cadence/SPECTRE/HSPICE/LTspice, pre-layout block simulation, circuit debug before layout → Stage 4 Circuit Implementation and Sim
3) Python/Jupyter/notebook behavioral or algorithmic simulation (not transistor signoff) → Stage 3 Mathematical Sim in Python
2) Equations, derivations, transfer functions, hand analysis without Python implementation focus → Stage 2 Mathematical Modeling
1) Specs, documentation, architecture, register/config planning, design docs → Stage 1 Initial Module Spec

Tie-breakers:
- "simulation" alone is ambiguous: Python/notebook → 3; Cadence/SPICE/schematic → 4; post-layout/PEX/parasitic/extracted netlist → 6.
- Documentation or "doc" tasks with no circuit/layout/sim work → 1.
- Stage 2 only for real theory/math, not Python coding.

blockerType: dependency | technical | review | resource | requirement | unknown
isBlocker: true if there is a concrete delay narrative (including the neutral "no clear explanation" case, since Delayed=yes); false only if inappropriate.

Respond with ONLY raw JSON. No markdown or backticks. blockerReason must be a single JSON string; use \\n for newlines inside blockerReason, e.g.:
{"stage":4,"stageName":"Circuit Implementation and Sim","confidence":0.82,"reasoning":"one sentence tying name/description/comments to this stage","blockerType":"technical","blockerReason":"Delay Reason @pm:\\n\\n1. Summary:\\n...\\n\\n2. Technical:\\n...","isBlocker":true}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.2',
          stream: false,
          format: 'json',
          options: { temperature: 0.1 },
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Ollama error ${response.status}: ${err}`);
      }

      const data = await response.json();
      const text = data.message.content.trim();
      const clean = text.replace(/```json|```/g, '').trim();

      // Primary: strict parse (json mode should return raw JSON)
      try {
        return JSON.parse(clean);
      } catch {
        // Fallback: extract JSON block if model adds extra text.
        const jsonMatch = clean.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found in response');
        return JSON.parse(jsonMatch[0]);
      }

    } catch (err) {
      if (attempt === 3) {
        console.error(`\n  ❌ Gave up on "${task.name.slice(0, 40)}": ${err.message}`);
        return {
          stage: 1,
          stageName: "Initial Module Spec",
          confidence: 0,
          reasoning: "Failed",
          isBlocker: false,
          blockerType: 'unknown',
          blockerReason: `Delay Reason @pm:

1. Summary:
Classification did not complete successfully.

2. Technical:
The delay classifier failed after retries; re-run classify.js or check the local LLM (Ollama) service.`,
        };
      }
      await sleep(1000 * attempt);
    }
  }
}

function normalizeClassification(classification = {}) {
  const stage = Number(classification.stage);
  const safeStage = stage >= 1 && stage <= 6 ? stage : 1;
  const stageName = PIPELINE_STAGES.find((s) => s.id === safeStage)?.name || 'Initial Module Spec';

  const confidenceNum = Number(classification.confidence);
  const confidence = Number.isFinite(confidenceNum) ? Math.min(1, Math.max(0, confidenceNum)) : 0.5;

  const blockerType = BLOCKER_TYPES.includes(String(classification.blockerType).toLowerCase())
    ? String(classification.blockerType).toLowerCase()
    : 'unknown';

  return {
    stage: safeStage,
    stageName,
    confidence,
    reasoning: classification.reasoning || '',
    isBlocker: Boolean(classification.isBlocker),
    blockerType,
    blockerReason: sanitizeDelayReason(classification.blockerReason) || '',
  };
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatCommentThreadForPrompt(task) {
  const raw = Array.isArray(task.comments) ? task.comments : [];
  const enriched = raw
    .map((c) => ({
      author: c.author || c.commentBy || 'unknown',
      text: normalizeText(c.text || c.comment || ''),
      dateMs: Number(c.date) || 0,
    }))
    .filter((c) => c.text.length > 0)
    .sort((a, b) => b.dateMs - a.dateMs);

  const lines = enriched.slice(0, 18).map((c, idx) => {
    const when =
      c.dateMs > 0
        ? new Date(c.dateMs).toISOString().slice(0, 10)
        : 'unknown-date';
    const body = c.text.length > 420 ? `${c.text.slice(0, 417)}…` : c.text;
    return `  [${idx + 1}] ${when} — written by ${c.author}: ${body}`;
  });
  return lines.length ? lines.join('\n') : '  (no comments)';
}

function commentCorpus(task) {
  const texts = [];
  texts.push(normalizeText(task?.name));
  texts.push(normalizeText(task?.description));
  for (const c of Array.isArray(task?.comments) ? task.comments : []) {
    texts.push(normalizeText(c?.text || c?.comment));
  }
  return texts.filter(Boolean).join('\n').toLowerCase();
}

function reasonOverlapsComments(reason, task) {
  const r = normalizeText(reason).toLowerCase();
  if (r.length < 12) return false;
  for (const c of Array.isArray(task?.comments) ? task.comments : []) {
    const t = normalizeText(c?.text || c?.comment).toLowerCase().slice(0, 1400);
    if (t.length < 14) continue;
    const win = 28;
    const step = Math.max(4, Math.floor(t.length / 35));
    for (let i = 0; i + win <= t.length; i += step) {
      if (r.includes(t.slice(i, i + win))) return true;
    }
  }
  return false;
}

function buildEvidenceReason(task) {
  const comments = Array.isArray(task?.comments) ? task.comments : [];
  const withText = comments
    .map((c) => ({
      text: normalizeText(c?.text || c?.comment),
      author: c.author || c.commentBy || 'Unknown',
      date: Number(c?.date) || 0,
    }))
    .filter((c) => c.text.length > 12)
    .sort((a, b) => b.date - a.date);

  const delayLike =
    /\b(delay|delayed|blocked|block|waiting|wait|pending|stuck|slip|late|review|eco|fix|issue|hold|depend|resource|need|please|urgent)\b/i;
  const informed = withText.filter((c) => delayLike.test(c.text)).slice(0, 2);

  if (informed.length > 0) {
    const paraphraseSnippet = (raw) => {
      let s = normalizeText(raw).replace(/@\S+/g, '').replace(/\s+/g, ' ').trim();
      s = s.replace(/^(delay\s*reason\s*:\s*)/i, '').trim();
      const sentEnd = s.search(/[.!?](\s|$)/);
      let out =
        sentEnd > 24 && sentEnd < 320 ? s.slice(0, sentEnd + 1).trim() : s;
      if (out.length > 200) out = `${out.slice(0, 197)}…`;
      return out;
    };
    const parts = informed.map((c) => paraphraseSnippet(c.text)).filter(Boolean);
    const technical = parts.join(' ');
    return `Delay Reason @pm:

1. Summary:
Comments point to schedule impact from the factors summarized below.

2. Technical:
${technical}`;
  }

  return NEUTRAL_DELAY_REASON;
}

function isNeutralDelayReasonPhrase(text) {
  const t = normalizeText(text).toLowerCase();
  return (
    t.includes('no clear delay explanation in the comment thread') ||
    t.includes('no valid delay reason found from comments')
  );
}

/** Accept model delay text unless it is empty, generic, or clearly disconnected from task + comments. */
function isDelayReasonPlausible(reason, task) {
  const clean = sanitizeDelayReason(reason);
  if (!clean) return false;
  if (isNeutralDelayReasonPhrase(clean)) return true;
  if (hasDelayReasonPmFormat(clean) && clean.length >= 48) {
    if (reasonOverlapsComments(clean, task)) return true;
    const delayCue =
      /\b(wait|waiting|blocked|block|delay|delayed|slip|late|pending|review|dependency|resource|issue|bug|fix|eco|hold|stuck|api|infra|timeline|resched|pushed)\b/i.test(
        clean
      );
    if (clean.length >= 120 && delayCue) return true;
  }
  if (clean.length < 24) return false;
  const lower = clean.toLowerCase();
  if (NON_REASON_VALUES.has(lower)) return false;

  if (reasonOverlapsComments(clean, task)) return true;

  const corpus = commentCorpus(task);
  const tokens = lower
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => corpus.includes(t)).length;
  if (hits >= Math.max(2, Math.ceil(tokens.length * 0.12))) return true;

  const delayCue =
    /\b(wait|waiting|blocked|block|delay|delayed|slip|late|pending|review|dependency|resource|issue|bug|fix|eco|hold|stuck)\b/i.test(
      clean
    );
  if (clean.length >= 48 && delayCue) return true;

  return false;
}

function applyGroundedReason(task, classification) {
  const candidate = sanitizeDelayReason(classification.blockerReason);
  if (isDelayReasonPlausible(candidate, task)) {
    classification.blockerReason = candidate;
    return classification;
  }
  classification.blockerReason = buildEvidenceReason(task);
  return classification;
}

/** Keyword guard when the model collapses to stage 4; uses name, description, and comment text. */
function inferStageFromKeywords(task) {
  const parts = [
    normalizeText(task?.name),
    normalizeText(task?.description),
    ...(Array.isArray(task?.comments) ? task.comments.slice(0, 14) : []).map((c) =>
      normalizeText(c?.text || c?.comment)
    ),
  ];
  const blob = parts.join(' ').toLowerCase();
  const has = (re) => re.test(blob);

  if (
    has(/\b(post[\s-]*layout|postlayout)\b[\s\S]{0,80}\b(sim|simulation|pex|rcx|corner|corners|correlation|extraction)\b/) ||
    has(/\b(post[\s-]*layout\s+sim|parasitic[\s-]*sim|pex\b|rcx\b|dspf\b|extracted\s+netlist|calibre\s+pex|starrc|qrc\b|lpe\b)\b/) ||
    has(/\bpost[\s-]*layout\b.*\b(spectre|spice|hspice)\b/)
  ) {
    return 6;
  }

  if (
    has(/\b(layout|gds|floorplan|floor\s*plan|placement|routing|polygon|stream[\s-]*out)\b/) &&
    !has(/\bpython\b|\bjupyter\b|\bnumpy\b/) &&
    !has(/\b(post[\s-]*layout|postlayout)\b/) &&
    !has(/\b(pex\b|rcx\b|dspf\b|parasitic[\s-]*(sim|extraction))\b/)
  ) {
    return 5;
  }

  if (has(/\b(python|jupyter|notebook|numpy|scipy|matplotlib)\b/) && !has(/\b(cadence|spectre|hspice|ltspice|spice\s+deck)\b/)) {
    return 3;
  }

  if (
    has(/\b(equation|derivation|transfer\s+function|analytical|hand\s*calc|small[\s-]*signal)\b/) &&
    !has(/\bpython\b/)
  ) {
    return 2;
  }

  if (
    has(/\b(documentation|design\s+doc|specification|requirements|architecture|register\s+map)\b/) ||
    /\b(doc|spec)\b/i.test(task?.name || '')
  ) {
    if (!has(/\b(schematic|spectre|spice|layout|pex|post[\s-]*layout|cdl\b|simulation)\b/)) return 1;
  }

  return null;
}

function refineStageFromTaskContent(task, classification) {
  const hint = inferStageFromKeywords(task);
  let stage = Number(classification.stage);
  if (!Number.isFinite(stage) || stage < 1 || stage > 6) stage = 1;

  if (hint === 6 && (stage === 4 || stage === 5)) {
    stage = 6;
  } else if (stage === 4 && hint != null && hint !== 4) {
    stage = hint;
  } else if (stage === 5 && hint === 6) {
    stage = 6;
  }

  if (stage !== Number(classification.stage)) {
    classification.stage = stage;
    classification.stageName = PIPELINE_STAGES.find((s) => s.id === stage)?.name || classification.stageName;
  }
  return classification;
}

function isDelayedTask(task) {
  if (task.delayedFlag) return String(task.delayedFlag).toLowerCase() === 'yes';
  const delayedField = (task.customFields || []).find(
    (f) => String(f?.name || '').trim().toLowerCase() === 'delayed'
  );
  if (!delayedField) return false;
  const value = delayedField.value;
  const options = delayedField?.type_config?.options || [];
  const byOrder = options.find((opt) => Number(opt?.orderindex) === Number(value));
  const selected = String(byOrder?.name || '').toLowerCase();
  return selected === 'yes' || value === 0 || value === '0';
}

function buildAnalysisPayload(classifiedDelayedTasks, totalTasksCount) {
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

  classifiedDelayedTasks.forEach((task) => {
    const stage = Number(task.classification?.stage);
    const bucket = stageSummary[stage];
    if (!bucket) return;
    bucket.total += 1;
    bucket.delayed += 1;

    const { tier } = parseLnoFromName(task.name);
    if (tier === 'L') bucket.lnoLeverage += 1;
    else if (tier === 'N') bucket.lnoNeutral += 1;
    else if (tier === 'O') bucket.lnoOverhead += 1;
    else bucket.lnoUnparsed += 1;

    const type = task.classification?.blockerType || 'unknown';
    if (!Object.prototype.hasOwnProperty.call(blockerTypeBreakdown, type)) {
      blockerTypeBreakdown.unknown += 1;
    } else {
      blockerTypeBreakdown[type] += 1;
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'delayed-tasks-only',
    totalTasks: totalTasksCount,
    delayedTasksClassified: classifiedDelayedTasks.length,
    stageSummary: Object.values(stageSummary),
    blockerTypeBreakdown,
    tasks: classifiedDelayedTasks,
  };
}

async function classifyAllTasks() {
  const amsDir = path.join('data', 'ams');
  const amsTasksPath = path.join(amsDir, 'ams_tasks.json');
  const checkpointPath = path.join(amsDir, 'ams_classified_checkpoint.json');

  // Check Ollama is running
  try {
    const ping = await fetch('http://localhost:11434/api/tags');
    const models = await ping.json();
    const available = models.models.map(m => m.name).join(', ');
    console.log(`✅ Ollama running. Available models: ${available}\n`);
  } catch {
    console.error('❌ Ollama not running! Start it with: ollama serve');
    process.exit(1);
  }

  const tasks = JSON.parse(
    fs.readFileSync(fs.existsSync(amsTasksPath) ? amsTasksPath : 'ams_tasks.json', 'utf-8')
  );
  const delayedTasks = tasks.filter(isDelayedTask);
  console.log(`🧪 Delayed tasks to classify: ${delayedTasks.length}/${tasks.length}`);

  // Resume from checkpoint if exists
  let classified = [];
  let startFrom = 0;
  if (fs.existsSync(checkpointPath) || fs.existsSync('ams_classified_checkpoint.json')) {
    const checkpoint = JSON.parse(
      fs.readFileSync(fs.existsSync(checkpointPath) ? checkpointPath : 'ams_classified_checkpoint.json', 'utf-8')
    );
    if (canResumeFromCheckpoint(delayedTasks, checkpoint)) {
      classified = checkpoint;
      startFrom = Math.min(classified.length, delayedTasks.length);
      console.log(`⏩ Resuming from checkpoint — ${startFrom}/${delayedTasks.length} delayed tasks already done`);
    } else {
      console.log('⚠️ Checkpoint does not match current ams_tasks.json order/content. Starting fresh classification.');
    }
  }
  console.log(`📂 ${delayedTasks.length - startFrom} delayed tasks remaining\n`);

  for (let i = startFrom; i < delayedTasks.length; i++) {
    const task = delayedTasks[i];
    process.stdout.write(`  [${i + 1}/${delayedTasks.length}] "${task.name.slice(0, 50)}"...`);

    let classification = normalizeClassification(await classifyTask(task));
    classification = refineStageFromTaskContent(task, classification);
    classification = applyGroundedReason(task, classification);
    classified.push({ ...task, classification });

    process.stdout.write(` → Stage ${classification.stage} (${(classification.confidence * 100).toFixed(0)}%)\n`);

    if ((i + 1) % 50 === 0) {
      fs.mkdirSync(amsDir, { recursive: true });
      fs.writeFileSync(checkpointPath, JSON.stringify(classified, null, 2));
      console.log(`  💾 Checkpoint saved (${i + 1}/${delayedTasks.length})\n`);
    }

    // No sleep needed — local model, no rate limits
  }

  return classified;
}

const __filename = fileURLToPath(import.meta.url);
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

export {
  PIPELINE_STAGES,
  classifyTask,
  normalizeClassification,
  refineStageFromTaskContent,
  applyGroundedReason,
  buildEvidenceReason,
  isDelayedTask,
  inferStageFromKeywords,
  buildAnalysisPayload,
  NEUTRAL_DELAY_REASON,
};

if (isMain) {
  classifyAllTasks()
    .then((classified) => {
      const amsDir = path.join('data', 'ams');
      const amsTasksPath = path.join(amsDir, 'ams_tasks.json');
      fs.mkdirSync(amsDir, { recursive: true });
      fs.writeFileSync(path.join(amsDir, 'ams_classified.json'), JSON.stringify(classified, null, 2));
      const analysisPayload = buildAnalysisPayload(
        classified,
        JSON.parse(fs.readFileSync(fs.existsSync(amsTasksPath) ? amsTasksPath : 'ams_tasks.json', 'utf-8')).length
      );
      fs.writeFileSync(path.join(amsDir, 'ams_blocker_analysis.json'), JSON.stringify(analysisPayload, null, 2));
      console.log('\n🎉 Classification complete!');
      console.log('💾 Saved data/ams/ams_classified.json and data/ams/ams_blocker_analysis.json');

      const byStage = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      classified.forEach((t) => {
        const s = t.classification?.stage;
        if (s >= 1 && s <= 6) byStage[s].push(t);
      });

      console.log('\n📊 Tasks per stage:');
      PIPELINE_STAGES.forEach((s) => {
        const st = byStage[s.id];
        const l = st.filter((t) => parseLnoFromName(t.name).tier === 'L').length;
        const n = st.filter((t) => parseLnoFromName(t.name).tier === 'N').length;
        const o = st.filter((t) => parseLnoFromName(t.name).tier === 'O').length;
        console.log(`  Stage ${s.id} — ${s.name}: ${st.length} delayed tasks (L:${l} N:${n} O:${o})`);
      });

      console.log('\n👥 Per member breakdown:');
      const ms = {};
      classified.forEach((t) => {
        t.assignees.forEach((a) => {
          if (!ms[a.username]) ms[a.username] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
          const s = t.classification?.stage;
          if (s >= 1 && s <= 6) ms[a.username][s]++;
        });
      });
      Object.entries(ms)
        .sort(
          (a, b) =>
            Object.values(b[1]).reduce((x, y) => x + y, 0) -
            Object.values(a[1]).reduce((x, y) => x + y, 0)
        )
        .forEach(([name, stages]) => {
          console.log(`  ${name}: ${Object.entries(stages).map(([s, c]) => `S${s}:${c}`).join(' ')}`);
        });
    })
    .catch(console.error);
}