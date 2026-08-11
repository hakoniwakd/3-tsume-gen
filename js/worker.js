import { generateProblem } from "./shogi.js";

self.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type !== "generate") return;

  const baseSeed = message.seed >>> 0;
  const options = message.options || {};
  const retryCount = options.workerRetries ?? 2;

  let lastError = null;

  for (let i = 0; i <= retryCount; i++) {
    const seed = (baseSeed + i * 0x9e3779b9) >>> 0;

    try {
      const problem = generateProblem(seed, options);

      self.postMessage({
        type: "problem",
        problem,
      });

      return;
    } catch (error) {
      lastError = error;
    }
  }

  self.postMessage({
    type: "error",
    error: lastError ? String(lastError.message || lastError) : "generation failed",
  });
});