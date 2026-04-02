import type { Handler } from "aws-lambda";
import { runApp } from "./app.js";
import { resolveConfig } from "./lib/env.js";

export const handler: Handler = async () => {
  const config = resolveConfig({ isHeadless: true, runtime: "lambda" });
  await runApp(config);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      action: config.paychexAction,
    }),
  };
};

