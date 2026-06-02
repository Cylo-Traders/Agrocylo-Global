import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface WrapperProps extends React.ComponentProps<"section"> {
  max2?: boolean;
}

const Wrapper = forwardRef<HTMLElement, WrapperProps>(
  ({ children, className, max2, ...props }, ref) => {
    return (
      <section
        ref={ref}
        className={cn("mx-auto w-full max-w-[1240px] px-4 sm:px-6 lg:px-8", className, {
          "max-w-[1360px]": max2,
        })}
        {...props}
      >
        {children}
      </section>
    );
  },
);

Wrapper.displayName = "Wrapper";

export default Wrapper;
