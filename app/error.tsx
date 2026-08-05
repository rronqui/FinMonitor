"use client";

import { ErrorState } from "@/src/components/ui";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState message={error.message || "Erro inesperado nesta página."} onRetry={reset} />;
}
