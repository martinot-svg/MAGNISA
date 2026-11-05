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
  const policyTotal = policyShares.reduce((sum, rule) => sum + rule.share_percentage, 0);
  if (Math.round(policyTotal * 100) !== 10000) {
    throw new Error("Les règles de la politique doivent totaliser exactement 100 %.");
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
  const representedShare = [...roleCounts.keys()].reduce((sum, role) => sum + (rules.get(role) ?? 0), 0);
  if (representedShare <= 0) throw new Error("Aucun pourcentage applicable.");

  const ordered = [...contributors].sort((a, b) =>
    a.contribution_type.localeCompare(b.contribution_type) || a.user_id.localeCompare(b.user_id),
  );
  let allocated = 0;
  return ordered.map((contributor, index) => {
    const roleCount = roleCounts.get(contributor.contribution_type)!;
    const roleShare = rules.get(contributor.contribution_type)!;
    const share = (roleShare / representedShare) * 100 / roleCount;
    const amount = index === ordered.length - 1
      ? roundMoney(commissionTotal - allocated)
      : floorMoney((commissionTotal * roleShare) / representedShare / roleCount);
    allocated = roundMoney(allocated + amount);
    return {
      user_id: contributor.user_id,
      contribution_type: contributor.contribution_type,
      share_percentage: share,
      amount,
    };
  });
}
