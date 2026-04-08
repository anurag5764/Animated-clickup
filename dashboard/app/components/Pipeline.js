'use client';

import { useState, useRef } from 'react';

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

const Node = ({ num, isDiamond = false, stages, onMouseEnter, onMouseLeave, sideBranch = null }) => {
  const stage = getStage(stages, num);
  const config = statusConfig[stage.status];

  if (isDiamond) {
    return (
      <div className="relative flex justify-center py-[6px] w-full animate-fade-up">
        {sideBranch === 'right' && (
          <div className="absolute left-[calc(50%+2.8rem)] top-1/2 -translate-y-1/2 w-20 border-t-2 border-dashed border-blocked/40">
            <span className="absolute bottom-0.5 left-1 text-[0.5rem] font-bold text-blocked">NO</span>
            <span className="absolute top-0.5 left-1 text-[0.45rem] text-text-muted leading-tight w-20">Debug loop</span>
          </div>
        )}
        <div 
          className="relative cursor-pointer group flex items-center justify-center w-16 h-16"
          onMouseEnter={(e) => onMouseEnter(e, stage)}
          onMouseLeave={onMouseLeave}
        >
          <div className={`absolute inset-0 w-14 h-14 m-auto transform rotate-45 border-2 transition-transform duration-300 group-hover:scale-110 ${config.card}`} />
          <span className="relative z-10 text-[0.45rem] font-medium text-center leading-tight px-1 max-w-[52px]">
             {STAGE_NAMES[num]}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex justify-center py-[5px] w-full animate-fade-up" style={{ animationDelay: `${num * 0.05}s` }}>
      <div 
        className={`relative z-10 cursor-pointer group w-44 border-2 rounded-md px-2.5 py-2 text-center transition-all duration-300 hover:-translate-y-0.5 ${config.card}`}
        onMouseEnter={(e) => onMouseEnter(e, stage)}
        onMouseLeave={onMouseLeave}
      >
        <div className="text-[0.5rem] opacity-60 uppercase tracking-widest mb-0.5 font-bold">Stage {num}</div>
        <div className="text-[0.7rem] font-semibold leading-tight">{STAGE_NAMES[num]}</div>
      </div>
    </div>
  );
};

const DiamondOnly = ({ label, sideBranch }) => (
  <div className="relative flex justify-center py-[6px] w-full">
    {sideBranch === 'left' && (
      <div className="absolute right-[calc(50%+2.8rem)] top-1/2 -translate-y-1/2 w-14 border-t-2 border-dashed border-white/20">
        <span className="absolute bottom-0.5 right-1 text-[0.5rem] font-bold text-text-muted">NO</span>
      </div>
    )}
    <div className="relative flex items-center justify-center w-16 h-16">
      <div className="absolute inset-0 w-12 h-12 m-auto transform rotate-45 border-2 border-border bg-[#111]" />
      <span className="relative z-10 text-[0.45rem] text-center px-0.5 font-medium leading-tight">{label}</span>
    </div>
  </div>
);

const DownArrow = ({ label }) => (
  <div className="relative flex flex-col items-center justify-center w-full h-4 shrink-0">
    <div className="w-0.5 h-full bg-white/30"></div>
    <div className="absolute bottom-[-1px] w-1.5 h-1.5 border-r-[1.5px] border-b-[1.5px] border-white/30 transform rotate-45 z-10"></div>
    {label && (
      <span className="absolute left-[calc(50%+5px)] top-1/2 -translate-y-1/2 text-[0.5rem] font-bold text-completed">
        {label}
      </span>
    )}
  </div>
);

const UpArrow = ({ label }) => (
  <div className="relative flex flex-col items-center justify-center w-full h-4 shrink-0">
    <div className="w-0.5 h-full bg-white/30"></div>
    <div className="absolute top-[1px] w-1.5 h-1.5 border-t-[1.5px] border-l-[1.5px] border-white/30 transform rotate-45 z-10"></div>
    {label && (
      <span className="absolute left-[calc(50%+5px)] top-1/2 -translate-y-1/2 text-[0.5rem] font-bold text-completed">
        {label}
      </span>
    )}
  </div>
);

export default function Pipeline({ stages, teamLabel = 'PS Team' }) {
  const [tooltip, setTooltip] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });
  const timeoutRef = useRef(null);

  const handleMouseEnter = (e, stage) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setTooltip(stage);
    
    const pad = 16;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    
    // Position it steadily when hovered, ensuring it doesn't overflow
    const estimatedWidth = 320; 
    const estimatedHeight = 350;

    if (x + estimatedWidth > window.innerWidth) x = e.clientX - estimatedWidth - pad;
    if (y + estimatedHeight > window.innerHeight) y = Math.max(pad, window.innerHeight - estimatedHeight - pad);
    
    setTooltipPos({ left: x, top: y });
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setTooltip(null);
    }, 200);
  };

  const handleTooltipEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const nodeProps = { stages, onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave };

  return (
    <section className="h-full w-full flex flex-col items-center justify-center p-4 overflow-hidden">
      <div className="w-full max-w-[850px] h-full flex flex-col bg-card border border-border rounded-2xl relative overflow-hidden">
        
        <h2 className="text-center text-[0.65rem] font-bold uppercase tracking-[0.15em] text-text-secondary pt-4 pb-2 shrink-0">
          {teamLabel} · Flowchart Architecture
        </h2>

        <div className="flex-1 flex items-center justify-center overflow-hidden px-4 pb-4">
          <div className="flex items-end justify-center w-full">
            
            {/* Left Column (Down) */}
            <div className="flex flex-col items-center w-48 shrink-0">
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

            {/* Middle Connector */}
            <div className="flex items-center shrink-0 w-12 lg:w-24 h-[52px]">
              <div className="w-full h-0.5 bg-white/30 relative">
                 <div className="absolute right-[1px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 border-r-[1.5px] border-t-[1.5px] border-white/30 transform rotate-45"></div>
              </div>
            </div>

            {/* Right Column (Up) */}
            <div className="flex flex-col items-center w-48 shrink-0">
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
          className="fixed z-[9999] bg-[#111] border border-white/[0.08] rounded-xl p-4 w-[320px] shadow-[0_16px_48px_rgba(0,0,0,0.6)] flex flex-col"
          style={{ left: tooltipPos.left, top: tooltipPos.top, maxHeight: 'min(350px, 90vh)' }}
          onMouseEnter={handleTooltipEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-white/[0.06] shrink-0">
            <span className={`text-[0.6rem] font-semibold tracking-wider uppercase px-2 py-0.5 rounded ${statusConfig[tooltip.status]?.badge}`}>
              {statusConfig[tooltip.status]?.icon} {tooltip.status.toUpperCase()}
            </span>
            <span className="text-xs text-text-secondary">Stage {tooltip.stageNumber}</span>
          </div>
          <div className="text-sm font-medium mb-2 leading-tight shrink-0">{STAGE_NAMES[tooltip.stageNumber]}</div>
          <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1 custom-scrollbar">
            {tooltip.tasks && tooltip.tasks.length > 0 ? (
              <>
                <div className="text-text-muted text-[0.7rem] mb-1.5 sticky top-0 bg-[#111] py-1">{tooltip.taskCount} task(s)</div>
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
