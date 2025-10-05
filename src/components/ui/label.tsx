import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
  {
    variants: {
      muted: {
        true: "text-muted-foreground",
        false: "text-[var(--text)]",
      },
    },
    defaultVariants: {
      muted: false,
    },
  }
);

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement>,
    VariantProps<typeof labelVariants> {}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, muted, ...props }, ref) => (
    <label ref={ref} className={cn(labelVariants({ muted }), className)} {...props} />
  )
);
Label.displayName = "Label";

export { Label };


