import fs from 'node:fs';
import path from 'path';
import { NextResponse } from 'next/server';

const ALLOWED = new Set(['qs222', 'qs223', 'qs127']);

function resolveOutputFile(filename) {
  const cwd = process.cwd();
  const isExtract = filename.startsWith('leaderboard_') || filename.includes('_folder_tasks_');
  const dir = isExtract ? 'extracts' : 'outputs';
  
  const candidates = [
    path.join(cwd, 'data', dir, filename),
    path.join(cwd, 'data', filename),
    path.join(cwd, 'public', filename),
    // Fallback for local dev if cwd is root
    path.join(cwd, 'dashboard', 'data', dir, filename),
    // Legacy fallback
    path.join(cwd, '..', 'data', dir, filename),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function GET(request) {
  const project = request.nextUrl.searchParams.get('project') || 'qs222';

  if (!ALLOWED.has(project)) {
    return NextResponse.json({ error: 'Invalid project' }, { status: 400 });
  }

  const filename = `leaderboard_rtl_${project}.json`;
  const abs = resolveOutputFile(filename);

  if (!abs) {
    return NextResponse.json(
      {
        error: `Missing ${filename}`,
        hint:
          'Run node extract_rtl_leaderboard_stats.js from the repo root (needs CLICKUP_API_TOKEN), or copy the JSON beside dashboard/.',
      },
      { status: 404 }
    );
  }

  try {
    const raw = fs.readFileSync(abs, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to read member stats', detail: String(e.message) },
      { status: 500 }
    );
  }
}
