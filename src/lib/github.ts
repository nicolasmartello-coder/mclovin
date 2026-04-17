import { Octokit } from "@octokit/rest";

const PR_URL =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$|\?)/i;
const REPO_PAIR = /^([^/]+)\/([^/]+)$/;

export function parsePrUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = url.trim().match(PR_URL);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, ""), number: Number(m[3]) };
}

export function parseRepoPair(s: string): { owner: string; repo: string } | null {
  const t = s.trim();
  const m = t.match(REPO_PAIR);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

export function getOctokit(token: string) {
  return new Octokit({ auth: token });
}

export async function fetchPullRequestDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<{ title: string; body: string | null; diff: string; base: string; head: string }> {
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });
  const { data: diff } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: { format: "diff" },
  });
  const diffText = typeof diff === "string" ? diff : String(diff);
  return {
    title: pr.title,
    body: pr.body,
    diff: diffText,
    base: pr.base.ref,
    head: pr.head.ref,
  };
}

export async function getDefaultBranchSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const { data } = await octokit.repos.getBranch({ owner, repo, branch });
  return data.commit.sha;
}

export async function createBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  fromSha: string
): Promise<void> {
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: fromSha,
  });
}

export async function getFileContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== "file") return null;
    if (data.encoding === "base64" && data.content) {
      return Buffer.from(data.content, "base64").toString("utf8");
    }
    return null;
  } catch {
    return null;
  }
}

export async function createOrUpdateFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  previousSha?: string | null
): Promise<void> {
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
    ...(previousSha ? { sha: previousSha } : {}),
  });
}

export async function getFileSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== "file") return null;
    return data.sha;
  } catch {
    return null;
  }
}

export async function openPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string
): Promise<string> {
  const { data } = await octokit.pulls.create({
    owner,
    repo,
    title,
    head,
    base,
    body,
  });
  return data.html_url;
}
