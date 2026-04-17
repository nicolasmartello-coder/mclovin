import { App, ExpressReceiver } from "@slack/bolt";
import { config } from "./config.js";
import { runCodeReview, runFixAgent, runFixPathPlan } from "./lib/agent.js";
import {
  createBranch,
  createOrUpdateFile,
  fetchPullRequestDiff,
  getDefaultBranchSha,
  getFileContent,
  getFileSha,
  getOctokit,
  openPullRequest,
  parsePrUrl,
  parseRepoPair,
} from "./lib/github.js";

const receiver = new ExpressReceiver({
  signingSecret: config.slackSigningSecret(),
  processBeforeResponse: true,
});

const app = new App({
  token: config.slackBotToken(),
  receiver,
  deferInitialization: true,
});

function splitRepoAndRest(text: string): { pair: string; rest: string } | null {
  const t = text.trim();
  if (!t) return null;
  const first = t.split(/\s+/)[0];
  if (parseRepoPair(first)) {
    return { pair: first, rest: t.slice(first.length).trim() };
  }
  return null;
}

function resolveRepo(text: string): { owner: string; repo: string; description: string } | null {
  const split = splitRepoAndRest(text);
  const defO = config.defaultOwner();
  const defR = config.defaultRepo();
  if (split) {
    const p = parseRepoPair(split.pair);
    if (!p) return null;
    return { owner: p.owner, repo: p.repo, description: split.rest };
  }
  if (defO && defR) {
    return { owner: defO, repo: defR, description: text.trim() };
  }
  return null;
}

app.command("/review", async ({ command, ack, respond, client }) => {
  await ack();
  const raw = command.text.trim();
  const urlMatch = raw.match(/https?:\/\/\S+/);
  const url = urlMatch ? urlMatch[0] : raw;
  const parsed = parsePrUrl(url);
  if (!parsed) {
    await respond({
      response_type: "ephemeral",
      text: "Mclovin: pasame un link de PR de GitHub, ej. `https://github.com/org/repo/pull/123`",
    });
    return;
  }

  await respond({
    response_type: "ephemeral",
    text: `Mclovin está revisando ${parsed.owner}/${parsed.repo}#${parsed.number}…`,
  });

  try {
    const octokit = getOctokit(config.githubToken());
    const { title, diff } = await fetchPullRequestDiff(
      octokit,
      parsed.owner,
      parsed.repo,
      parsed.number
    );
    const review = await runCodeReview(diff, title);
    const channel = command.channel_id;
    await client.chat.postMessage({
      channel,
      text: `Review Mclovin — ${parsed.owner}/${parsed.repo}#${parsed.number}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Mclovin* · \`${parsed.owner}/${parsed.repo}#${parsed.number}\`\n${review.slice(0, 2900)}${review.length > 2900 ? "…" : ""}` },
        },
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await respond({
      response_type: "ephemeral",
      text: `Mclovin falló al revisar: ${msg}`,
    });
  }
});

app.command("/fix", async ({ command, ack, respond, client }) => {
  await ack();
  const resolved = resolveRepo(command.text);
  if (!resolved) {
    await respond({
      response_type: "ephemeral",
      text:
        "Mclovin: indicá `owner/repo` y la descripción del fix, o configurá DEFAULT_GITHUB_OWNER / DEFAULT_GITHUB_REPO en el servidor.",
    });
    return;
  }

  const { owner, repo, description } = resolved;
  if (!description) {
    await respond({
      response_type: "ephemeral",
      text: "Mclovin: falta la descripción del issue / cambio esperado.",
    });
    return;
  }

  await respond({
    response_type: "ephemeral",
    text: `Mclovin está preparando un branch y PR en \`${owner}/${repo}\`…`,
  });

  try {
    const octokit = getOctokit(config.githubToken());
    const { data: rep } = await octokit.repos.get({ owner, repo });
    const baseBranch = rep.default_branch;
    const threadContext = "";

    const paths = await runFixPathPlan({
      owner,
      repo,
      baseBranch,
      issueDescription: description,
      threadContext,
    });
    if (paths.length === 0) {
      await respond({
        response_type: "ephemeral",
        text: "Mclovin no pudo inferir archivos. Sé más específica/o en el mensaje.",
      });
      return;
    }

    const snapshots: { path: string; content: string }[] = [];
    for (const path of paths) {
      const content = await getFileContent(octokit, owner, repo, path, baseBranch);
      if (content === null) {
        await respond({
          response_type: "ephemeral",
          text: `Mclovin: no encontré \`${path}\` en la rama \`${baseBranch}\`.`,
        });
        return;
      }
      snapshots.push({ path, content });
    }

    const files = await runFixAgent({
      owner,
      repo,
      baseBranch,
      issueDescription: description,
      threadContext,
      fileHints: paths,
      fileSnapshots: snapshots,
    });

    if (files.length === 0) {
      await respond({ response_type: "ephemeral", text: "Mclovin: el modelo no devolvió archivos." });
      return;
    }

    const baseSha = await getDefaultBranchSha(octokit, owner, repo, baseBranch);
    const slug = `mclovin/fix-${Date.now()}`;
    await createBranch(octokit, owner, repo, slug, baseSha);

    for (const f of files) {
      const sha = await getFileSha(octokit, owner, repo, f.path, slug);
      await createOrUpdateFile(
        octokit,
        owner,
        repo,
        f.path,
        f.content,
        `fix: ${description.slice(0, 72)}`,
        slug,
        sha
      );
    }

    const prUrl = await openPullRequest(
      octokit,
      owner,
      repo,
      slug,
      baseBranch,
      `[Mclovin] ${description.slice(0, 80)}`,
      `Generado por Mclovin (beta POC).\n\n${description}`
    );

    const channel = command.channel_id;
    await client.chat.postMessage({
      channel,
      text: `Mclovin abrió un PR: ${prUrl}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Mclovin* abrió un PR contra \`${baseBranch}\`:\n${prUrl}`,
          },
        },
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await respond({
      response_type: "ephemeral",
      text: `Mclovin falló al crear el PR: ${msg}`,
    });
  }
});

app.event("app_mention", async ({ event, say }) => {
  if (!("text" in event) || typeof event.text !== "string") return;
  await say({
    text: "Soy Mclovin (beta). Usá `/review` con un link de PR o `/fix owner/repo …` para abrir un PR.",
  });
});

receiver.router.get("/health", (_req, res) => {
  res.status(200).send("ok");
});

async function main() {
  const port = config.port();
  await app.init();
  await app.start(port);
  // eslint-disable-next-line no-console
  console.log(`Mclovin listening on ${port} (POST /slack/events, GET /health)`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
