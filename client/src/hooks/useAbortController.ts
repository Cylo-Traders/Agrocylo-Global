import { useEffect, useState } from "react";

export function useAbortController(): AbortController {
  const [controller] = useState(() => new AbortController());

  useEffect(() => {
    return () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };
  }, [controller]);

  return controller;
}
