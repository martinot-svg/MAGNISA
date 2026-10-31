import { describe, expect, it } from "vitest";
import { estimateOrangeMoneyFee, estimateMobileMoneyTransferFee, calculateMobileMoneyTransfer, estimateOrangeMoneyInactivityFee, ORANGE_MONEY_ACCOUNT_BALANCE_LIMIT, ORANGE_MONEY_DEPOSIT_REQUIRES_ACCOUNT_HOLDER, ORANGE_MONEY_PHONE_NOT_IN_HOLDER_POSSESSION_FEE_STATUS } from "./mobile-money-tariffs";

describe("barème Orange Money Madagascar au 01-02-2025", () => {
 it("calcule les frais de dépôt selon les tranches fournies", () => {
  expect(estimateOrangeMoneyFee("deposit", 200)).toBe(100);
  expect(estimateOrangeMoneyFee("deposit", 1_000)).toBe(100);
  expect(estimateOrangeMoneyFee("deposit", 1_001)).toBe(150);
  expect(estimateOrangeMoneyFee("deposit", 10_000_000)).toBe(53_900);
  expect(estimateOrangeMoneyFee("deposit", 10_000_001)).toBeNull();
 });
 it("calcule les frais de retrait et de transfert", () => {
  expect(estimateOrangeMoneyFee("withdrawal", 1_000)).toBe(65);
  expect(estimateOrangeMoneyFee("withdrawal", 10_000_000)).toBe(15_700);
  expect(estimateOrangeMoneyFee("transfer_orange", 5_500_000)).toBeNull();
  expect(estimateOrangeMoneyFee("transfer_other_network", 5_500_000)).toBe(21_000);
  expect(estimateOrangeMoneyFee("transfer_microfinance", 5_500_000)).toBe(38_000);
 });
 it("gère IzyCash et les autres opérations", () => {
  expect(estimateOrangeMoneyFee("izy_cash", 500)).toBe(100);
  expect(estimateOrangeMoneyFee("izy_cash", 1_000_001)).toBeNull();
  expect(estimateOrangeMoneyFee("orange_bill_payment", 2_000_000)).toBe(500);
  expect(estimateOrangeMoneyFee("buy_bundle", 2_000_000)).toBe(0);
 });
 it("conserve les plafonds et règles complémentaires du compte", () => {
  expect(ORANGE_MONEY_ACCOUNT_BALANCE_LIMIT).toBe(20_000_000);
  expect(ORANGE_MONEY_DEPOSIT_REQUIRES_ACCOUNT_HOLDER).toBe(true);
  expect(ORANGE_MONEY_PHONE_NOT_IN_HOLDER_POSSESSION_FEE_STATUS).toBe("amount_not_specified_in_source");
  expect(estimateOrangeMoneyInactivityFee(5)).toBeNull();
  expect(estimateOrangeMoneyInactivityFee(6)).toBe(2_000);
  expect(estimateOrangeMoneyInactivityFee(12)).toBe(4_000);
  expect(estimateOrangeMoneyInactivityFee(18)).toBe(6_000);
 });
 it("ne choisit pas arbitrairement entre les deux règles contradictoires de paiement marchand", () => {
  expect(estimateOrangeMoneyFee("merchant_payment", 50_000)).toBeNull();
 });
 it("reconnaît les dépôts depuis une caisse vers un compte Orange Money", () => {
  expect(estimateMobileMoneyTransferFee("orange_money",
   { type: "cash", name: "Caisse" },
   { type: "mobile_money", name: "Orange Money", category: "merchant" }, 50_000,
  )).toBe(1_300);
  expect(calculateMobileMoneyTransfer("orange_money",
   { type: "cash", name: "Caisse" },
   { type: "mobile_money", name: "Orange Money", category: "merchant" }, 50_000, "added",
  )).toEqual({ fee: 1_300, debit: 51_300, credit: 50_000 });
 });
 it("distingue transfert Orange, autre réseau et microfinance", () => {
  const source = { type: "mobile_money", name: "Orange Money" };
  expect(estimateMobileMoneyTransferFee("orange_money", source, { type: "mobile_money", name: "Orange Money" }, 10_000)).toBe(300);
  expect(estimateMobileMoneyTransferFee("orange_money", source, { type: "mobile_money", name: "MVola" }, 10_000)).toBe(250);
  expect(estimateMobileMoneyTransferFee("orange_money", source, { type: "bank", name: "Institution Microfinance" }, 10_000)).toBe(450);
 });
});
