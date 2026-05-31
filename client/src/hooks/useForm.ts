"use client";

import { useCallback, useState } from "react";

type ValidationErrors<T> = Partial<Record<keyof T, string>>;

interface UseFormOptions<T extends Record<string, unknown>> {
  initialValues: T;
  validate?: (values: T) => ValidationErrors<T> | null;
  onSubmit: (values: T) => Promise<void> | void;
}

interface UseFormReturn<T extends Record<string, unknown>> {
  values: T;
  errors: ValidationErrors<T>;
  touched: Partial<Record<keyof T, boolean>>;
  isSubmitting: boolean;
  submitError: string | null;
  setValue: (key: keyof T, value: T[keyof T]) => void;
  setTouched: (key: keyof T) => void;
  setErrors: (errors: ValidationErrors<T>) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  reset: (values?: T) => void;
  isValid: boolean;
}

export function useForm<T extends Record<string, unknown>>({
  initialValues,
  validate,
  onSubmit,
}: UseFormOptions<T>): UseFormReturn<T> {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrorsState] = useState<ValidationErrors<T>>({});
  const [touched, setTouchedState] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const setValue = useCallback((key: keyof T, value: T[keyof T]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrorsState((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return prev;
    });
  }, []);

  const setTouched = useCallback((key: keyof T) => {
    setTouchedState((prev) => ({ ...prev, [key]: true }));
  }, []);

  const setErrors = useCallback((newErrors: ValidationErrors<T>) => {
    setErrorsState(newErrors);
  }, []);

  const reset = useCallback(
    (values?: T) => {
      setValues(values ?? initialValues);
      setErrorsState({});
      setTouchedState({});
      setSubmitError(null);
    },
    [initialValues],
  );

  const isValid = Object.keys(errors).length === 0;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitError(null);

      if (validate) {
        const validationErrors = validate(values);
        if (validationErrors && Object.keys(validationErrors).length > 0) {
          setErrorsState(validationErrors);
          setTouchedState(
            Object.keys(validationErrors).reduce(
              (acc, key) => ({ ...acc, [key]: true }),
              {} as Partial<Record<keyof T, boolean>>,
            ),
          );
          return;
        }
      }

      setIsSubmitting(true);
      try {
        await onSubmit(values);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "An unexpected error occurred";
        setSubmitError(msg);
      } finally {
        setIsSubmitting(false);
      }
    },
    [values, validate, onSubmit],
  );

  return {
    values,
    errors,
    touched,
    isSubmitting,
    submitError,
    setValue,
    setTouched,
    setErrors,
    handleSubmit,
    reset,
    isValid,
  };
}
