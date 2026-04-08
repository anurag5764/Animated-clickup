// debugtest.js
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';

const tasks = JSON.parse(fs.readFileSync('ams_tasks.json', 'utf-8'));
const task = tasks[0];

console.log('Testing with task:', task.name);

const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'AMS Pipeline Classifier',
  },
  body: JSON.stringify({
    model: 'anthropic/claude-3.5-sonnet',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `Classify this AMS IC design task into one of these 5 stages:
1. Initial Module Spec
2. Mathematical Modeling  
3. Mathematical Sim in Python
4. Circuit Implementation and Sim
5. Layout + Post Layout Sim

Task name: ${task.name}
Status: ${task.status}
Description: ${(task.description || '').slice(0, 200)}

Reply with ONLY JSON like: {"stage":3,"stageName":"Mathematical Sim in Python","confidence":0.9,"reasoning":"one sentence","isBlocker":false}`
      }
    ]
  })
});

const data = await response.json();
console.log('Status:', response.status);
console.log('Full response:', JSON.stringify(data, null, 2));