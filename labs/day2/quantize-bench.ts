// =============================================================================
// Day 2 lab: quantization benchmark  (designed, NOT run: skipped to avoid a
// 15 GB FP16 download. It typechecks and fails fast with a usage message.)
// =============================================================================
//
// THE BIG PICTURE
//   A language model is mostly a huge list of numbers (weights). Stored as
//   16-bit numbers, Qwen2.5-7B is 15 GB. QUANTIZATION shrinks each number to
//   fewer bits (8, 5, 4 or 2) so the file is smaller and tokens generate faster,
//   at the cost of some accuracy. This script answers: "how much speed do I
//   gain, and how much quality do I lose, at each level?"
//
// WHAT THE SCRIPT DOES
//   1. Measures the original FP16 model as a baseline.
//   2. Converts it to Q8_0, Q5_K_M, Q4_K_M and Q2_K (llama-quantize).
//   3. For each version, measures three things and prints one comparison table:
//        size     file size and bits per weight (does it fit? Chapter 4)
//        speed    llama-bench: "pp" = reading the prompt (prefill),
//                 "tg" = generating tokens (decode)
//        quality  llama-perplexity: how surprised the model is by real text.
//                 Lower is better, so a rise versus FP16 is the quality cost.
//
// WHAT WE EXPECT TO SEE (predictions from Chapters 4 and 5)
//   - Smaller file => faster tg, because decode is limited by how fast the
//     weights can be read from memory, and fewer bytes means fewer reads.
//     The "ceiling" column (memory bandwidth / file size) is the upper bound.
//   - pp stays roughly flat, because prefill is limited by math, not memory.
//   - Perplexity: Q8_0 ~ FP16, a small rise at Q5_K_M and Q4_K_M, then a big
//     jump at Q2_K.
//
// TERMS USED BELOW
//   GGUF       the single-file model format used by llama.cpp (weights + settings)
//   perplexity e^(average loss) on a text; "as uncertain as choosing among N
//              equally likely tokens"
//   bits/weight total file bits / number of weights, scale factors included
//
// RUNNING IT
//   Stop llama-server first: it holds ~7 GB and would compete for memory
//   bandwidth, which distorts the speed numbers.
//   node quantize-bench.ts <fp16.gguf> <perplexity-text.txt> [out-dir]
//
import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

// execFile runs a program with an argument array and no shell, so paths with
// spaces or special characters can't be misread as shell syntax.
const run = promisify(execFile);

// Quantization formats to build, in order of decreasing size.
const FORMATS = ["Q8_0", "Q5_K_M", "Q4_K_M", "Q2_K"];

// Published memory bandwidth of the Apple M4 Pro (273 GB/s). Used only for the
// predicted decode ceiling. Spec-sheet value, not measured.
const BANDWIDTH_GBS = 273;

// One row of the final table. `format` is "FP16" for the unquantized baseline.
interface Row {
  format: string;
  sizeGB: number;
  bitsPerWeight: number;
  ppTokPerSec: number;
  tgTokPerSec: number;
  ceilingTokPerSec: number;
  ppl: number;
}

// One entry of `llama-bench -o json` output. Only the fields we read are listed.
// avg_ts is the mean tokens/second over the repetitions.
interface BenchEntry {
  n_prompt: number;
  n_gen: number;
  avg_ts: number;
}

// Convert FP16 -> another format. Quantizing from FP16 (not from an already
// quantized file) matters: re-quantizing stacks rounding errors, and
// llama-quantize refuses it unless you pass --allow-requantize.
// CLI shape: llama-quantize <input.gguf> <output.gguf> <type>
async function quantize(source: string, output: string, format: string) {
  await run("llama-quantize", [source, output, format]);
}

// Speed test. -p 512 times prefill on a 512-token prompt ("pp512"); -n 128
// times decode of 128 generated tokens ("tg128"); -r 3 repeats each test 3
// times and averages; -o json prints machine-readable results on stdout.
async function bench(model: string) {
  const { stdout } = await run("llama-bench", [
    "-m", model, "-p", "512", "-n", "128", "-r", "3", "-o", "json",
  ]);
  const entries = JSON.parse(stdout) as BenchEntry[];

  // llama-bench reports a prefill test (n_gen = 0) and a decode test (n_prompt = 0).
  const pp = entries.find((e) => e.n_gen === 0);
  const tg = entries.find((e) => e.n_prompt === 0);
  if (!pp || !tg) throw new Error(`unexpected llama-bench output for ${model}`);
  return { pp: pp.avg_ts, tg: tg.avg_ts };
}

// Perplexity (Chapter 5, section 4): run the model over a text file and
// average how surprised it is by each real next token. Lower is better, and
// only values from the SAME text and context size are comparable.
// -c 512 sets the context window per chunk. llama-perplexity prints progress
// to stderr and ends with a line like "Final estimate: PPL = 7.1234 +/- 0.0456"
// (format recalled, not verified on this machine; the regex below must match it).
async function perplexity(model: string, textFile: string): Promise<number> {
  const { stdout, stderr } = await run(
    "llama-perplexity",
    ["-m", model, "-f", textFile, "-c", "512"],
    { maxBuffer: 64 * 1024 * 1024 }, // the tool is chatty; the default 1 MB buffer would overflow
  );
  const match = /Final estimate: PPL = ([\d.]+)/.exec(stdout + stderr);
  if (!match?.[1]) throw new Error(`no perplexity found in output for ${model}`);
  return Number(match[1]);
}

// Measure one model file and turn it into a table row.
async function measure(
  format: string,
  model: string,
  parameters: number,
  textFile: string,
): Promise<Row> {
  const sizeBytes = (await stat(model)).size;
  const sizeGB = sizeBytes / 1e9;
  const speed = await bench(model);

  return {
    format,
    sizeGB,
    // bits per weight = total bits / number of weights (scale factors included)
    bitsPerWeight: (sizeBytes * 8) / parameters,
    ppTokPerSec: speed.pp,
    tgTokPerSec: speed.tg,
    // Chapter 4: each token reads the whole file once, so speed <= bandwidth / size.
    ceilingTokPerSec: BANDWIDTH_GBS / sizeGB,
    ppl: await perplexity(model, textFile),
  };
}

// --- main -------------------------------------------------------------------

const [source, textFile, outDir = "quantized"] = process.argv.slice(2);
if (!source || !textFile) {
  throw new Error("usage: node quantize-bench.ts <fp16.gguf> <text.txt> [out-dir]");
}
await mkdir(outDir, { recursive: true });

// FP16 stores 2 bytes per weight, so the baseline file size gives the parameter
// count (approximately: a few small tensors are stored in 32-bit floats).
const parameters = (await stat(source)).size / 2;

// The baseline row comes first: every perplexity is compared against it.
const rows: Row[] = [await measure("FP16", source, parameters, textFile)]; // NOSONAR: sequential on purpose, timings must not overlap

for (const format of FORMATS) {
  const output = join(outDir, `model-${format}.gguf`);
  await quantize(source, output, format); // NOSONAR: sequential on purpose
  rows.push(await measure(format, output, parameters, textFile)); // NOSONAR: sequential on purpose
}

const baseline = rows[0]?.ppl ?? NaN;
console.log("format   size GB  bits/w   pp tok/s   tg tok/s  ceiling   ppl     vs FP16");
for (const r of rows) {
  console.log(
    `${r.format.padEnd(8)} ${r.sizeGB.toFixed(2).padStart(7)} ${r.bitsPerWeight.toFixed(2).padStart(7)}` +
      ` ${r.ppTokPerSec.toFixed(0).padStart(10)} ${r.tgTokPerSec.toFixed(1).padStart(10)}` +
      ` ${r.ceilingTokPerSec.toFixed(1).padStart(8)} ${r.ppl.toFixed(3).padStart(7)}` +
      ` ${(((r.ppl - baseline) / baseline) * 100).toFixed(1).padStart(7)}%`,
  );
}
