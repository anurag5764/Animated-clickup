'use client';

import { useState, useEffect, useRef } from 'react';
import Pipeline from './components/Pipeline';

const TEAMS = [
  { key: 'ps', label: 'PS Team', icon: '⚡' },
  { key: 'ams', label: 'AMS Team', icon: '📡', file: '/api/ams-classified' },
  { key: 'rtl', label: 'RTL Team', icon: '🔌', file: '/output_rtl.json' },
];

/** Served via /api/ps-output/* — reads repo-root output_ps_qs222.json / output_ps_qs223.json (analyzer output). */
const PS_PROJECTS = [
  { id: 'qs222', label: 'QS222', file: '/api/ps-output/qs222' },
  { id: 'qs223', label: 'QS223', file: '/api/ps-output/qs223' },
];

function getPsFile(projectId) {
  return PS_PROJECTS.find((p) => p.id === projectId)?.file || PS_PROJECTS[0].file;
}

function cacheKeyFor(activeTeam, psProject) {
  if (activeTeam === 'ps') return `ps_${psProject}`;
  return activeTeam;
}

export default function Home() {
  const [activeTeam, setActiveTeam] = useState('ps');
  const [psProject, setPsProject] = useState('qs222');
  const [cache, setCache] = useState({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const key = cacheKeyFor(activeTeam, psProject);
    if (cacheRef.current[key]) {
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const file =
      activeTeam === 'ps'
        ? getPsFile(psProject)
        : TEAMS.find((t) => t.key === activeTeam)?.file;

    (async () => {
      try {
        const res = await fetch(file);
        if (!res.ok) {
          let msg = `${file} — ${res.status}`;
          try {
            const errBody = await res.json();
            if (errBody?.error) msg = errBody.error + (errBody.hint ? ` ${errBody.hint}` : '');
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        const json = await res.json();
        if (!cancelled) {
          setCache((prev) => ({ ...prev, [key]: json }));
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTeam, psProject]);

  const key = cacheKeyFor(activeTeam, psProject);
  const data = cache[key];
  const currentTeam = TEAMS.find((t) => t.key === activeTeam);
  const teamLabel =
    activeTeam === 'ps'
      ? `PS Team · ${PS_PROJECTS.find((p) => p.id === psProject)?.label || 'QS222'}`
      : currentTeam.label;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <nav className="flex justify-center gap-2 pt-5 pb-2 shrink-0 relative z-10 flex-wrap">
        {TEAMS.map((team) => (
          <button
            key={team.key}
            onClick={() => setActiveTeam(team.key)}
            className={`
              px-5 py-2 rounded-xl text-sm font-medium transition-all duration-300 border cursor-pointer
              ${activeTeam === team.key
                ? 'bg-accent border-accent text-white font-semibold shadow-[0_4px_24px_rgba(255,99,33,0.4),0_0_48px_rgba(255,99,33,0.15)]'
                : 'bg-card border-border text-text-secondary hover:border-accent-dim hover:text-foreground hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(255,99,33,0.1)]'
              }
            `}
          >
            <span className="mr-1.5">{team.icon}</span>
            {team.label}
          </button>
        ))}
      </nav>

      {activeTeam === 'ps' && (
        <div className="flex justify-center gap-2 pb-2 shrink-0">
          {PS_PROJECTS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPsProject(p.id)}
              className={`
                px-4 py-1.5 rounded-lg text-xs font-medium border transition-all
                ${psProject === p.id
                  ? 'bg-white/10 border-accent text-accent'
                  : 'bg-card/50 border-border text-text-muted hover:border-white/20'
                }
              `}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0">
        {loading && (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3"></div>
            <p className="text-text-muted text-sm">Loading {teamLabel} analysis...</p>
          </div>
        )}

        {!loading && (error || !data) && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <p className="text-4xl mb-4">📂</p>
            <p className="text-text-secondary text-base mb-2">No data for {teamLabel}</p>
            <p className="text-text-muted text-sm max-w-md">
              PS (per project): run{' '}
              <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node extract_ps_folder_tasks.js</code>
              {' '}then{' '}
              <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">
                node analyze_ps_workflow.js
              </code>
              {' '}(default: local Ollama; optional{' '}
              <code className="bg-white/5 px-1 rounded text-xs">PS_USE_OPENROUTER=1</code>
              {' '}
              for OpenRouter). AMS:{' '}
              <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node classify.js</code>
              {' '}(Ollama) and keep <code className="bg-white/5 px-1 rounded text-xs">ams_tasks.json</code> in the repo
              root. RTL:{' '}
              <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node member.js</code>
              {' '}then{' '}
              <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node analyze_workflow.js</code>
            </p>
          </div>
        )}

        {!loading && data && (
          <Pipeline
            data={data}
            stages={data.stages}
            teamLabel={teamLabel}
            teamKey={activeTeam}
          />
        )}
      </div>
    </div>
  );
}
