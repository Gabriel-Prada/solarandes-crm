// Un sol simple: círculo y rayos. Sin imágenes externas.
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  const rayos = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <circle cx="24" cy="24" r="9" className="fill-amber-500" />
      {rayos.map((angulo) => (
        <line
          key={angulo}
          x1="24"
          y1="6"
          x2="24"
          y2="11"
          strokeWidth="3"
          strokeLinecap="round"
          className="stroke-amber-500"
          transform={`rotate(${angulo} 24 24)`}
        />
      ))}
    </svg>
  );
}
