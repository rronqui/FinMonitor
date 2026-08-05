import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AmountByKind,
  Card,
  EmptyState,
  ErrorState,
  KindBadge,
  PageHeader,
  Stat,
  barFieldFromClick,
  billStatusBadge,
  connectionStatusBadge,
} from "@/src/components/ui";
import { brl } from "@/src/lib/format";
import { KIND_LABEL, type TxKind } from "@/src/lib/semantics";

afterEach(cleanup);

describe("primitivas de UI", () => {
  test("Card renderiza título, ação e children; sem título nem ação não cria heading", () => {
    render(
      <Card title="Resumo" action={<button type="button">Ação</button>}>
        <p>Conteúdo do card</p>
      </Card>,
    );

    expect(screen.getByRole("heading", { name: "Resumo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ação" })).toBeTruthy();
    expect(screen.getByText("Conteúdo do card")).toBeTruthy();

    cleanup();
    render(<Card><p>Somente conteúdo</p></Card>);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Somente conteúdo")).toBeTruthy();
  });

  test("Stat exibe label, valor e hint e aplica a cor semântica ao valor", () => {
    render(
      <>
        <Stat label="Receitas" value={brl(1234.5)} hint="Neste mês" tone="pos" />
        <Stat label="Despesas" value={brl(50)} tone="neg" />
      </>,
    );

    expect(screen.getByText("Receitas")).toBeTruthy();
    expect(screen.getByText("Neste mês")).toBeTruthy();
    const revenue = brl(1234.5).replace(/\u00a0/g, " ");
    const expense = brl(50).replace(/\u00a0/g, " ");
    expect(screen.getByText(revenue).className).toContain("text-pos");
    expect(screen.getByText(expense).className).toContain("text-neg");
  });

  test("connectionStatusBadge traduz estados conhecidos e preserva o desconhecido", () => {
    expect(connectionStatusBadge("UPDATED")).toEqual({ tone: "green", label: "Atualizada" });
    expect(connectionStatusBadge("LOGIN_ERROR")).toEqual({ tone: "red", label: "Erro de login" });
    expect(connectionStatusBadge("WAITING")).toEqual({ tone: "yellow", label: "WAITING" });
  });

  test("billStatusBadge traduz todos os estados de fatura, inclusive estado ausente", () => {
    expect(billStatusBadge("PAID")).toEqual({ tone: "green", label: "Paga" });
    expect(billStatusBadge("PAST_DUE_UNPAID")).toEqual({ tone: "red", label: "Atrasada (não paga)" });
    expect(billStatusBadge("PAST_DUE_UNCONFIRMED")).toEqual({ tone: "yellow", label: "Vencida (pagamento não confirmado)" });
    expect(billStatusBadge("OPEN")).toEqual({ tone: "gray", label: "Em aberto" });
    expect(billStatusBadge(undefined)).toEqual({ tone: "gray", label: "—" });
  });

  test("ErrorState mostra a mensagem e só exibe retry quando recebe onRetry", () => {
    const onRetry = vi.fn();
    const { unmount } = render(<ErrorState message="Falha ao consultar" onRetry={onRetry} />);

    expect(screen.getByText("Falha ao consultar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    unmount();
    render(<ErrorState message="Falha sem retry" />);
    expect(screen.getByText("Falha sem retry")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).toBeNull();
  });

  test("EmptyState exibe título e hint e só cria link com href e linkLabel", () => {
    const { unmount } = render(
      <EmptyState title="Nenhum resultado" hint="Ajuste os filtros" href="https://example.test" linkLabel="Adicionar" />,
    );

    expect(screen.getByText("Nenhum resultado")).toBeTruthy();
    expect(screen.getByText("Ajuste os filtros")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Adicionar" });
    expect(link.getAttribute("href")).toBe("https://example.test");
    expect(link.getAttribute("target")).toBe("_blank");

    unmount();
    render(<EmptyState title="Sem link" href="https://example.test" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("AmountByKind formata o valor e aplica a cor correspondente a cada kind", () => {
    const kinds: Array<[TxKind, string]> = [
      ["spend", "text-neg"],
      ["income", "text-pos"],
      ["investment", "text-primary"],
      ["transfer", "text-muted"],
    ];

    render(
      <>
        {kinds.map(([kind]) => (
          <AmountByKind key={kind} value={1234.5} kind={kind} />
        ))}
      </>,
    );

    const amount = brl(1234.5).replace(/\u00a0/g, " ");
    expect(screen.getAllByText(amount)).toHaveLength(kinds.length);
    for (const [, className] of kinds) {
      expect(document.querySelector(`span.${className}`)).toBeTruthy();
    }
  });

  test("KindBadge renderiza o label definido em KIND_LABEL para cada kind", () => {
    const kinds: TxKind[] = ["spend", "income", "transfer", "investment"];
    render(
      <>
        {kinds.map((kind) => (
          <KindBadge key={kind} kind={kind} />
        ))}
      </>,
    );

    for (const kind of kinds) expect(screen.getByText(KIND_LABEL[kind])).toBeTruthy();
  });

  test("PageHeader exibe título, subtítulo e ação", () => {
    render(<PageHeader title="Transações" subtitle="Filtros atuais" action={<button type="button">Exportar</button>} />);

    expect(screen.getByRole("heading", { name: "Transações" })).toBeTruthy();
    expect(screen.getByText("Filtros atuais")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Exportar" })).toBeTruthy();
  });

  test("barFieldFromClick extrai o campo direto, do payload ou de activePayload", () => {
    expect(barFieldFromClick({ key: "a" }, "key")).toBe("a");
    expect(barFieldFromClick({ payload: { key: "b" } }, "key")).toBe("b");
    expect(barFieldFromClick({ activePayload: [{ payload: { key: "c" } }] }, "key")).toBe("c");
    expect(barFieldFromClick({ key: 5 }, "key")).toBeNull();
    expect(barFieldFromClick(null, "key")).toBeNull();
    expect(barFieldFromClick(undefined, "key")).toBeNull();
  });
});
