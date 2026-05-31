"use client";

import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldBase {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
}

type InputFieldProps = FormFieldBase &
  InputHTMLAttributes<HTMLInputElement> & {
    as?: "input";
  };

type SelectFieldProps = FormFieldBase &
  SelectHTMLAttributes<HTMLSelectElement> & {
    as: "select";
    options: { value: string; label: string }[];
  };

type TextareaFieldProps = FormFieldBase &
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    as: "textarea";
  };

type FormFieldProps = InputFieldProps | SelectFieldProps | TextareaFieldProps;

export const FormField = forwardRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, FormFieldProps>(
  (props, ref) => {
    const { label, hint, error, required, className, as = "input", ...rest } = props;

    const baseInputClasses =
      "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50";

    return (
      <div className="grid gap-1.5">
        {label && (
          <Label>
            {label}
            {required && <span className="text-destructive ml-0.5">*</span>}
          </Label>
        )}

        {as === "select" ? (
          <select
            ref={ref as React.Ref<HTMLSelectElement>}
            className={cn(baseInputClasses, error && "border-destructive", className)}
            {...(rest as SelectHTMLAttributes<HTMLSelectElement>)}
          >
            {(props as SelectFieldProps).options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : as === "textarea" ? (
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            className={cn(
              baseInputClasses,
              "min-h-[80px] resize-y py-2",
              error && "border-destructive",
              className,
            )}
            {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          />
        ) : (
          <input
            ref={ref as React.Ref<HTMLInputElement>}
            className={cn(baseInputClasses, error && "border-destructive", className)}
            {...(rest as InputHTMLAttributes<HTMLInputElement>)}
          />
        )}

        {hint && !error && (
          <p className="text-muted-foreground text-xs">{hint}</p>
        )}

        {error && (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);

FormField.displayName = "FormField";
