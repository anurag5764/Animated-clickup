'use client';

import { useState, useEffect } from 'react';
import Pipeline from './components/Pipeline';
import HeroCard from './components/HeroCard';
import Blockers from './components/Blockers';
import NextStep from './components/NextStep';

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/output.json')
      .then(res => {
        if (!res.ok) throw new Error('output.json not found');
        return res.json();
      })
      .then(json => {
        setData(json);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="w-10 h-10 border-2 border-accent/30 border-t-accent rounded-full animate-spin mb-3"></div>
        <p className="text-text-muted text-sm">Loading analysis...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-6">
        <p className="text-text-secondary text-base mb-2">No analysis data found</p>
        <p className="text-text-muted text-sm">
          Run <code className="bg-white/5 px-1.5 py-0.5 rounded text-accent text-xs">node analyze_workflow.js</code> first.
        </p>
      </div>
    );
  }

  return (
    <main className="relative min-h-screen max-w-[1200px] mx-auto">
      {/* Header */}
      <header className="text-center pt-12 pb-8 px-6">
        <h1 className="text-2xl font-bold text-foreground tracking-tight">
          PS Team Workflow Tracker
        </h1>
        <p className="mt-1 text-text-muted text-sm">
          Workflow analysis · {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </header>

      {/* Hero - Current Position */}
      <HeroCard currentPosition={data.currentPosition} />

      {/* Pipeline */}
      <Pipeline stages={data.stages} />

      {/* Blockers */}
      <Blockers blockers={data.blockers} />

      {/* Next Step */}
      <NextStep nextStep={data.nextStep} />

      {/* Footer */}
      <footer className="text-center py-8 text-text-muted text-[0.7rem]">
        ClickUp API · OpenRouter AI
      </footer>
    </main>
  );
}
