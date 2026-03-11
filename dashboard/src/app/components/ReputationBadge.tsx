const TIERS: Record<string, { label: string; color: string }> = {
  platinum: { label: 'Pt', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  gold: { label: 'Au', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  silver: { label: 'Ag', color: 'bg-gray-400/20 text-gray-300 border-gray-400/30' },
  bronze: { label: 'Cu', color: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  unverified: { label: '?', color: 'bg-gray-700/20 text-gray-500 border-gray-600/30' },
};

function getTier(score?: number): string {
  if (!score) return 'unverified';
  if (score >= 0.9) return 'platinum';
  if (score >= 0.7) return 'gold';
  if (score >= 0.5) return 'silver';
  if (score >= 0.3) return 'bronze';
  return 'unverified';
}

export function ReputationBadge({ score, tier }: { score?: number; tier?: string }) {
  const t = tier || getTier(score);
  const config = TIERS[t] || TIERS.unverified;
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded text-[9px] font-bold border ${config.color}`}
      title={`Reputation: ${score?.toFixed(2) || 'N/A'} (${t})`}
    >
      {config.label}
    </span>
  );
}
