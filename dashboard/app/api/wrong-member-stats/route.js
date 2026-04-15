import fs from 'node:fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { buildWrongWorkflowMemberStatsPayload } from '../../../lib/wrongMemberStats';

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

export async function GET(request) {
  const team = request.nextUrl.searchParams.get('team');
  const project = request.nextUrl.searchParams.get('project') || 'qs222';

  if (!ALLOWED.has(project)) {
    return NextResponse.json({ error: 'Invalid project' }, { status: 400 });
  }
  if (team !== 'ps' && team !== 'rtl') {
    return NextResponse.json(
      { error: 'Invalid team', hint: 'Use team=ps or team=rtl' },
      { status: 400 }
    );
  }

  const filename = team === 'ps' ? `output_ps_wrong_${project}.json` : `output_rtl_wrong_${project}.json`;
  const abs = resolveOutputFile(filename);

  if (!abs) {
    return NextResponse.json(
      {
        error: `Missing ${filename}`,
        hint:
          team === 'ps'
            ? 'Run extract_ps_wrong_folder_tasks.js then analyze_ps_workflow.js, or copy the file to dashboard/public/.'
            : 'Run extract_rtl_wrong_folder_tasks.js then analyze_rtl_workflow.js, or copy the file to dashboard/public/.',
      },
      { status: 404 }
    );
  }

  try {
    const raw = fs.readFileSync(abs, 'utf-8');
    const data = JSON.parse(raw);
    const payload = buildWrongWorkflowMemberStatsPayload(data, {
      team,
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
