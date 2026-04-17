import OpenAI from "openai";
import { config } from "../config.js";

const MAX_DIFF_CHARS = 120_000;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[…truncated, ${s.length - max} chars omitted]`;
}

export async function runCodeReview(diff: string, prTitle: string): Promise<string> {
  const client = new OpenAI({ apiKey: config.openaiApiKey() });
  const model = config.openaiModel();
  const diffIn = truncate(diff, MAX_DIFF_CHARS);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are Mclovin, a careful senior engineer doing code review. Be concise, actionable, and note severity (blocking vs nit). Use markdown with headings.",
      },
      {
        role: "user",
        content: `PR title: ${prTitle}\n\nDiff:\n\`\`\`diff\n${diffIn}\n\`\`\``,
      },
    ],
    temperature: 0.3,
  });
  const text = completion.choices[0]?.message?.content?.trim();
  return text || "(Mclovin: empty model response)";
}

type FixFile = { path: string; content: string };

function extractJsonArray(raw: string): FixFile[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON array in model output");
  const slice = raw.slice(start, end + 1);
  const parsed = JSON.parse(slice) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Model output is not an array");
  return parsed.map((item, i) => {
    if (!item || typeof item !== "object") throw new Error(`Invalid item ${i}`);
    const o = item as Record<string, unknown>;
    if (typeof o.path !== "string" || typeof o.content !== "string") {
      throw new Error(`Item ${i} needs string path and content`);
    }
    return { path: o.path, content: o.content };
  });
}

export async function runFixPathPlan(input: {
  owner: string;
  repo: string;
  baseBranch: string;
  issueDescription: string;
  threadContext: string;
}): Promise<string[]> {
  const client = new OpenAI({ apiKey: config.openaiApiKey() });
  const model = config.openaiModel();

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content:
          'You are Mclovin. Reply with ONLY a JSON object: {"paths":["relative/path.ts",...],"note":"short"}. Max 8 paths. Paths must be repo-relative. No markdown.',
      },
      {
        role: "user",
        content: `Repo ${input.owner}/${input.repo} (branch ${input.baseBranch}).\n\nIssue:\n${input.issueDescription}\n\nThread:\n${input.threadContext || "(none)"}`,
      },
    ],
    temperature: 0.1,
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in path plan");
  const obj = JSON.parse(raw.slice(start, end + 1)) as { paths?: unknown };
  if (!Array.isArray(obj.paths)) throw new Error("paths missing");
  return obj.paths.filter((p): p is string => typeof p === "string").slice(0, 8);
}

export async function runFixAgent(input: {
  owner: string;
  repo: string;
  baseBranch: string;
  issueDescription: string;
  threadContext: string;
  fileHints: string[];
  fileSnapshots: { path: string; content: string }[];
}): Promise<FixFile[]> {
  const client = new OpenAI({ apiKey: config.openaiApiKey() });
  const model = config.openaiModel();

  const hints =
    input.fileHints.length > 0
      ? `Preferred paths (hints): ${input.fileHints.join(", ")}`
      : "No file path hints; infer from repo layout and issue.";

  const filesBlock = input.fileSnapshots
    .map((f) => `--- FILE: ${f.path} ---\n${truncate(f.content, 60_000)}`)
    .join("\n\n");

  const completion = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `You are Mclovin, an implementation agent. Output ONLY a JSON array of objects with keys "path" and "content" (full file contents after your edits). No markdown fences. Repository: ${input.owner}/${input.repo}, base branch: ${input.baseBranch}.`,
      },
      {
        role: "user",
        content: `Issue / task:\n${input.issueDescription}\n\nThread context:\n${input.threadContext || "(none)"}\n\n${hints}\n\nCurrent file contents (edit these or add new paths as needed):\n\n${filesBlock || "(no files loaded — return minimal changes only if you cannot proceed)"}`,
      },
    ],
    temperature: 0.2,
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  return extractJsonArray(raw);
}
