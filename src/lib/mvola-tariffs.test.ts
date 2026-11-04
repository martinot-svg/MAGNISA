import { describe, expect, it } from "vitest";
import { calculateMvolaTransfer, classifyMvolaTransfer, estimateMvolaFee } from "./mvola-tariffs";

describe("classification des transferts MVola", () => {
  it("distingue MVola vers MVola du transfert vers un autre opérateur", () => {
    expect(classifyMvolaTransfer(
      { type: "mobile_money", name: "MVola", category: "personal" },
      { type: "mobile_money", name: "MVola", category: "personal" },
    )).toBe("transfer_mvola");
    expect(classifyMvolaTransfer(
      { type: "mobile_money", name: "MVola", category: "personal" },
      { type: "mobile_money", name: "Orange Money", category: "personal" },
    )).toBe("transfer_other_operator");
  });

  it("applique le tarif entreprise seulement à un compte MVola source entreprise", () => {
    expect(classifyMvolaTransfer(
      { type: "mobile_money", name: "MVola", category: "business" },
      { type: "mobile_money", name: "MVola", category: "personal" },
    )).toBe("enterprise_transfer");
  });

  it("ne déduit aucun tarif MVola quand le fournisseur source est un autre opérateur", () => {
    expect(classifyMvolaTransfer(
      { type: "mobile_money", name: "Orange Money", category: "personal" },
      { type: "mobile_money", name: "MVola", category: "personal" },
    )).toBeNull();
  });

  it("reconnaît retrait vers caisse et dépôt depuis caisse", () => {
    expect(classifyMvolaTransfer(
      { type: "mobile_money", name: "MVola" },
      { type: "cash", name: "Caisse principale" },
    )).toBe("withdrawal");
    expect(classifyMvolaTransfer(
      { type: "cash", name: "Caisse principale" },
      { type: "mobile_money", name: "MVola" },
    )).toBe("deposit");
  });
});

describe("barème et limites des tranches", () => {
  it.each([
    [100, 70],
    [1000, 70],
    [1001, 70],
    [5000, 70],
    [5001, 150],
    [10000, 150],
    [10001, 250],
  ])("calcule le frais transfert MVola pour %i MGA", (amount, fee) => {
    expect(estimateMvolaFee("transfer_mvola", amount)).toBe(fee);
  });

  it("calcule un transfert frais inclus exactement à une limite de tranche", () => {
    expect(calculateMvolaTransfer("transfer_mvola", 1071, "included")).toEqual({
      fee: 70,
      debit: 1071,
      credit: 1001,
    });
  });

  it("calcule un transfert frais ajoutés sur le montant net demandé", () => {
    expect(calculateMvolaTransfer("transfer_mvola", 1001, "added")).toEqual({
      fee: 70,
      debit: 1071,
      credit: 1001,
    });
  });

  it("respecte le minimum de 300 MGA pour un transfert interopérateur", () => {
    expect(estimateMvolaFee("transfer_other_operator", 299)).toBeNull();
    expect(estimateMvolaFee("transfer_other_operator", 300)).toBe(200);
  });

  it("bloque les transferts Entreprise au-delà du plafond officiel de 100 millions", () => {
    expect(estimateMvolaFee("enterprise_transfer", 100_000_000)).toBe(99_000);
    expect(estimateMvolaFee("enterprise_transfer", 100_000_001)).toBeNull();
    expect(calculateMvolaTransfer("enterprise_transfer", 100_000_001, "added")).toBeNull();
  });

  it("refuse un tarif absent au lieu de traiter un tiret comme zéro", () => {
    expect(estimateMvolaFee("transfer_other_operator", 5_500_000)).toBeNull();
    expect(calculateMvolaTransfer("transfer_other_operator", 5_500_000, "added")).toBeNull();
  });
});
