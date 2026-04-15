import fs from 'node:fs/promises';
import path from 'node:path';

export async function GET() {
  try {
    const root = path.join(process.cwd(), '..');
    const candidates = [
      path.join(root, 'data', 'ams', 'ams_blocker_analysis.json'),
      path.join(root, 'ams_blocker_analysis.json'),
    ];
    const filePath = candidates[0];
    let raw = null;
    for (const p of candidates) {
      try {
        raw = await fs.readFile(p, 'utf-8');
        break;
      } catch {
        // try next candidate
      }
    }
    if (!raw) throw new Error('ams_blocker_analysis.json not found');
    const parsed = JSON.parse(raw);
    return Response.json(parsed);
  } catch (error) {
    return Response.json(
      { error: `Failed to load AMS blocker analysis data: ${error.message}` },
      { status: 500 }
    );
  }
}
