export interface FunnelCounts {
  prospects: number;
  converted: number;
}

export function conversionRate(counts: FunnelCounts): number {
  if (counts.prospects < 0 || counts.converted < 0 || counts.converted > counts.prospects) {
    throw new Error("Invalid funnel counts");
  }
  return counts.prospects === 0 ? 0 : Math.round((counts.converted / counts.prospects) * 10000) / 100;
}
