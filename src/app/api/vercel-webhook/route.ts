import crypto from "crypto";
import { VercelWebhookEvent } from "../../../types";

const { WEBHOOK_INTEGRATION_SECRET, DISCORD_WEBHOOK_URL } = process.env;
export const maxDuration = 300;

const urls = ["https://thebiohackers.co"];
export const POST = async (req: Request, res: Response) => {
  if (typeof WEBHOOK_INTEGRATION_SECRET != "string") {
    throw new Error("No integration secret found");
  }

  const rawBody = await req.text();
  const rawBodyBuffer = Buffer.from(rawBody, "utf-8");

  const bodySignature = sha1(rawBodyBuffer, WEBHOOK_INTEGRATION_SECRET);

  if (bodySignature !== req.headers.get("x-vercel-signature")) {
    return Response.json({
      code: "invalid_signature",
      error: "signature didn't match",
    });
  }

  const vercelEvent = JSON.parse(
    rawBodyBuffer.toString("utf-8"),
  ) as VercelWebhookEvent;

  try {
    switch (vercelEvent.type) {
      case "deployment.succeeded":
      case "deployment.canceled":
      case "deployment.error":
        await sendDiscordMessageFor(vercelEvent);
        break;
      default:
        "";
        console.log("Ignoring event from Vercel: " + vercelEvent.type);
    }
    return new Response("Notification sent to Discord.", { status: 200 });
  } catch (error) {
    console.error("Failed to send notification:", error);
    return new Response("Internal server error.", { status: 500 });
  }
};

function sha1(data: Buffer, secret: string): string {
  return crypto.createHmac("sha1", secret).update(data).digest("hex");
}

async function sendDiscordMessageFor(vercelEvent: VercelWebhookEvent) {
  const name = vercelEvent.payload.deployment.name;
  const state = vercelEvent.type.split(".")[1].toUpperCase();
  const deploymentDashboardUrl = vercelEvent.payload.links.deployment;
  const projectUrl = vercelEvent.payload.links.project;
  const gitBranch = vercelEvent.payload.deployment.meta["githubCommitRef"];
  const githubOrg = vercelEvent.payload.deployment.meta["githubCommitOrg"];
  const githubCommitRepo =
    vercelEvent.payload.deployment.meta["githubCommitRepo"];
  const githubCommitSha =
    vercelEvent.payload.deployment.meta["githubCommitSha"];
  const githubCommitUrl = `https://github.com/${githubOrg}/${githubCommitRepo}/commit/${githubCommitSha}`;
  const githubCommitMessage =
    vercelEvent.payload.deployment.meta["githubCommitMessage"];
  if (name.toLowerCase() === "builder")
    await Promise.race([
      urls.map((url) => fetch(url + "/api/revalidate")),
      new Promise((resolve, reject) => {
        setTimeout(resolve, 2000);
      }),
    ]);
  let revalidation = false;
  if (name.toLowerCase() === "intelligence-dashboard") {
    await fetch("https://flare.heliumbuilder.com/api/revalidate/all-demo")
      .then(() => {
        revalidation = true;
      })
      .finally(() => {});
  }
  const discordMessage = {
    content: null,
    embeds: [
      {
        title: `Deployment of ${name} in ${gitBranch.toUpperCase()}: ${state}.`,
        url: deploymentDashboardUrl,
        description: `The deployment for ${name} is now ${state}.
revalidation: ${revalidation}
`,
        color: state === "SUCCEEDED" ? 3066993 : 15158332, // Green for success, red for failure
        fields: [
          {
            name: "Project",
            value: `[${name}](${projectUrl})`,
          },
          {
            name: "Branch",
            value: gitBranch,
          },
          {
            name: "Commit",
            value: `[${githubCommitSha}](${githubCommitUrl})`,
          },
          {
            name: "Commit Message",
            value: githubCommitMessage,
          },
        ],
      },
    ],
  };

  console.log("Message for Discord:", discordMessage);

  // Post the message to Discord webhook
  await fetch(new URL(DISCORD_WEBHOOK_URL!), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(discordMessage),
  });
}
