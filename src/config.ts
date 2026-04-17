const REQUIRED_ENV = [
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "GITHUB_TOKEN",
  "OPENAI_API_KEY",
] as const;

/** Call before creating the Slack receiver so Railway/logs show every missing key at once. */
export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]?.trim());
  if (missing.length === 0) return;
  console.error(
    "[Mclovin] Faltan variables de entorno. En Railway: abrí el SERVICIO del bot (no solo el proyecto) → Variables → agregar cada una:\n  " +
      missing.join("\n  ")
  );
  process.exit(1);
}

function req(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  slackBotToken: () => req("SLACK_BOT_TOKEN"),
  slackSigningSecret: () => req("SLACK_SIGNING_SECRET"),
  githubToken: () => req("GITHUB_TOKEN"),
  openaiApiKey: () => req("OPENAI_API_KEY"),
  openaiModel: () => process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  port: () => Number(process.env.PORT ?? "3000"),
  defaultOwner: () => process.env.DEFAULT_GITHUB_OWNER?.trim() || "",
  defaultRepo: () => process.env.DEFAULT_GITHUB_REPO?.trim() || "",
};
