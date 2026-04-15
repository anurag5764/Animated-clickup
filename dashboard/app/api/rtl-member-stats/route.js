import fs from 'node:fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { buildFolderMemberStatsPayload } from '../../../lib/wrongMemberStats';

const ALLOWED = new Set(['qs222', 'qs223', 'qs127']);

function resolveOutputFile(filename) {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, '..', 'data', 'extracts', filename),
    path.join(cwd, '..', filename),
    path.join(cwd, filename),
    path.join(cwd, 'public', filename),
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

  const filename = `rtl_folder_tasks_${project}.json`;
  const abs = resolveOutputFile(filename);

  if (!abs) {
    return NextResponse.json(
      {
        error: `Missing ${filename}`,
        hint:
          'Run node extract_rtl_folder_tasks.js from the repo root (needs CLICKUP_API_TOKEN), or copy the JSON beside dashboard/. Re-extract so tasks include custom_fields for Delayed.',
      },
      { status: 404 }
    );
  }

  try {
    const raw = fs.readFileSync(abs, 'utf-8');
    const data = JSON.parse(raw);
    const payload = buildFolderMemberStatsPayload(data, {
      team: 'rtl',
      project,
      sourceFile: path.basename(abs),
    });
    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: 'Failed to build member stats', detail: String(e.message) },
      { status: 500 }
    );
  }
}
