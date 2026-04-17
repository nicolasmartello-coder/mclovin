const REQUIRED_ENV = [
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "GITHUB_TOKEN",
  "ANTHROPIC_API_KEY",
] as const;

/** Call before creating the Slack receiver so Railway/logs show every missing key at once. */
export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]?.trim());
  if (missing.length > 0) {
    console.error(
      "[Mclovin] Faltan variables de entorno. En Railway: servicio del bot → Variables:\n  " +
        missing.join("\n  ")
    );
    process.exit(1);
  }

  const bot = process.env.SLACK_BOT_TOKEN?.trim() ?? "";
  if (!bot.startsWith("xoxb-")) {
    console.error(
      "[Mclovin] SLACK_BOT_TOKEN debe ser el Bot User OAuth Token (empieza con xoxb-). " +
        "En Slack: OAuth & Permissions → Bot User OAuth Token. No pongas el Signing Secret ni comillas."
    );
    process.exit(1);
  }
}

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  slackBotToken: () => req("SLACK_BOT_TOKEN"),
  slackSigningSecret: () => req("SLACK_SIGNING_SECRET"),
  githubToken: () => req("GITHUB_TOKEN"),
  anthropicApiKey: () => req("ANTHROPIC_API_KEY"),
  /** Set to the model your org provisions (Anthropic Console, Bedrock, Vertex, etc.). */
  anthropicModel: () =>
    process.env.ANTHROPIC_MODEL?.trim() || "claude-3-5-sonnet-20241022",
  port: () => Number(process.env.PORT ?? "3000"),
  defaultOwner: () => process.env.DEFAULT_GITHUB_OWNER?.trim() || "",
  defaultRepo: () => process.env.DEFAULT_GITHUB_REPO?.trim() || "",
};
