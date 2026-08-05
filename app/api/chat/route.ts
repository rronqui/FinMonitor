import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { SYSTEM_PROMPT } from "@/src/lib/chat/system-prompt";
import { bankTools } from "@/src/lib/chat/tools";

const LLM_BASE = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
const LLM_KEY = process.env.LLM_API_KEY ?? "ollama";

const llm = createOpenAICompatible({
  name: "ollama",
  baseURL: LLM_BASE,
  apiKey: LLM_KEY,
});

export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as { messages: UIMessage[] };

    // Pre-flight: streamText é lazy — sem este ping, um LLM fora do ar só
    // falharia no meio do stream. O contrato exige 503 JSON nesse caso.
    const probe = await fetch(`${LLM_BASE}/models`, {
      headers: { Authorization: `Bearer ${LLM_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!probe.ok) throw new Error(`LLM indisponível (HTTP ${probe.status})`);

    const result = streamText({
      model: llm(process.env.LLM_MODEL ?? "minimax-m3:cloud"),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      stopWhen: isStepCount(10),
      tools: bankTools,
      // alguns modelos emitem vários objetos JSON concatenados num único tool
      // call ({"expression":"a"}{"expression":"b"} ou "{}{}"); recupera o input.
      experimental_repairToolCall: async ({ toolCall }) => {
        const raw = toolCall.input;
        try {
          JSON.parse(raw);
          return { ...toolCall, input: raw };
        } catch {
          // input inválido: tenta reparar abaixo
        }
        if (toolCall.toolName === "calculate") {
          try {
            const objs = JSON.parse(`[${raw.replace(/\}\s*\{/g, "},{")}]`) as Array<Record<string, unknown>>;
            const expressions = objs
              .map((o) => (typeof o.expression === "string" ? o.expression : null))
              .filter((e): e is string => e !== null);
            if (expressions.length > 0) return { ...toolCall, input: JSON.stringify({ expressions }) };
          } catch {
            // cai no reparo genérico abaixo
          }
        }
        // primeiro objeto JSON balanceado (ex.: "{}{}" -> "{}")
        let depth = 0;
        for (let i = 0; i < raw.length; i++) {
          if (raw[i] === "{") depth++;
          else if (raw[i] === "}") {
            depth--;
            if (depth === 0) {
              const first = raw.slice(0, i + 1);
              try {
                JSON.parse(first);
                return { ...toolCall, input: first };
              } catch {
                return null;
              }
            }
          }
        }
        return null;
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
