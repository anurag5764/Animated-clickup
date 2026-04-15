import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

const ALLOWED = new Set(['qs222', 'qs223', 'qs127']);

function resolveOutputFile(filename) {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, '..', 'data', 'outputs', filename),
    path.join(cwd, '..', filename),
    path.join(cwd, filename),
    path.join(cwd, 'public', filename),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function GET(request, context) {
  const { project } = await context.params;
  if (!ALLOWED.has(project)) {
    return NextResponse.json({ error: 'Invalid RTL project' }, { status: 400 });
  }

  const viewParam = request.nextUrl.searchParams.get('view') || 'current';
  const view = viewParam === 'wrong' ? 'wrong' : 'current';

  const filename = view === 'wrong' ? `output_rtl_wrong_${project}.json` : `output_rtl_${project}.json`;
  const abs = resolveOutputFile(filename);

  if (!abs) {
    return NextResponse.json(
      {
        error: `Missing ${filename}`,
        hint:
          view === 'wrong'
            ? `Run node extract_rtl_wrong_folder_tasks.js then node analyze_rtl_workflow.js, or copy ${filename} to dashboard/public/.`
            : 'Run node extract_rtl_folder_tasks.js then node analyze_rtl_workflow.js from the repo root.',
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
