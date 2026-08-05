import { describe, expect, it } from "vitest";
import { categorizeOutcome } from "../api";

const items = [
  { transaction_id: "t1", category_id: "c1" },
  { transaction_id: "t2", category_id: "c2" },
];

describe("categorizeOutcome", () => {
  it("payload sem errors → todos os items ok e erro nulo", () => {
    const { okItems, error } = categorizeOutcome({ results: [] }, items);
    expect(okItems).toEqual(items);
    expect(error).toBeNull();
  });

  it("errors[] exclui só os ids recusados e agrega a mensagem", () => {
    const { okItems, error } = categorizeOutcome(
      { errors: [{ id: "t2", message: "Invalid id" }] },
      items,
    );
    expect(okItems).toEqual([{ transaction_id: "t1", category_id: "c1" }]);
    expect(error).toBe("Invalid id");
  });

  it("erros com a mesma mensagem não duplicam no texto final", () => {
    const { okItems, error } = categorizeOutcome(
      {
        errors: [
          { id: "t1", message: "Invalid id, not an uuid" },
          { id: "t2", message: "Invalid id, not an uuid" },
        ],
      },
      items,
    );
    expect(okItems).toEqual([]);
    expect(error).toBe("Invalid id, not an uuid");
  });
});
