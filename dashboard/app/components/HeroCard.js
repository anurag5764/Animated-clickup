export default function HeroCard({ currentPosition }) {
  if (!currentPosition) return null;

  return (
    <section className="flex justify-center px-6 pb-10">
      <div className="max-w-[640px] w-full bg-card border border-white/[0.06] rounded-xl px-8 py-6 text-center animate-fade-up">
        <p className="text-[0.65rem] font-semibold tracking-widest uppercase text-accent mb-3">
          Current Position
        </p>
        <h2 className="text-xl font-bold text-foreground mb-1.5">
          Stage {currentPosition.stageNumber} — {currentPosition.stageName}
        </h2>
        <p className="text-text-secondary text-sm leading-relaxed">
          {currentPosition.summary}
        </p>
      </div>
    </section>
  );
}
