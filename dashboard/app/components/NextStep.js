export default function NextStep({ nextStep }) {
  if (!nextStep) return null;

  return (
    <section className="px-10 pb-14 flex justify-center relative z-[1]">
      <div className="max-w-[700px] w-full bg-card backdrop-blur-2xl border border-completed/20 rounded-2xl py-7 px-9 text-center animate-fade-up" style={{ animationDelay: '0.3s' }}>
        <div className="text-[0.7rem] font-bold tracking-[0.12em] uppercase text-completed mb-2.5">
          ➡️ NEXT STEP
        </div>
        <p className="text-[1.05rem] text-foreground leading-relaxed">
          {nextStep}
        </p>
      </div>
    </section>
  );
}
