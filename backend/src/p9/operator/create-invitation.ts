import { createP9Client, disconnectP9Client } from "../db/client.js";
import { P9Repositories } from "../db/repositories.js";
import { parseP9Config } from "../config.js";
import { InvitationService } from "../services/invitation.service.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const email = argument("--email");
  const hoursText = argument("--expires-in-hours") ?? "72";
  const hours = Number(hoursText);
  if (!email || !Number.isFinite(hours) || hours <= 0 || hours > 8_760) {
    throw new Error("usage: npm run p9:invite -- --email user@example.com [--expires-in-hours 72]");
  }
  const config = parseP9Config({ ...process.env, P9_ENABLED: "true" });
  const client = createP9Client(config);
  try {
    const invitation = await new InvitationService(new P9Repositories(client)).create({
      email,
      expiresAt: new Date(Date.now() + hours * 3_600_000),
      requestId: InvitationService.operatorRequestId(),
    });
    process.stdout.write(`Invitation created for ${invitation.email}; expires ${invitation.expiresAt.toISOString()}\n`);
    process.stdout.write(`Invitation token (display once): ${invitation.secret}\n`);
  } finally {
    await disconnectP9Client(client);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "invitation creation failed"}\n`);
  process.exitCode = 1;
});
