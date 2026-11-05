import { describe, expect, it } from "vitest";
import { calculateCommissionAllocations } from "../src/lib/commission-allocation";

const policy = [
  { contribution_type: "originator" as const, share_percentage: 40 },
  { contribution_type: "qualifier" as const, share_percentage: 10 },
  { contribution_type: "negotiator" as const, share_percentage: 25 },
  { contribution_type: "closer" as const, share_percentage: 25 },
];

describe("calculateCommissionAllocations", () => {
  it("redistributes absent roles proportionally and preserves the total", () => {
    const allocations = calculateCommissionAllocations(100000, policy, [
      { user_id: "u1", contribution_type: "originator" },
      { user_id: "u2", contribution_type: "qualifier" },
      { user_id: "u3", contribution_type: "closer" },
    ]);
    expect(allocations.reduce((sum, item) => sum + item.amount, 0)).toBe(100000);
    expect(allocations.map((item) => item.amount)).toEqual([53333.33, 13333.33, 33333.34]);
  });

  it("splits one role equally among several contributors", () => {
    const allocations = calculateCommissionAllocations(1000, policy, [
      { user_id: "u1", contribution_type: "originator" },
      { user_id: "u2", contribution_type: "originator" },
      { user_id: "u3", contribution_type: "closer" },
    ]);
    expect(allocations.reduce((sum, item) => sum + item.amount, 0)).toBe(1000);
    expect(allocations.filter((item) => item.contribution_type === "originator").map((item) => item.amount))
      .toEqual([307.69, 307.69]);
    expect(allocations.find((item) => item.contribution_type === "closer")?.amount).toBe(384.62);
  });

  it("rejects policies that do not total 100 percent", () => {
    expect(() => calculateCommissionAllocations(100, policy.slice(1), [
      { user_id: "u1", contribution_type: "qualifier" },
    ])).toThrow("totaliser exactement 100 %");
  });

  it("rejects contributors whose role is absent from the policy", () => {
    expect(() => calculateCommissionAllocations(100, policy.slice(0, 1), [
      { user_id: "u1", contribution_type: "closer" },
    ])).toThrow("ne couvre pas tous les rôles");
  });

  it("rejects duplicate contribution entries", () => {
    expect(() => calculateCommissionAllocations(100, policy, [
      { user_id: "u1", contribution_type: "originator" },
      { user_id: "u1", contribution_type: "originator" },
    ])).toThrow("dupliquée");
  });
});
