export type CommissionContributionType = "originator" | "qualifier" | "negotiator" | "closer";

export interface CommissionPolicyShare {
  contribution_type: CommissionContributionType;
  share_percentage: number;
}

export interface CommissionContributor {
  user_id: string;
  contribution_type: CommissionContributionType;
}

export interface CommissionAllocation {
  user_id: string;
  contribution_type: CommissionContributionType;
  share_percentage: number;
  amount: number;
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const floorMoney = (value: number) => Math.floor((value + Number.EPSILON) * 100) / 100;

export function calculateCommissionAllocations(
  commissionTotal: number,
  policyShares: CommissionPolicyShare[],
  contributors: CommissionContributor[],
): CommissionAllocation[] {
  if (!Number.isFinite(commissionTotal) || commissionTotal <= 0) {
    throw new Error("Le montant total de la prime doit être positif.");
  }
  if (!policyShares.length || !contributors.length) {
    throw new Error("Une politique et au moins un contributeur sont obligatoires.");
  }
  if (policyShares.some((rule) => !Number.isFinite(rule.share_percentage) || rule.share_percentage <= 0 || rule.share_percentage > 100)) {
    throw new Error("Chaque règle de la politique doit avoir un pourcentage compris entre 0 et 100.");
  }
  const seen = new Set<string>();
  for (const contributor of contributors) {
    const key = contributor.user_id + ":" + contributor.contribution_type;
    if (!contributor.user_id || seen.has(key)) throw new Error("Contribution dupliquée ou invalide.");
    seen.add(key);
  }
  const rules = new Map(policyShares.map((rule) => [rule.contribution_type, rule.share_percentage]));
  const roleCounts = new Map<CommissionContributionType, number>();
  for (const contributor of contributors) {
    if (!rules.has(contributor.contribution_type)) {
      throw new Error("La politique ne couvre pas tous les rôles déclarés.");
    }
    roleCounts.set(contributor.contribution_type, (roleCounts.get(contributor.contribution_type) ?? 0) + 1);
  }
  const policyTotal = policyShares.reduce((sum, rule) => sum + rule.share_percentage, 0);
  if (Math.round(policyTotal * 100) !== 10000) {
    throw new Error("Les règles de la politique doivent totaliser exactement 100 %.");
  }
  const representedShare = [...roleCounts.keys()].reduce((sum, role) => sum + (rules.get(role) ?? 0), 0);
  if (representedShare <= 0) throw new Error("Aucun pourcentage applicable.");

  // Preserve the caller's contributor order in the returned allocations.
  const base = contributors.map((contributor) => {
    const roleCount = roleCounts.get(contributor.contribution_type)!;
    const roleShare = rules.get(contributor.contribution_type)!;
    const rawAmount = (commissionTotal * roleShare) / representedShare / roleCount;
    return {
      contributor,
      roleCount,
      roleShare,
      rawAmount,
      amount: floorMoney(rawAmount),
      remainder: rawAmount - floorMoney(rawAmount),
    };
  });
  const baseTotal = roundMoney(base.reduce((sum, item) => sum + item.amount, 0));
  const remainderCents = Math.round((commissionTotal - baseTotal) * 100);
  const remainderOrder = [...base.keys()].sort((a, b) =>
    base[b].remainder - base[a].remainder ||
    base[a].contributor.contribution_type.localeCompare(base[b].contributor.contribution_type) ||
    base[a].contributor.user_id.localeCompare(base[b].contributor.user_id),
  );
  const centRecipients = new Set(remainderOrder.slice(0, remainderCents));

  return base.flatMap((item, index) => {
    const amount = roundMoney(item.amount + (centRecipients.has(index) ? 0.01 : 0));
    if (amount <= 0) return [];
    return [{
      user_id: item.contributor.user_id,
      contribution_type: item.contributor.contribution_type,
      share_percentage: (item.roleShare / representedShare) * 100 / item.roleCount,
      amount,
    }];
  });
}
