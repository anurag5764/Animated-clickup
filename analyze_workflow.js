import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error("❌ Error: Please add OPENROUTER_API_KEY to your .env file.");
  process.exit(1);
}

const SYSTEM_PROMPT_PATH = './temp/system_propmt.txt';

// Team configurations — must match the output files from member.js
const TEAMS = [
  { name: 'PS',  tasksFile: './members_tasks_ps.json',  outputFile: 'output_ps.json' },
  { name: 'AMS', tasksFile: './members_tasks_ams.json', outputFile: 'output_ams.json' },
  { name: 'RTL', tasksFile: './members_tasks_rtl.json', outputFile: 'output_rtl.json' },
];

async function analyzeTeam(teamConfig, systemPrompt) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  🧠 Analyzing Team: ${teamConfig.name}`);
  console.log(`${'='.repeat(60)}`);

  // Read tasks JSON
  if (!fs.existsSync(teamConfig.tasksFile)) {
    console.warn(`⚠️  Tasks file not found: ${teamConfig.tasksFile}. Skipping ${teamConfig.name} team. Run 'node member.js' first.`);
    return;
  }
  const tasksData = fs.readFileSync(teamConfig.tasksFile, 'utf-8');

  console.log("🤖 Sending data to OpenRouter (this might take a few seconds)...");

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: 'openrouter/auto',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Here are the in-progress tasks for the ${teamConfig.name} team in JSON format:\n\n${tasksData}` }
      ]
    },
    {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': `ClickUp Workflow Analyzer - ${teamConfig.name} Team`,
        'Content-Type': 'application/json'
      }
    }
  );

  let resultText = response.data.choices[0].message.content;

  // Strip markdown code fences if the LLM wraps the JSON in them
  resultText = resultText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Validate it's valid JSON
  let parsed;
  try {
    parsed = JSON.parse(resultText);
  } catch (parseErr) {
    const rawFile = `output_raw_${teamConfig.name.toLowerCase()}.txt`;
    console.error(`⚠️  ${teamConfig.name}: LLM did not return valid JSON. Raw output saved to ${rawFile}`);
    fs.writeFileSync(rawFile, resultText);
    return;
  }

  console.log(`\n📍 ${teamConfig.name} — Current Position: Stage ${parsed.currentPosition.stageNumber} — ${parsed.currentPosition.stageName}`);
  console.log(`   ${parsed.currentPosition.summary}`);
  console.log(`\n⚠️  Blockers: ${parsed.blockers.length}`);
  parsed.blockers.forEach(b => console.log(`   • [${b.severity.toUpperCase()}] ${b.task}: ${b.reason}`));
  console.log(`\n➡️  Next Step: ${parsed.nextStep}`);

  // Save structured JSON for the frontend dashboard
  fs.writeFileSync(teamConfig.outputFile, JSON.stringify(parsed, null, 2));
  console.log(`\n📁 ${teamConfig.name} output saved to ${teamConfig.outputFile}`);

  // Also copy to dashboard/public/ for the Next.js app
  const dashboardPublicPath = `./dashboard/public/${teamConfig.outputFile}`;
  try {
    fs.copyFileSync(teamConfig.outputFile, dashboardPublicPath);
    console.log(`📋 Copied to ${dashboardPublicPath}`);
  } catch (copyErr) {
    console.warn(`⚠️  Could not copy to dashboard/public/: ${copyErr.message}`);
  }
}

async function analyze() {
  try {
    // Read the shared system prompt
    console.log("📖 Reading system prompt...");
    if (!fs.existsSync(SYSTEM_PROMPT_PATH)) {
      console.error(`❌ Error: System prompt file not found at ${SYSTEM_PROMPT_PATH}`);
      process.exit(1);
    }
    const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');

    // Analyze each team sequentially
    for (const teamConfig of TEAMS) {
      try {
        await analyzeTeam(teamConfig, systemPrompt);
      } catch (err) {
        if (err.response) {
          console.error(`❌ ${teamConfig.name} OpenRouter API Error:`, err.response.data);
        } else {
          console.error(`❌ ${teamConfig.name} Error:`, err.message);
        }
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log("  🎉 ALL TEAMS ANALYZED!");
    console.log(`${'='.repeat(60)}`);

  } catch (err) {
    console.error("❌ Fatal error:", err.message);
  }
}

analyze();
