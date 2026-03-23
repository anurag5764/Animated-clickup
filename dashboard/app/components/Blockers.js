const severityConfig = {
  high: {
    card: 'bg-blocked-dim border border-blocked/20 hover:border-blocked hover:shadow-[0_4px_20px_rgba(239,68,68,0.3)]',
    icon: '🔴',
    badge: 'bg-blocked-dim text-blocked',
  },
  medium: {
    card: 'bg-warning-dim border border-warning/20 hover:border-warning hover:shadow-[0_4px_20px_rgba(245,158,11,0.15)]',
    icon: '🟡',
    badge: 'bg-warning-dim text-warning',
  },
  low: {
    card: 'bg-white/[0.03] border border-border hover:border-white/10',
    icon: '⚪',
    badge: 'bg-white/[0.06] text-text-muted',
  },
};

export default function Blockers({ blockers }) {
  if (!blockers || blockers.length === 0) return null;

  return (
    <section className="px-10 pb-14 relative z-[1]">
      <h2 className="text-center text-sm font-semibold uppercase tracking-[0.1em] text-blocked mb-7">
        ⚠️ Blockers
      </h2>
      <div className="max-w-[800px] mx-auto flex flex-col gap-3.5">
        {blockers.map((b, i) => {
          const config = severityConfig[b.severity] || severityConfig.medium;
          return (
            <div
              key={i}
              className={`rounded-xl p-[18px_22px] flex items-start gap-3.5 transition-all duration-300 animate-fade-right ${config.card}`}
              style={{ animationDelay: `${0.2 + i * 0.12}s` }}
            >
              <span className="text-xl shrink-0 mt-0.5">{config.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[0.9rem] font-semibold text-foreground mb-1">{b.task}</div>
                <div className="text-[0.8rem] text-text-secondary leading-relaxed">{b.reason}</div>
              </div>
              <span className={`text-[0.6rem] font-bold uppercase tracking-[0.1em] px-2 py-0.5 rounded shrink-0 ${config.badge}`}>
                {b.severity}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
