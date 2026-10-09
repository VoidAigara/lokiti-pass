import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-display text-[11px] font-semibold uppercase tracking-wider",
  {
    variants: {
      variant: {
        default: "border-magic/40 bg-magic/10 text-magic-dark",
        success: "border-emerald-400/40 bg-emerald-500/10 text-emerald-700",
        warning: "border-amber-400/40 bg-amber-500/10 text-amber-700",
        danger: "border-red-400/40 bg-red-500/10 text-red-600",
        muted: "border-line bg-soft text-faint",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
