"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  LoaderCircle,
  Plug,
  TrendingUp,
} from "lucide-react";
import { useSyncMeta } from "@/src/lib/hooks";

const links = [
  { href: "/", label: "Visão Geral", icon: LayoutDashboard },
  { href: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { href: "/cartoes", label: "Cartões", icon: CreditCard },
  { href: "/investimentos", label: "Investimentos", icon: TrendingUp },
  { href: "/emprestimos", label: "Empréstimos", icon: HandCoins },
  { href: "/conexoes", label: "Conexões", icon: Plug },
];

function timeAgo(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return `há ${h} h`;
}

function SyncChip() {
  const meta = useSyncMeta();
  if (meta.data?.syncing) {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-muted">
        <LoaderCircle size={10} className="animate-spin" /> Sincronizando…
      </span>
    );
  }
  if (meta.isError) return <span className="text-[10px] text-neg" title={meta.error.message}>Falha ao consultar sync</span>;
  if (!meta.data?.syncedAt) return <span className="text-[10px] text-muted">Primeira sincronização…</span>;
  return (
    <span className="text-[10px] text-muted" title={meta.data?.lastError || undefined}>
      Atualizado {timeAgo(meta.data.syncedAt)}
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile top nav */}
      <nav className="fixed inset-x-0 top-0 z-40 flex items-center gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2 md:hidden">
        <span className="mr-2 whitespace-nowrap text-sm font-bold text-primary">FinMonitor</span>
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                active ? "bg-primary/20 text-primary" : "text-muted hover:bg-surface2 hover:text-text"
              }`}
            >
              <Icon size={14} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 flex-col border-r border-border bg-surface md:flex">
        <div className="px-5 py-6">
          <p className="text-lg font-bold text-primary">FinMonitor</p>
          <p className="mt-0.5 text-xs text-muted">Open Finance pessoal</p>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-primary/20 text-primary" : "text-muted hover:bg-surface2 hover:text-text"
                }`}
              >
                <Icon size={17} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-col gap-1 px-5 py-4">
          <SyncChip />
          <p className="text-[10px] text-muted">Dados via Banco MCP · uso local</p>
        </div>
      </aside>
    </>
  );
}
