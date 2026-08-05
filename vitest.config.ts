import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, defineProject } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    projects: [
      defineProject({
        test: { include: ["src/lib/**/*.test.*"] },
        resolve: { alias: { "@": root } },
      }),
      defineProject({
        test: {
          name: "ui",
          include: ["app/**/*.test.tsx", "src/components/**/*.test.tsx"],
          environment: "jsdom",
        },
        resolve: { alias: { "@": root } },
      }),
    ],
  },
});
