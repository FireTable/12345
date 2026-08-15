import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-cyan-600 text-white shadow hover:bg-cyan-500",
        secondary: "border-slate-700 bg-slate-800 text-slate-300",
        destructive: "border-rose-500/40 bg-rose-500/20 text-rose-300",
        warning: "border-amber-500/40 bg-amber-500/20 text-amber-300",
        success: "border-emerald-500/30 bg-emerald-500/20 text-emerald-300",
        outline: "text-slate-300 border-slate-700",
        cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
        purple: "border-purple-500/30 bg-purple-500/10 text-purple-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
