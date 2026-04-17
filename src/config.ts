function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
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
