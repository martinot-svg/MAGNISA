"use client";

import type { ReactNode } from "react";
import { FormDialog } from "@/components/form-dialog";

export function CalendarRuleDialog({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <FormDialog title={title} buttonLabel="+ Ajouter une nouvelle règle">
      {children}
    </FormDialog>
  );
}
