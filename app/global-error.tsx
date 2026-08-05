"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("FinMonitor global error:", error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body className="flex min-h-screen items-center justify-center bg-[#0B0E14] p-6 text-[#E6E9F0]">
        <div className="max-w-md rounded-xl border border-[#1E2532] bg-[#11151F] p-6 text-center">
          <p className="text-lg font-bold">Algo deu errado</p>
          <p className="mt-2 text-sm text-[#8B93A7]">
            Um erro inesperado aconteceu. Seus dados estão seguros no snapshot local.
          </p>
          <button
            onClick={reset}
            className="mt-4 rounded-lg bg-[#6366F1] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
