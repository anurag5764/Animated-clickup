import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
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

const NEUTRAL_DELAY_REASON =
  'No clear delay explanation in the comment thread; the task is marked delayed in ClickUp.';

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

(2) DELAY EXPLANATION (blockerReason) — 1–3 sentences, professional tone.
    • Primary evidence: COMMENT THREAD. Secondary: title and description. You may mention Delayed=yes / delay duration only as supporting context.
    • COMMENT ATTRIBUTION: Each line is formatted as "DATE — AUTHOR: text". The AUTHOR is the person who WROTE that comment. If the comment body @-mentions someone else, that person was tagged/notified — they are NOT necessarily the author. Never write "Alice said …" unless Alice is the author of that comment; if Bob wrote "@Alice please update", say "Bob asked Alice for an update" (or similar).
    • If comments do not contain a clear explanation of the delay (no blockers, dates, dependencies, or substantive discussion), use this exact neutral phrasing for blockerReason: "No clear delay explanation in the comment thread; the task is marked delayed in ClickUp." Do not invent people, meetings, or causes.

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

Respond with ONLY raw JSON. No markdown or backticks:
{"stage":4,"stageName":"Circuit Implementation and Sim","confidence":0.82,"reasoning":"one sentence tying name/description/comments to this stage","blockerType":"technical","blockerReason":"1–3 sentences, or the neutral sentence if comments lack substance","isBlocker":true}`;

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
          blockerReason: 'Classification failed after retries'
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
    blockerReason: classification.blockerReason || '',
  };
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeReason(reason) {
  const clean = normalizeText(reason)
    .replace(/^from comments:\s*/i, '')
    .replace(/^from task details:\s*/i, '');
  if (!clean) return '';
  if (NON_REASON_VALUES.has(clean.toLowerCase())) return '';
  return clean;
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
    return informed
      .map((c) => {
        const clip = c.text.length > 220 ? `${c.text.slice(0, 217)}…` : c.text;
        return `${c.author} wrote: ${clip}`;
      })
      .join(' ');
  }

  return NEUTRAL_DELAY_REASON;
}

function isNeutralDelayReasonPhrase(text) {
  return normalizeText(text).toLowerCase().includes('no clear delay explanation in the comment thread');
}

/** Accept model delay text unless it is empty, generic, or clearly disconnected from task + comments. */
function isDelayReasonPlausible(reason, task) {
  const clean = sanitizeReason(reason);
  if (!clean) return false;
  if (isNeutralDelayReasonPhrase(clean)) return true;
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
  const candidate = sanitizeReason(classification.blockerReason);
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

  const tasks = JSON.parse(fs.readFileSync('ams_tasks.json', 'utf-8'));
  const delayedTasks = tasks.filter(isDelayedTask);
  console.log(`🧪 Delayed tasks to classify: ${delayedTasks.length}/${tasks.length}`);

  // Resume from checkpoint if exists
  let classified = [];
  let startFrom = 0;
  if (fs.existsSync('ams_classified_checkpoint.json')) {
    const checkpoint = JSON.parse(fs.readFileSync('ams_classified_checkpoint.json', 'utf-8'));
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
      fs.writeFileSync('ams_classified_checkpoint.json', JSON.stringify(classified, null, 2));
      console.log(`  💾 Checkpoint saved (${i + 1}/${delayedTasks.length})\n`);
    }

    // No sleep needed — local model, no rate limits
  }

  return classified;
}

classifyAllTasks().then(classified => {
  fs.writeFileSync('ams_classified.json', JSON.stringify(classified, null, 2));
  const analysisPayload = buildAnalysisPayload(classified, JSON.parse(fs.readFileSync('ams_tasks.json', 'utf-8')).length);
  fs.writeFileSync('ams_blocker_analysis.json', JSON.stringify(analysisPayload, null, 2));
  console.log('\n🎉 Classification complete!');
  console.log('💾 Saved ams_classified.json and ams_blocker_analysis.json');

  const byStage = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  classified.forEach((t) => {
    const s = t.classification?.stage;
    if (s >= 1 && s <= 6) byStage[s].push(t);
  });

  console.log('\n📊 Tasks per stage:');
  PIPELINE_STAGES.forEach(s => {
    const st = byStage[s.id];
    const l = st.filter(t => parseLnoFromName(t.name).tier === 'L').length;
    const n = st.filter(t => parseLnoFromName(t.name).tier === 'N').length;
    const o = st.filter(t => parseLnoFromName(t.name).tier === 'O').length;
    console.log(`  Stage ${s.id} — ${s.name}: ${st.length} delayed tasks (L:${l} N:${n} O:${o})`);
  });

  console.log('\n👥 Per member breakdown:');
  const ms = {};
  classified.forEach(t => {
    t.assignees.forEach(a => {
      if (!ms[a.username]) ms[a.username] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
      const s = t.classification?.stage;
      if (s >= 1 && s <= 6) ms[a.username][s]++;
    });
  });
  Object.entries(ms)
    .sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0))
    .forEach(([name, stages]) => {
      console.log(`  ${name}: ${Object.entries(stages).map(([s, c]) => `S${s}:${c}`).join(' ')}`);
    });
}).catch(console.error);