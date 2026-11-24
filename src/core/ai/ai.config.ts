import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getActiveModelId } from "../../config/env";
import { KryptonError } from "../../lib/error-handler";

export function getAgentModel(modelOverride?: string) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const modelId = modelOverride?.trim() || getActiveModelId();

  if (!apiKey) {
    throw new KryptonError(
      "Missing OPENROUTER_API_KEY. Please set OPENROUTER_API_KEY in your .env file (run `krypton doctor` to check setup).",
      "MISSING_API_KEY",
    );
  }

  const provider = createOpenRouter({ apiKey });
  return provider(modelId);
}
