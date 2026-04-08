import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';

const PIPELINE_STAGES = [
  { id: 1, name: "Initial Module Spec", description: "Defining requirements, specifications, system architecture, planning, documentation of module goals" },
  { id: 2, name: "Mathematical Modeling", description: "Mathematical analysis, equations, transfer functions, theoretical modeling, calculations, formulas, analytical work" },
  { id: 3, name: "Mathematical Sim in Python", description: "Python simulation, coding, scripting, numerical simulation, matplotlib, scipy, numpy, behavioral simulation" },
  { id: 4, name: "Circuit Implementation and Sim", description: "Schematic design, SPICE simulation, LTspice, Cadence, circuit implementation, netlist, transistor level, layout preparation" },
  { id: 5, name: "Layout + Post Layout Sim", description: "Physical layout, DRC, LVS, parasitic extraction, post-layout simulation, tapeout, GDS" }
];

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function classifyTask(task) {
  const prompt = `You are classifying engineering tasks for an Analog/Mixed-Signal (AMS) IC design team.

Classify this task into exactly ONE of these 5 pipeline stages:
${PIPELINE_STAGES.map(s => `${s.id}. ${s.name}: ${s.description}`).join('\n')}

Task details:
- Name: ${task.name}
- Status: ${task.status} (type: ${task.statusType})
- List: ${task.listName}
- Description: ${(task.description || '').slice(0, 300)}
- Tags: ${(task.tags || []).join(', ') || 'none'}
- Subtasks: ${task.subtasks.slice(0, 3).map(s => s.name).join(', ') || 'none'}

Respond with ONLY raw JSON, no markdown, no backticks:
{"stage":3,"stageName":"Mathematical Sim in Python","confidence":0.9,"reasoning":"one sentence","isBlocker":false}`;

  // Retry loop — handles rate limits automatically
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            generationConfig: { temperature: 0.1, maxOutputTokens: 200 },
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );

      const data = await response.json();

      // Rate limited — extract wait time and retry
      if (response.status === 429) {
        const retryMatch = JSON.stringify(data).match(/"retryDelay":"(\d+)s"/);
        const waitSec = retryMatch ? parseInt(retryMatch[1]) + 2 : 30;
        process.stdout.write(` ⏳ rate limited, waiting ${waitSec}s...`);
        await sleep(waitSec * 1000);
        continue; // retry
      }

      if (!response.ok) {
        throw new Error(`API error ${response.status}: ${JSON.stringify(data.error)}`);
      }

      const text = data.candidates[0].content.parts[0].text.trim();
      const clean = text.replace(/```json|```/g, '').trim();
      return JSON.parse(clean);

    } catch (err) {
      if (attempt === 5) {
        console.error(`\n  ❌ Gave up on "${task.name.slice(0, 40)}": ${err.message}`);
        return { stage: 1, stageName: "Initial Module Spec", confidence: 0, reasoning: "Failed", isBlocker: false };
      }
      await sleep(3000 * attempt);
    }
  }
}

async function classifyAllTasks() {
  const tasks = JSON.parse(fs.readFileSync('ams_tasks.json', 'utf-8'));

  // Resume from checkpoint if exists
  let classified = [];
  let startFrom = 0;
  if (fs.existsSync('ams_classified_checkpoint.json')) {
    classified = JSON.parse(fs.readFileSync('ams_classified_checkpoint.json', 'utf-8'));
    startFrom = classified.length;
    console.log(`⏩ Resuming from checkpoint — ${startFrom}/${tasks.length} already done`);
  }
  console.log(`📂 ${tasks.length - startFrom} tasks remaining\n`);

  for (let i = startFrom; i < tasks.length; i++) {
    const task = tasks[i];
    process.stdout.write(`  [${i + 1}/${tasks.length}] "${task.name.slice(0, 45)}"...`);

    const classification = await classifyTask(task);
    classified.push({ ...task, classification });

    process.stdout.write(` → Stage ${classification.stage} (${(classification.confidence * 100).toFixed(0)}%)\n`);

    // Checkpoint every 20 tasks
    if ((i + 1) % 20 === 0) {
      fs.writeFileSync('ams_classified_checkpoint.json', JSON.stringify(classified, null, 2));
      console.log(`  💾 Checkpoint saved (${i + 1}/${tasks.length})\n`);
    }

    await sleep(1500); // 1.5s between calls — Gemini free = 15 RPM max
  }

  return classified;
}

classifyAllTasks().then(classified => {
  fs.writeFileSync('ams_classified.json', JSON.stringify(classified, null, 2));
  console.log('\n🎉 Classification complete!');

  const byStage = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  classified.forEach(t => {
    const s = t.classification?.stage;
    if (s >= 1 && s <= 5) byStage[s].push(t);
  });

  console.log('\n📊 Tasks per stage:');
  PIPELINE_STAGES.forEach(s => {
    const st = byStage[s.id];
    console.log(`  Stage ${s.id} — ${s.name}: ${st.length} tasks (${st.filter(t => t.classification?.isBlocker).length} blockers 🔴)`);
  });

  console.log('\n👥 Per member breakdown:');
  const ms = {};
  classified.forEach(t => {
    t.assignees.forEach(a => {
      if (!ms[a.username]) ms[a.username] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const s = t.classification?.stage;
      if (s >= 1 && s <= 5) ms[a.username][s]++;
    });
  });
  Object.entries(ms)
    .sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0))
    .forEach(([name, stages]) => {
      console.log(`  ${name}: ${Object.entries(stages).map(([s, c]) => `S${s}:${c}`).join(' ')}`);
    });
}).catch(console.error);