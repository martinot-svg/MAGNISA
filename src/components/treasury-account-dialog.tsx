"use client";

import { FinancialAccountCreationFields } from "@/components/financial-account-creation-fields";
import { FormDialog } from "@/components/form-dialog";

export function TreasuryAccountDialog({
  createAccount,
}: {
  createAccount: (data: FormData) => Promise<void>;
}) {
  return (
    <FormDialog title="Nouveau compte" buttonLabel="+ Nouveau compte">
      <form action={createAccount} className="form">
        <p className="muted">
          Le solde n'est jamais saisi manuellement : il évolue uniquement par les opérations enregistrées.
        </p>
        <FinancialAccountCreationFields />
      </form>
    </FormDialog>
  );
}
