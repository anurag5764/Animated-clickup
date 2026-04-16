'use client';

import { useState, useEffect, useRef } from 'react';
import Pipeline from './components/Pipeline';

const TEAMS = [
  { key: 'ps', label: 'PS Team' },
  { key: 'ams', label: 'AMS Team' },
  { key: 'rtl', label: 'RTL Team' },
];

const AMS_PROJECTS = [
  { id: 'qs222', label: 'QS222' },
  { id: 'qs223', label: 'QS223' },
  { id: 'qs127', label: 'QS127' },
];

/** Served via /api/ps-output/* */
const PS_PROJECTS = [
  { id: 'qs222', label: 'QS222', file: '/api/ps-output/qs222' },
  { id: 'qs223', label: 'QS223', file: '/api/ps-output/qs223' },
  { id: 'qs127', label: 'QS127', file: '/api/ps-output/qs127' },
];

const RTL_PROJECTS = [
  { id: 'qs222', label: 'QS222', file: '/api/rtl-output/qs222' },
  { id: 'qs223', label: 'QS223', file: '/api/rtl-output/qs223' },
  { id: 'qs127', label: 'QS127', file: '/api/rtl-output/qs127' },
];

function getPsFile(projectId) {
  return PS_PROJECTS.find((p) => p.id === projectId)?.file || PS_PROJECTS[0].file;
}

function getRtlFile(projectId) {
  return RTL_PROJECTS.find((p) => p.id === projectId)?.file || RTL_PROJECTS[0].file;
}

/** Cache keys separate “where we are” vs “what went wrong”; AMS also splits current vs completed-delayed JSON. */
function cacheKey(viewTab, activeTeam, psProject, rtlProject, amsProject) {
  if (viewTab === 'wrong') {
    if (activeTeam === 'ps') return `wrong_ps_${psProject}`;
    if (activeTeam === 'rtl') return `wrong_rtl_${rtlProject}`;
    if (activeTeam === 'ams') return `wrong_ams_${amsProject}`;
  } else {
    if (activeTeam === 'ps') return `current_ps_${psProject}`;
    if (activeTeam === 'rtl') return `current_rtl_${rtlProject}`;
    if (activeTeam === 'ams') return `current_ams_${amsProject}`;
  }
  return 'unknown';
}

function getFetchUrl(viewTab, activeTeam, psProject, rtlProject, amsProject) {
  const view = viewTab === 'wrong' ? 'wrong' : 'current';
  if (activeTeam === 'ps') return `${getPsFile(psProject)}?view=${view}`;
  if (activeTeam === 'rtl') return `${getRtlFile(rtlProject)}?view=${view}`;
  if (activeTeam === 'ams') {
    return `/api/ams-output/${amsProject}?view=${view}`;
  }
  return null;
}

function getTeamLabel(viewTab, activeTeam, psProject, rtlProject, amsProject) {
  const wrongSuffix = viewTab === 'wrong' ? ' · What went wrong' : '';
  if (activeTeam === 'ps') {
    return `PS Team · ${PS_PROJECTS.find((p) => p.id === psProject)?.label || 'QS222'}${wrongSuffix}`;
  }
  if (activeTeam === 'ams') {
    return `AMS Team · ${AMS_PROJECTS.find((p) => p.id === amsProject)?.label || 'QS222'}${wrongSuffix}`;
  }
  if (activeTeam === 'rtl') {
    return `RTL Team · ${RTL_PROJECTS.find((p) => p.id === rtlProject)?.label || 'QS222'}${wrongSuffix}`;
  }
  return 'Team';
}

const VIEW_TABS = [
  { id: 'current', label: 'Where we are currently' },
  { id: 'wrong', label: 'What went wrong' },
];

/** Shown only for “What went wrong”; filters delayed tasks by reference time (completion / activity). */
const WRONG_DATE_FILTERS = [
  { id: 'all', label: 'All time' },
  { id: 'last7', label: 'Past 7 days' },
  { id: 'month', label: 'Past month' },
  { id: 'quarter', label: 'Past quarter' },
  { id: 'year', label: 'Past year' },
];

export default function Home() {
  const [viewTab, setViewTab] = useState('current');
  const [activeTeam, setActiveTeam] = useState('ps');
  const [psProject, setPsProject] = useState('qs222');
  const [rtlProject, setRtlProject] = useState('qs222');
  const [amsProject, setAmsProject] = useState('qs222');
  const [wrongDateFilter, setWrongDateFilter] = useState('all');
  const [cache, setCache] = useState({});
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const key = cacheKey(viewTab, activeTeam, psProject, rtlProject, amsProject);
    if (cacheRef.current[key]) {
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const file = getFetchUrl(viewTab, activeTeam, psProject, rtlProject, amsProject);
    if (!file) {
      setLoading(false);
      setError('No team selected');
      return () => {
        cancelled = true;
      };
    }

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
  }, [viewTab, activeTeam, psProject, rtlProject, amsProject]);

  const dataKey = cacheKey(viewTab, activeTeam, psProject, rtlProject, amsProject);
  const data = cache[dataKey];
  const teamLabel = getTeamLabel(viewTab, activeTeam, psProject, rtlProject, amsProject);

  const fetchUrlDisplay = getFetchUrl(viewTab, activeTeam, psProject, rtlProject, amsProject) || '';

  const selectBase =
    'min-w-[11rem] sm:min-w-[13rem] max-w-[min(100vw-2rem,20rem)] rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm ' +
    'focus:outline-none focus:ring-2 focus:ring-accent/35 focus:border-accent cursor-pointer appearance-none ' +
    'bg-[length:1rem] bg-[right_0.65rem_center] bg-no-repeat pr-9 ' +
    '[background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 fill=%27none%27 viewBox=%270 0 24 24%27 stroke=%27%23a8a29e%27%3E%3Cpath stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27M19 9l-7 7-7-7%27/%3E%3C/svg%3E")]';

  const projectOptions =
    activeTeam === 'ps' ? PS_PROJECTS : activeTeam === 'rtl' ? RTL_PROJECTS : AMS_PROJECTS;
  const projectValue = activeTeam === 'ps' ? psProject : activeTeam === 'rtl' ? rtlProject : amsProject;
  const onProjectChange = (id) => {
    if (activeTeam === 'ps') setPsProject(id);
    else if (activeTeam === 'rtl') setRtlProject(id);
    else setAmsProject(id);
  };

  return (
    <div className="h-screen min-h-0 w-screen flex flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0 flex-col">
        <header className="shrink-0 border-b border-border/60 bg-card/40 backdrop-blur-sm px-3 sm:px-5 py-3 sm:py-3.5">
          <div className="w-full flex justify-center">
            <div className="flex w-full max-w-[min(1100px,100%)] flex-col items-center sm:flex-row sm:flex-wrap sm:items-end sm:justify-center gap-3 sm:gap-x-8 sm:gap-y-3">
              <div className="flex w-[min(20rem,100%)] flex-col gap-1.5 sm:w-[13rem] sm:shrink-0">
                <label htmlFor="dashboard-view" className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  View
                </label>
                <select
                  id="dashboard-view"
                  value={viewTab}
                  onChange={(e) => setViewTab(e.target.value)}
                  className={selectBase}
                >
                  {VIEW_TABS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex w-[min(20rem,100%)] flex-col gap-1.5 sm:w-[13rem] sm:shrink-0">
                <label htmlFor="dashboard-team" className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  Team
                </label>
                <select
                  id="dashboard-team"
                  value={activeTeam}
                  onChange={(e) => setActiveTeam(e.target.value)}
                  className={selectBase}
                >
                  {TEAMS.map((team) => (
                    <option key={team.key} value={team.key}>
                      {team.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex w-[min(20rem,100%)] flex-col gap-1.5 sm:w-[13rem] sm:shrink-0">
                <label htmlFor="dashboard-project" className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted">
                  Project
                </label>
                <select
                  id="dashboard-project"
                  value={projectValue}
                  onChange={(e) => onProjectChange(e.target.value)}
                  className={selectBase}
                >
                  {projectOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              {viewTab === 'wrong' && (
                <div className="flex w-[min(20rem,100%)] flex-col gap-1.5 sm:w-[13rem] sm:shrink-0">
                  <label
                    htmlFor="dashboard-wrong-date"
                    className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-text-muted"
                  >
                    Time range
                  </label>
                  <select
                    id="dashboard-wrong-date"
                    value={wrongDateFilter}
                    onChange={(e) => setWrongDateFilter(e.target.value)}
                    className={selectBase}
                  >
                    {WRONG_DATE_FILTERS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {loading && (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="w-10 h-10 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3"></div>
              <p className="text-text-muted text-sm">Loading {teamLabel}…</p>
            </div>
          )}

          {!loading && (error || !data) && (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <p className="text-4xl mb-4">📂</p>
              <p className="text-text-secondary text-base mb-2">No data for {teamLabel}</p>
              <p className="text-text-muted text-sm max-w-md">
                <strong className="text-text-secondary font-medium">PS:</strong>{' '}
                <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node extract_ps_folder_tasks.js</code>
                {' '}then{' '}
                <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node analyze_ps_workflow.js</code>
                . <strong className="text-text-secondary font-medium">RTL:</strong>{' '}
                <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node extract_rtl_folder_tasks.js</code>
                {' '}then{' '}
                <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node analyze_rtl_workflow.js</code>
                . <strong className="text-text-secondary font-medium">AMS:</strong>{' '}
                <code className="bg-white/5 px-1 rounded text-xs">extract_ams_folder_tasks.js</code> +{' '}
                <code className="bg-white/5 px-1 rounded text-xs">extract_ams_wrong_folder_tasks.js</code>
                {' '}then <code className="bg-white/5 px-1 rounded text-xs">node analyze_ams_workflow.js</code>
                {' '}(produces{' '}
                <code className="bg-white/5 px-1 rounded text-xs">output_ams_current_*</code> and{' '}
                <code className="bg-white/5 px-1 rounded text-xs">output_ams_wrong_*</code>
                ). This view loads{' '}
                <code className="bg-white/5 px-1 rounded text-xs break-all">{fetchUrlDisplay}</code>
              </p>
            </div>
          )}

          {!loading && data && (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <Pipeline
                data={data}
                teamLabel={teamLabel}
                teamKey={activeTeam}
                viewTab={viewTab}
                wrongDateFilter={wrongDateFilter}
                psProject={psProject}
                rtlProject={rtlProject}
                amsProject={amsProject}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
