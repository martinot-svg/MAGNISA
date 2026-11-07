"use client";

import { useState } from "react";
import { PayrollRulePreview } from "@/components/payroll-rule-preview";

type PreviewRule = {
  id: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
  status: string;
  cnaps_employee_rate: number;
  cnaps_employer_rate: number;
  health_employee_rate: number;
  health_employer_rate: number;
  fmfp_employer_rate: number;
  cnaps_monthly_ceiling: number | null;
  health_monthly_ceiling: number | null;
  irsa_health_deduction_rate: number;
  irsa_pension_deduction_rate: number;
  irsa_brackets: unknown;
  irsa_minimum: number | null;
  irsa_dependant_reduction: number;
  irsa_dependant_threshold: number;
  rounding_policy: string | null;
  legal_reference: string | null;
  smie_partner_name?: string | null;
};

export function PayrollRulePreviewToggle({
  rules,
  currency,
  companyName,
  defaultSmie,
}: {
  rules: PreviewRule[];
  currency: string;
  companyName: string;
  defaultSmie: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        className="button primary"
        aria-expanded={open}
        aria-controls="payroll-settings-preview"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Masquer la prévisualisation" : "Prévisualiser les paramètres"}
      </button>
      {open && (
        <div
          id="payroll-settings-preview"
          className="card"
          style={{
            position: "absolute",
            zIndex: 50,
            top: "calc(100% + 10px)",
            right: 0,
            width: "min(900px, calc(100vw - 32px))",
            maxHeight: "80vh",
            overflowY: "auto",
            padding: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,.18)",
          }}
        >
          <PayrollRulePreview
            rules={rules}
            currency={currency}
            companyName={companyName}
            defaultSmie={defaultSmie}
          />
        </div>
      )}
    </div>
  );
}
