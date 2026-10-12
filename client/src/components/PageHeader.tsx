import type { ReactNode } from "react";

/** Every page uses this container so widths and gutters match across routes. */
export const PAGE_CLASS = "p-4 sm:p-6 space-y-4 max-w-[1600px] mx-auto";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap pb-4 border-b border-border">
      <h1 className="font-display text-[32px] leading-none" data-testid="page-title">{title}</h1>
      {children && <div className="flex items-center gap-2 flex-wrap print:hidden">{children}</div>}
    </div>
  );
}
