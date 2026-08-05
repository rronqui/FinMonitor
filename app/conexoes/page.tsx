"use client";

import { useEffect, useState } from "react";
import { Plug, RefreshCw, Trash2 } from "lucide-react";
import type { BankConnection } from "@/src/banco-mcp";
import { Badge, Card, EmptyState, ErrorState, PageHeader, connectionStatusBadge } from "@/src/components/ui";
import { dateTimeBR } from "@/src/lib/format";
import { useConnections, useDisconnect, useSync } from "@/src/lib/hooks";

function ConnectionRow({ conn, onRemoved }: { conn: BankConnection; onRemoved: () => void }) {
  const sync = useSync();
  const disconnect = useDisconnect();
  const [confirming, setConfirming] = useState(false);
  const status = connectionStatusBadge(conn.status);

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 5000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-text">{conn.connector_name}</p>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">item {conn.item_id}</p>
          {typeof conn.created_at === "string" && (
            <p className="text-xs text-muted">conectada em {dateTimeBR(conn.created_at)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {typeof conn.reconnect_url === "string" && conn.reconnect_url && (
            <a
              href={conn.reconnect_url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-border bg-surface2 px-3 py-2 text-xs font-medium text-text hover:bg-border"
            >
              Reconectar
            </a>
          )}
          <button
          onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface2 px-3 py-2 text-xs font-medium text-text hover:bg-border disabled:opacity-50"
          >
            <RefreshCw size={13} className={sync.isPending ? "animate-spin" : ""} />
            {sync.isPending ? "Sincronizando…" : "Sincronizar"}
          </button>
          {confirming ? (
            <button
              onClick={() =>
                disconnect.mutate(
                  { item: conn.item_id, confirm: true },
                  { onSuccess: () => onRemoved() },
                )
              }
              disabled={disconnect.isPending}
              className="rounded-lg bg-neg px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {disconnect.isPending ? "Removendo…" : "Confirmar desconexão?"}
            </button>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="flex items-center gap-1.5 rounded-lg border border-neg/40 px-3 py-2 text-xs font-medium text-neg hover:bg-neg/10"
            >
              <Trash2 size={13} /> Desconectar
            </button>
          )}
        </div>
      </div>
      {sync.isError && <p className="mt-2 text-xs text-neg">{sync.error.message}</p>}
      {disconnect.isError && <p className="mt-2 text-xs text-neg">{disconnect.error.message}</p>}
    </Card>
  );
}

export default function ConnectionsPage() {
  const connections = useConnections();

  if (connections.isError) {
    return <ErrorState message={connections.error.message} onRetry={() => connections.refetch()} />;
  }
  if (connections.isLoading) {
    return (
      <div>
        <PageHeader title="Conexões" subtitle="Instituições autorizadas via Open Finance" />
        <Card>
          <p className="text-sm text-muted">Carregando…</p>
        </Card>
      </div>
    );
  }

  const data = connections.data;
  const conns = data?.connections ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conexões"
        subtitle="Instituições autorizadas via Open Finance"
        action={
          data?.add_connection_url ? (
            <a
              href={data.add_connection_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:opacity-90"
            >
              <Plug size={13} /> Adicionar banco
            </a>
          ) : undefined
        }
      />

      {conns.length === 0 ? (
        <EmptyState
          title="Nenhuma conexão"
          hint="Use o botão acima para autorizar um banco."
          href={data?.add_connection_url}
          linkLabel="Adicionar banco"
        />
      ) : (
        <div className="space-y-4">
          {conns.map((c) => (
            <ConnectionRow key={c.item_id} conn={c} onRemoved={() => connections.refetch()} />
          ))}
        </div>
      )}
    </div>
  );
}
