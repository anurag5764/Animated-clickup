const STAGE_ICONS = ['📝','💬','🔧','💾','⚙️','🧪','🔍','✅','📄','🔁','📊'];
const STAGE_NAMES = [
  'Initial Test Definition',
  'Test Procedure Discussions',
  'Test Procedure Creation',
  'Firmware Coding',
  'Automation Steps',
  'Testing on Silicon',
  'Results Review',
  'Design Expectations Check',
  'Report & Documentation',
  'Feedback to Architect',
  'Publish Data Sheet'
];

const statusBorder = {
  active: 'border-l-4 border-l-accent',
  blocked: 'border-l-4 border-l-blocked',
  completed: 'border-l-4 border-l-completed',
  upcoming: 'border-l-4 border-l-[#3B3B3B]',
};

export default function StageCards({ stages }) {
  const activeStages = stages.filter(s => s.taskCount > 0);

  if (activeStages.length === 0) {
    return (
      <section className="px-10 pb-14 relative z-[1]">
        <h2 className="text-center text-sm font-semibold uppercase tracking-[0.1em] text-text-secondary mb-7">Active Stages</h2>
        <p className="text-center text-text-muted">No active stages with tasks.</p>
      </section>
    );
  }

  return (
    <section className="px-10 pb-14 relative z-[1]">
      <h2 className="text-center text-sm font-semibold uppercase tracking-[0.1em] text-text-secondary mb-7">Active Stages</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-[1100px] mx-auto">
        {activeStages.map((stage, i) => {
          const idx = stage.stageNumber - 1;
          return (
            <div
              key={stage.stageNumber}
              className={`bg-card backdrop-blur-2xl border border-border rounded-2xl p-6 transition-all duration-300 hover:-translate-y-0.5 hover:border-accent-dim hover:shadow-[0_8px_32px_rgba(255,99,33,0.08)] animate-fade-up ${statusBorder[stage.status] || ''}`}
              style={{ animationDelay: `${0.15 + i * 0.1}s` }}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-[0.95rem] font-semibold">
                  {STAGE_ICONS[idx]} Stage {stage.stageNumber}: {STAGE_NAMES[idx]}
                </span>
                <span className="bg-accent-dim text-accent text-xs font-bold px-2.5 py-0.5 rounded-full">
                  {stage.taskCount} task{stage.taskCount > 1 ? 's' : ''}
                </span>
              </div>

              {/* Tasks */}
              {stage.tasks.map((t, ti) => (
                <div key={ti} className={`py-2.5 ${ti < stage.tasks.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="text-sm font-medium text-foreground mb-0.5">{t.name}</div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-accent-soft">👤 {t.assignee}</span>
                    {t.detail && <span className="text-text-muted italic">{t.detail}</span>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
