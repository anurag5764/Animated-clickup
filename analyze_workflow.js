import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// Note: You need to sign up at https://openrouter.ai and get an API key,
// then add it to your .env file as OPENROUTER_API_KEY=your_key_here
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error("❌ Error: Please add OPENROUTER_API_KEY to your .env file.");
  process.exit(1);
}

const SYSTEM_PROMPT_PATH = './temp/system_propmt.txt';
const TASKS_JSON_PATH = './members_tasks.json';

async function analyze() {
  try {
    // 1. Read the system prompt
    console.log("📖 Reading system prompt...");
    if (!fs.existsSync(SYSTEM_PROMPT_PATH)) {
        console.error(`❌ Error: System prompt file not found at ${SYSTEM_PROMPT_PATH}`);
        process.exit(1);
    }
    const systemPrompt = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');

    // 2. Read the JSON with in-progress tasks
    console.log("📖 Reading tasks data...");
    if (!fs.existsSync(TASKS_JSON_PATH)) {
        console.error(`❌ Error: Tasks JSON file not found at ${TASKS_JSON_PATH}. Run 'node member.js' first.`);
        process.exit(1);
    }
    const tasksData = fs.readFileSync(TASKS_JSON_PATH, 'utf-8');

    console.log("🤖 Sending data to OpenRouter (this might take a few seconds)...");

    // 3. Make request to OpenRouter using a powerful free model
    // Qwen 2.5 72B is an excellent free open-source model available on OpenRouter that is smart enough for complex workflow analysis.
    // Other free alternatives you could use: 'meta-llama/llama-3.3-70b-instruct:free' or 'google/gemini-2.0-flash-exp:free'
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'openrouter/auto', // Auto-routes to the best model based on your account's available credits
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Here are the in-progress tasks for the PS team in JSON format:\n\n${tasksData}` }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'http://localhost:3000', // OpenRouter requires this for rankings
          'X-Title': 'ClickUp Workflow Analyzer',  // OpenRouter requires this for rankings
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
      console.error("⚠️  LLM did not return valid JSON. Raw output saved to output_raw.txt for debugging.");
      fs.writeFileSync('output_raw.txt', resultText);
      process.exit(1);
    }

    console.log("\n==========================================================================");
    console.log("                       🧠 WORKFLOW ANALYSIS RESULT                       ");
    console.log("==========================================================================\n");
    console.log(`📍 Current Position: Stage ${parsed.currentPosition.stageNumber} — ${parsed.currentPosition.stageName}`);
    console.log(`   ${parsed.currentPosition.summary}`);
    console.log(`\n⚠️  Blockers: ${parsed.blockers.length}`);
    parsed.blockers.forEach(b => console.log(`   • [${b.severity.toUpperCase()}] ${b.task}: ${b.reason}`));
    console.log(`\n➡️  Next Step: ${parsed.nextStep}`);
    console.log("\n==========================================================================");

    // Save structured JSON for the frontend dashboard
    fs.writeFileSync('output.json', JSON.stringify(parsed, null, 2));
    console.log('\n📁 Output saved to output.json');

  } catch (err) {
    if (err.response) {
      console.error("❌ OpenRouter API Error:", err.response.data);
    } else {
      console.error("❌ Error analyzing tasks:", err.message);
    }
  }
}

analyze();
