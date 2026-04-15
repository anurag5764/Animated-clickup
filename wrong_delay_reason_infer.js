/**
 * LLM delay narrative for PS/RTL “What went wrong” (completed + Delayed=Yes tasks).
 * Uses local Ollama; falls back to comment-keyword synthesis via classify.js.
 */

import axios from 'axios';
import dotenv from 'dotenv';
import { applyGroundedReason, buildEvidenceReason } from './classify.js';

dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

function normalizeJsonText(text) {
  return String(text)
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2018|\u2019/g, "'");
}

function safeParseJsonFromModel(text) {
  const cleaned = normalizeJsonText(String(text || ''))
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(normalizeJsonText(m[0]));
    } catch {
      return null;
    }
  }
}

async function ollamaApiPost(body) {
  const ms = Number(process.env.OLLAMA_TIMEOUT_MS || 3600000);
  const res = await axios.post(`${OLLAMA_URL}/api/chat`, body, {
    timeout: ms > 0 ? ms : 3600000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: { 'Content-Type': 'application/json' },
  });
  return res.data;
}

function formatCommentsForPrompt(task) {
  const raw = Array.isArray(task.comments) ? task.comments : [];
  return raw
    .map((c) => {
      const t = String(c.text || c.comment || '').replace(/\s+/g, ' ').trim();
      const author = c.author || c.commentBy || 'unknown';
      return t ? `${author}: ${t}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {object} task — extract shape (name, description, comments[])
 * @param {{ team: 'ps' | 'rtl' }} context
 * @returns {Promise<string>}
 */
export async function inferWrongViewDelayReason(task, context) {
  const team = context?.team === 'rtl' ? 'RTL IC design' : 'post-silicon validation (PS)';
  const name = String(task.name || '').slice(0, 200);
  const desc = String(task.description || '').slice(0, 1200);
  const thread = formatCommentsForPrompt(task).slice(0, 8000);

  const userMsg = `You analyze DELAYED completed work for a ${team} team.

Task name: ${name}
Description: ${desc}

Comment thread (oldest to newest in the text below — infer updates from later messages):
${thread || '(no comments)'}

Return JSON ONLY in this shape:
{"blockerReason":"..."}

The blockerReason MUST use this exact structure (markdown-style headings):

Delay Reason @pm:

1. Summary:
(One short paragraph — what slipped and why, in your own words. Do NOT paste raw comments.)

2. Technical:
(Concrete technical / process / dependency causes. No verbatim multi-line quotes.)

If comments are empty or uninformative, still return the headings with honest "insufficient detail in thread" style content.`;

  try {
    const data = await ollamaApiPost({
      model: OLLAMA_MODEL,
      stream: false,
      format: 'json',
      options: { temperature: 0.15, num_predict: 2048 },
      messages: [
        {
          role: 'system',
          content:
            'You output only valid JSON with a single key blockerReason (string). No markdown fences.',
        },
        { role: 'user', content: userMsg },
      ],
    });
    const content = data.message?.content || '';
    const parsed = safeParseJsonFromModel(content);
    const rawReason = typeof parsed?.blockerReason === 'string' ? parsed.blockerReason : '';
    const cls = applyGroundedReason(task, {
      blockerReason: rawReason,
      stage: 1,
      stageName: 'n/a',
      confidence: 0.55,
      reasoning: '',
      isBlocker: true,
      blockerType: 'unknown',
    });
    return cls.blockerReason || buildEvidenceReason(task);
  } catch {
    return buildEvidenceReason(task);
  }
}
