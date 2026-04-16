import fs from 'fs';
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

export async function GET(request, context) {
  const { project } = await context.params;
  if (!ALLOWED.has(project)) {
    return NextResponse.json({ error: 'Invalid AMS project' }, { status: 400 });
  }

  const viewParam = request.nextUrl.searchParams.get('view') || 'current';
  const view = viewParam === 'wrong' ? 'wrong' : 'current';

  let filename =
    view === 'wrong' ? `output_ams_wrong_${project}.json` : `output_ams_current_${project}.json`;
  let abs = resolveOutputFile(filename);

  if (!abs && view === 'current') {
    filename = `output_ams_${project}.json`;
    abs = resolveOutputFile(filename);
  }

  if (!abs) {
    const expected =
      view === 'wrong'
        ? `output_ams_wrong_${project}.json`
        : `output_ams_current_${project}.json (or legacy output_ams_${project}.json)`;
    return NextResponse.json(
      {
        error: `Missing AMS output for ${project} (view=${view})`,
        hint: `Generate ${expected} and place it in the repo root or dashboard/public/. API: /api/ams-output/${project}?view=${view === 'wrong' ? 'wrong' : 'current'}`,
      },
      { status: 404 }
    );
  }
  try {
    const raw = fs.readFileSync(abs, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Invalid JSON', detail: String(e.message) },
      { status: 500 }
    );
  }
}
