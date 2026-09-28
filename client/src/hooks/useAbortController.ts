import { useEffect, useRef } from "react";

export function useAbortController(): AbortController {
  const controllerRef = useRef<AbortController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new AbortController();
  }

  useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
    };
  }, []);

  return controllerRef.current;
}
