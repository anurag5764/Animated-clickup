/**
 * Parse Leverage / Neutral / Overhead tag from task title (e.g. "L3 — spec", "N3: Doc").
 * L1 = highest importance within L; L5 = lowest.
 */

export function parseLnoFromName(name) {
  const s = String(name || '');
  const atStart = s.match(/^\s*([LNO])([1-5])(?:\s*[:\-–—.]|\s+|\b)/i);
  if (atStart) {
    const tier = atStart[1].toUpperCase();
    const level = Number(atStart[2]);
    return { tier, level, label: `${tier}${level}` };
  }
  const any = s.match(/\b([LNO])([1-5])\b/i);
  if (any) {
    const tier = any[1].toUpperCase();
    const level = Number(any[2]);
    return { tier, level, label: `${tier}${level}` };
  }
  return { tier: null, level: null, label: null };
}

const TIER_ORDER = { L: 0, N: 1, O: 2 };

export function compareLnoTasks(a, b) {
  const ta = TIER_ORDER[a.lnoTier] ?? 9;
  const tb = TIER_ORDER[b.lnoTier] ?? 9;
  if (ta !== tb) return ta - tb;
  const la = a.lnoLevel ?? 99;
  const lb = b.lnoLevel ?? 99;
  if (la !== lb) return la - lb;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

export function stageHeatFromLnoTasks(tasks) {
  const hasL = tasks.some((t) => t.lnoTier === 'L');
  const hasN = tasks.some((t) => t.lnoTier === 'N');
  const hasO = tasks.some((t) => t.lnoTier === 'O');
  if (hasL) return 'leverage';
  if (hasN) return 'neutral';
  if (hasO) return 'overhead';
  if (tasks.length > 0) return 'unknown_lno';
  return 'upcoming';
}
