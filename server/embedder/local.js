// In-process embeddings — no daemon, no API key, no per-query cost, and after
// the first model fetch, no network. Prax already had two local backends
// (ollama, llamacpp) but both need a separate process running; this one embeds
// inside the server, which is what lets semantic recall work on a laptop with
// nothing configured.
//
// The runtime is deliberately NOT a dependency of Prax. onnxruntime ships
// ~210MB of per-platform binaries, which has no place in the default install or
// the desktop bundle, and most users will keep a hosted backend. So it is
// imported dynamically and its absence is reported as "unavailable, here is how
// to enable it" rather than crashing the server that merely has it configured.
//
//   npm install @huggingface/transformers
//
// Vectors are mean-pooled over tokens and L2-normalised, so cosine similarity
// against them is a plain dot product and comparable with every other backend's
// output. As always, a vector is only ever ranked against vectors from the SAME
// backend and model (C10) — switching backends leaves the old vectors pending
// until a reindex, which the index-coverage disclosure reports.

export const LOCAL_RUNTIME = '@huggingface/transformers';

// 384 dimensions, ~23MB on disk, a few milliseconds per document on CPU. Small
// enough that the first-run download is not a wall, good enough that recall
// quality is not the reason to move to a hosted model.
export const LOCAL_DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

function installHint(err) {
  const missing = err?.code === 'ERR_MODULE_NOT_FOUND'
    || /cannot find (module|package)/i.test(String(err?.message || ''));
  if (!missing) return err;
  return new Error(
    `local embeddings need the ${LOCAL_RUNTIME} runtime, which is not installed. `
    + `Install it with: npm install ${LOCAL_RUNTIME}`,
    { cause: err },
  );
}

// The real loader: resolve the feature-extraction pipeline for `model`. Kept
// behind a parameter so tests never import the runtime or touch the network.
async function defaultLoad(model) {
  const { pipeline } = await import(LOCAL_RUNTIME);
  return pipeline('feature-extraction', model);
}

export function createLocalEmbedder({ model, load = defaultLoad } = {}) {
  const embedModel = model || LOCAL_DEFAULT_MODEL;

  // One load shared by every caller, including concurrent first embeds. A
  // FAILED load is not cached: a transient download failure must not disable
  // embeddings for the lifetime of the process.
  let pending = null;
  async function pipelineFor() {
    if (!pending) {
      pending = load(embedModel).catch((err) => {
        pending = null;
        throw installHint(err);
      });
    }
    return pending;
  }

  return {
    backend: 'local',
    model: embedModel,

    // The relevance floor these vectors need. Cosine distributions belong to the
    // MODEL, not to search: the global 0.45 default was calibrated on OpenAI
    // vectors, and on all-MiniLM-L6-v2 it discards most true positives. Measured
    // on a real 18-document library — correct answers scored 0.400, 0.450 and
    // 0.563 while the best unrelated document scored 0.287 — so 0.35 sits in the
    // gap with margin on both sides. That is a small sample: revisit it with a
    // semantic relevance harness rather than treating it as settled.
    minSimilarity: 0.35,

    async embed(text) {
      const extractor = await pipelineFor();
      const output = await extractor([String(text ?? '')], { pooling: 'mean', normalize: true });
      const data = output?.data;
      if (!data || typeof data.length !== 'number' || data.length === 0) {
        throw new Error(`${LOCAL_RUNTIME} returned no embedding for the input`);
      }
      // A Float32Array (or a [1, dim] tensor's buffer) → a plain array, which is
      // what the repository stores as JSON and the ranker parses back.
      const vector = Array.from(data);
      return { vector, model: embedModel, dim: vector.length };
    },

    // Loading the model, not merely importing the package: ollama.js sets the
    // precedent that a reachable backend whose model is missing must not read
    // as "connected" when every embed would still fail. The first call pays
    // the model download; later calls are instant.
    //
    // The reason travels with the verdict: the settings screen shows it next
    // to "disconnected", which is the only place an operator would otherwise
    // learn that the runtime is not installed (the embed path is caught and
    // reported as a generic 503, and the reindex path only shows a sample).
    availability,

    async isAvailable() {
      return (await availability()).available;
    },
  };

  async function availability() {
    try {
      await pipelineFor();
      return { available: true, reason: null };
    } catch (err) {
      return { available: false, reason: err?.message || String(err) };
    }
  }
}
