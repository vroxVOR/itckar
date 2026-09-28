export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className={`brand${compact ? " brand-compact" : ""}`}>
    <svg className="brand-symbol" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="10" fill="currentColor" />
      <path d="M10 8v4M22 8v4M9 15h14" stroke="#d9edb0" strokeWidth="2" strokeLinecap="round" />
      <path d="m11 21 3 3 7-7" stroke="#d9edb0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span>itckar<span className="brand-dot">.</span></span>
  </span>;
}
