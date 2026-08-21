/**
 * "The AI that understands the prompt": a frozen, pretrained multilingual
 * embedding model executed locally on CPU via the OPTIONAL
 * `@huggingface/transformers` dependency (ONNX runtime). No network is ever
 * touched at classification time; the model files are downloaded once during
 * `effort-autopilot install --with-ml` into the install root.
 *
 * When the optional dependency is not installed this module resolves to null
 * and the caller falls back to the deterministic classifier.
 */

export const DEFAULT_EMBEDDING_MODEL = "Xenova/multilingual-e5-small";

export async function createTransformersEmbedder({
  modelId = DEFAULT_EMBEDDING_MODEL,
  cacheDir,
  localFilesOnly = false,
} = {}) {
  let transformers;
  try {
    transformers = await import("@huggingface/transformers");
  } catch {
    return null;
  }
  if (cacheDir) transformers.env.cacheDir = cacheDir;
  if (localFilesOnly) transformers.env.allowRemoteModels = false;
  const extractor = await transformers.pipeline("feature-extraction", modelId, { dtype: "q8" });
  return Object.freeze({
    modelId,
    async embed(text) {
      // e5-family models expect a task prefix; queries use "query: ".
      const output = await extractor(`query: ${text}`, { pooling: "mean", normalize: true });
      return Array.from(output.data);
    },
  });
}
