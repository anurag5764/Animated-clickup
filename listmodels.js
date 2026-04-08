// listmodels.js
import dotenv from 'dotenv';
dotenv.config();

const response = await fetch('https://openrouter.ai/api/v1/models', {
  headers: {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
  }
});

const data = await response.json();

// Filter to just Anthropic + cheap/fast models
const models = data.data
  .filter(m => 
    m.id.includes('anthropic') || 
    m.id.includes('gemini') || 
    m.id.includes('gpt') ||
    m.id.includes('mistral')
  )
  .map(m => ({
    id: m.id,
    name: m.name,
    contextLength: m.context_length,
    promptPrice: m.pricing?.prompt,
  }));

console.log('Available models:\n');
models.forEach(m => console.log(`  ${m.id}  (ctx: ${m.contextLength})`));