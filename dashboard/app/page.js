'use client';

import { useState, useEffect } from 'react';
import Pipeline from './components/Pipeline';

const TEAMS = [
  { key: 'ps',  label: 'PS Team',  icon: '⚡', file: '/output_ps.json' },
  { key: 'ams', label: 'AMS Team', icon: '📡', file: '/output_ams.json' },
  { key: 'rtl', label: 'RTL Team', icon: '🔌', file: '/output_rtl.json' },
];

export default function Home() {
  const [activeTeam, setActiveTeam] = useState('ps');
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadTeam(activeTeam);
  }, [activeTeam]);

  async function loadTeam(teamKey) {
    if (cache[teamKey]) {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const team = TEAMS.find(t => t.key === teamKey);
    try {
      const res = await fetch(team.file);
      if (!res.ok) throw new Error(`${team.file} not found`);
      const json = await res.json();
      setCache(prev => ({ ...prev, [teamKey]: json }));
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  const data = cache[activeTeam];
  const currentTeam = TEAMS.find(t => t.key === activeTeam);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {/* Team Tabs */}
      <nav className="flex justify-center gap-2 pt-5 pb-2 shrink-0 relative z-10">
        {TEAMS.map(team => (
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

      {/* Content */}
      <div className="flex-1 min-h-0">
        {loading && (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3"></div>
            <p className="text-text-muted text-sm">Loading {currentTeam.label} analysis...</p>
          </div>
        )}

        {!loading && (error || !data) && (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <p className="text-4xl mb-4">📂</p>
            <p className="text-text-secondary text-base mb-2">No data for {currentTeam.label}</p>
            <p className="text-text-muted text-sm">
              Run <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node member.js</code> then{' '}
              <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node analyze_workflow.js</code>
            </p>
          </div>
        )}

        {!loading && data && (
          <Pipeline stages={data.stages} teamLabel={currentTeam.label} />
        )}
      </div>
    </div>
  );
}
