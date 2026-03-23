'use client';

import { useState } from 'react';

const STAGE_NAMES = {
  1: 'Initial Test Definition',
  2: 'Test Procedure Discussions',
  3: 'Test Procedure Creation',
  4: 'Firmware Coding',
  5: 'Automation Steps',
  6: 'Testing on Silicon',
  7: 'Results Review',
  8: 'Meets design expectations?',
  9: 'Report & Documentation',
  10: 'Feedback to Architect',
  11: 'Publish Data Sheet'
};

const statusConfig = {
  completed: {
    card: 'border-completed/40 bg-completed/[0.05] text-completed hover:border-completed',
    badge: 'bg-completed/10 text-completed',
    icon: '✅'
  },
  active: {
    card: 'border-accent bg-accent/[0.1] text-foreground shadow-[0_0_20px_rgba(255,99,33,0.15)] animate-pulse-orange',
    badge: 'bg-accent text-white',
    icon: '🔥'
  },
  blocked: {
    card: 'border-blocked/60 bg-blocked/[0.05] text-blocked hover:border-blocked',
    badge: 'bg-blocked/10 text-blocked',
    icon: '🚫'
  },
  upcoming: {
    card: 'border-white/10 bg-white/[0.02] text-text-muted hover:border-white/20',
    badge: 'bg-transparent text-text-muted',
    icon: '⏳'
  },
};

const getStage = (stages, num) => stages.find(s => s.stageNumber === num) || { stageNumber: num, status: 'upcoming', taskCount: 0, tasks: [] };

const Node = ({ num, isDiamond = false, stages, onMouseEnter, onMouseMove, onMouseLeave, sideBranch = null }) => {
  const stage = getStage(stages, num);
  const config = statusConfig[stage.status];

  if (isDiamond) {
    return (
      <div className="relative flex justify-center py-5 w-full animate-fade-up">
        {sideBranch === 'right' && (
          <div className="absolute left-[calc(50%+3.5rem)] top-1/2 -translate-y-1/2 w-24 md:w-32 border-t-2 border-dashed border-blocked/40">
            <span className="absolute bottom-1 left-2 text-[0.55rem] font-bold text-blocked">NO</span>
            <span className="absolute top-1 left-2 text-[0.55rem] text-text-muted leading-tight w-24 text-left">
              Debug with design
            </span>
          </div>
        )}

        <div 
          className="relative cursor-pointer group flex items-center justify-center w-24 h-24"
          onMouseEnter={(e) => onMouseEnter(e, stage)}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
        >
          {/* Diamond Shape */}
          <div className={`absolute inset-0 w-20 h-20 m-auto transform rotate-45 border-2 transition-transform duration-300 group-hover:scale-110 ${config.card}`} />
          {/* Text inside */}
          <span className="relative z-10 text-[0.55rem] font-medium text-center leading-tight px-1 max-w-[70px]">
             {STAGE_NAMES[num]}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex justify-center py-3 w-full animate-fade-up" style={{ animationDelay: `${num * 0.05}s` }}>
      <div 
        className={`relative z-10 cursor-pointer group w-60 border-2 rounded-lg p-3 text-center transition-all duration-300 hover:-translate-y-1 ${config.card}`}
        onMouseEnter={(e) => onMouseEnter(e, stage)}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        <div className="text-[0.6rem] opacity-60 uppercase tracking-widest mb-1 font-bold">Stage {num}</div>
        <div className="text-[0.8rem] font-semibold">{STAGE_NAMES[num]}</div>
      </div>
    </div>
  );
};

const DiamondOnly = ({ label, sideBranch }) => (
  <div className="relative flex justify-center py-5 w-full">
    {sideBranch === 'left' && (
      <div className="absolute right-[calc(50%+3.5rem)] top-1/2 -translate-y-1/2 w-16 md:w-20 border-t-2 border-dashed border-white/20">
        <span className="absolute bottom-1 right-2 text-[0.55rem] font-bold text-text-muted">NO</span>
      </div>
    )}
    <div className="relative flex items-center justify-center w-24 h-24">
      <div className="absolute inset-0 w-16 h-16 m-auto transform rotate-45 border-2 border-border bg-[#111]" />
      <span className="relative z-10 text-[0.55rem] text-center px-1 font-medium">{label}</span>
    </div>
  </div>
);

const DownArrow = ({ label }) => (
  <div className="relative flex flex-col items-center justify-center w-full h-8 shrink-0">
    <div className="w-0.5 h-full bg-border"></div>
    <div className="absolute bottom-[-2px] w-2 h-2 border-r-2 border-b-2 border-border transform rotate-45 z-10"></div>
    {label && (
      <span className="absolute left-[calc(50%+6px)] top-1/2 -translate-y-1/2 text-[0.6rem] font-bold text-completed">
        {label}
      </span>
    )}
  </div>
);

const UpArrow = ({ label }) => (
  <div className="relative flex flex-col items-center justify-center w-full h-8 shrink-0">
    <div className="w-0.5 h-full bg-border"></div>
    <div className="absolute top-[2px] w-2 h-2 border-t-2 border-l-2 border-border transform rotate-45 z-10"></div>
    {label && (
      <span className="absolute left-[calc(50%+6px)] top-1/2 -translate-y-1/2 text-[0.6rem] font-bold text-completed">
        {label}
      </span>
    )}
  </div>
);

export default function Pipeline({ stages }) {
  const [tooltip, setTooltip] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const handleMouseEnter = (e, stage) => {
    setTooltip(stage);
    updatePos(e);
  };
  const handleMouseMove = (e) => updatePos(e);
  const handleMouseLeave = () => setTooltip(null);
  
  const updatePos = (e) => {
    const pad = 16;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + 320 > window.innerWidth) x = e.clientX - 320 - pad;
    if (y + 200 > window.innerHeight) y = e.clientY - 200 - pad;
    setTooltipPos({ x, y });
  };

  const nodeProps = { stages, onMouseEnter: handleMouseEnter, onMouseMove: handleMouseMove, onMouseLeave: handleMouseLeave };

  return (
    <section className="px-4 pb-16 relative z-[1]">
      <div className="max-w-[900px] mx-auto bg-card border border-border rounded-3xl p-6 md:p-10 relative overflow-hidden">
        
        <h2 className="text-center text-xs font-bold uppercase tracking-[0.15em] text-text-secondary mb-10">
          Flowchart Architecture
        </h2>

        {/* Horizontal scroll on extra small screens to preserve U-shape */}
        <div className="w-full overflow-x-auto pb-6">
          <div className="flex items-end justify-center min-w-[700px] md:min-w-0 mx-auto w-full">
            
            {/* Left Column (Down) */}
            <div className="flex flex-col items-center w-64 shrink-0">
              <Node num={1} {...nodeProps} />
              <DownArrow />
              <Node num={2} {...nodeProps} />
              <DownArrow />
              <Node num={3} {...nodeProps} />
              <DownArrow />
              
              <DiamondOnly label="FW code required?" sideBranch="left" />
              <DownArrow label="YES" />
              <Node num={4} {...nodeProps} />
              <DownArrow />
              
              <DiamondOnly label="Automation needed?" sideBranch="left" />
              <DownArrow label="YES" />
              <Node num={5} {...nodeProps} />
            </div>

            {/* Middle Connector - Bottom Horizontal Line */}
            <div className="flex items-center shrink-0 w-16 lg:w-32 h-[88px]">
              <div className="w-full h-0.5 bg-border relative">
                 <div className="absolute right-[2px] top-1/2 -translate-y-1/2 w-2 h-2 border-r-2 border-t-2 border-border transform rotate-45"></div>
              </div>
            </div>

            {/* Right Column (Up) */}
            <div className="flex flex-col items-center w-64 shrink-0">
              <Node num={11} {...nodeProps} />
              <UpArrow />
              <Node num={10} {...nodeProps} />
              <UpArrow />
              <Node num={9} {...nodeProps} />
              <UpArrow label="YES" />
              <Node num={8} isDiamond={true} sideBranch="right" {...nodeProps} />
              <UpArrow />
              <Node num={7} {...nodeProps} />
              <UpArrow />
              <Node num={6} {...nodeProps} />
            </div>

          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-[9999] bg-[#111] border border-white/[0.08] rounded-xl p-4 max-w-[320px] min-w-[220px] pointer-events-none shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/[0.06]">
            <span className={`text-[0.6rem] font-semibold tracking-wider uppercase px-2 py-0.5 rounded ${statusConfig[tooltip.status]?.badge}`}>
              {statusConfig[tooltip.status]?.icon} {tooltip.status.toUpperCase()}
            </span>
            <span className="text-xs text-text-secondary">Stage {tooltip.stageNumber}</span>
          </div>
          <div className="text-sm font-medium mb-2 leading-tight">{STAGE_NAMES[tooltip.stageNumber]}</div>
          <div className="text-xs text-text-secondary">
            {tooltip.tasks && tooltip.tasks.length > 0 ? (
              <>
                <div className="text-text-muted text-[0.7rem] mb-1.5">{tooltip.taskCount} task(s)</div>
                {tooltip.tasks.map((t, ti) => (
                  <div key={ti} className={`py-1.5 ${ti < tooltip.tasks.length - 1 ? 'border-b border-white/[0.04]' : ''}`}>
                    <div className="text-foreground/90 font-medium text-[0.78rem]">{t.name}</div>
                    <div className="text-accent-soft/80 text-[0.7rem] mt-0.5">{t.assignee}</div>
                  </div>
                ))}
              </>
            ) : (
              <div className="text-text-muted mt-1">No tasks in this stage.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
