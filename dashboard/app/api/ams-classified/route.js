import fs from 'node:fs/promises';
import path from 'node:path';

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), '..', 'ams_blocker_analysis.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Response.json(parsed);
  } catch (error) {
    return Response.json(
      { error: `Failed to load AMS blocker analysis data: ${error.message}` },
      { status: 500 }
    );
  }
}
