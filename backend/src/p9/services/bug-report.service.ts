import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { P9Repositories } from "../db/repositories.js";
import { withP9Transaction } from "../db/client.js";
import { P9Error } from "../errors.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface BugReportServiceOptions {
  client: PrismaClient;
  repositories: P9Repositories;
  storageDir: string;
  resendApiKey?: string | undefined;
  supportNotificationEmail?: string | undefined;
  supportNotificationEmails?: string[] | undefined;
  supportFromEmail?: string | undefined;
  logger?: Logger | undefined;
  dispatcher?: ((payload: ResendEmailPayload) => Promise<void>) | undefined;
}

export interface ResendAttachment {
  filename: string;
  content: string; // base64 string
}

export interface ResendEmailPayload {
  from: string;
  to: string[];
  reply_to?: string | undefined;
  subject: string;
  html: string;
  attachments?: ResendAttachment[] | undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatBugReportEmailHtml(params: {
  id: string;
  userId: string;
  userEmail?: string | undefined;
  userDisplayName?: string | undefined;
  category: string;
  description: string;
  context?: string | undefined;
  requestId?: string | undefined;
  screenshotCount: number;
  createdAt: string;
}): string {
  const { id, userId, userEmail, userDisplayName, category, description, context, requestId, screenshotCount, createdAt } = params;
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; background-color: #f9fafb; margin: 0; padding: 24px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; }
    .header { font-size: 20px; font-weight: 700; color: #0d0d0d; margin: 0 0 16px 0; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; }
    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .meta-table td { padding: 8px 0; font-size: 14px; vertical-align: top; }
    .meta-label { color: #6b7280; font-weight: 600; width: 130px; }
    .meta-value { color: #111827; }
    .badge { display: inline-block; background: #f3f4f6; color: #1f2937; padding: 2px 8px; border-radius: 6px; font-weight: 600; font-size: 12px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; }
    .section-title { font-size: 14px; font-weight: 700; color: #374151; margin: 16px 0 8px 0; }
    .description-box { background: #f9fafb; border: 1px solid #f3f4f6; border-radius: 8px; padding: 14px; font-size: 14px; line-height: 1.5; color: #1f2937; white-space: pre-wrap; word-break: break-word; }
    .context-box { background: #1e293b; color: #f8fafc; border-radius: 8px; padding: 12px; font-size: 12px; font-family: ui-monospace, monospace; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">App Bug Report Received</div>
    <table class="meta-table">
      <tr>
        <td class="meta-label">Report ID:</td>
        <td class="meta-value mono">${escapeHtml(id)}</td>
      </tr>
      <tr>
        <td class="meta-label">User:</td>
        <td class="meta-value">${escapeHtml(userDisplayName ? `${userDisplayName} (${userEmail ?? "No email"})` : (userEmail ?? userId))}</td>
      </tr>
      <tr>
        <td class="meta-label">User Email:</td>
        <td class="meta-value mono">${userEmail ? `<a href="mailto:${escapeHtml(userEmail)}" style="color: #2563eb;">${escapeHtml(userEmail)}</a>` : "-"}</td>
      </tr>
      <tr>
        <td class="meta-label">User ID:</td>
        <td class="meta-value mono">${escapeHtml(userId)}</td>
      </tr>
      <tr>
        <td class="meta-label">Category:</td>
        <td class="meta-value"><span class="badge">${escapeHtml(category)}</span></td>
      </tr>
      <tr>
        <td class="meta-label">Created At:</td>
        <td class="meta-value">${escapeHtml(createdAt)}</td>
      </tr>
      ${requestId ? `<tr><td class="meta-label">Request ID:</td><td class="meta-value mono">${escapeHtml(requestId)}</td></tr>` : ""}
      <tr>
        <td class="meta-label">Screenshots:</td>
        <td class="meta-value">${screenshotCount > 0 ? `<strong>${screenshotCount}</strong> screenshot(s) attached` : "None"}</td>
      </tr>
    </table>

    <div class="section-title">Description</div>
    <div class="description-box">${escapeHtml(description)}</div>

    ${context ? `
    <div class="section-title">Client Context</div>
    <div class="context-box">${escapeHtml(context)}</div>
    ` : ""}

    <div class="footer">
      This notification was automatically generated by BinerLabs Support System.
    </div>
  </div>
</body>
</html>
`.trim();
}

async function defaultResendDispatcher(apiKey: string, payload: ResendEmailPayload): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(`Resend API HTTP ${response.status}: ${responseBody}`);
  }
}

export class BugReportService {
  constructor(private readonly options: BugReportServiceOptions) {}

  async create(
    userId: string,
    input: { category: string; description: string; context?: string; includeScreenshot: boolean },
    files: Express.Multer.File[],
    requestId?: string,
  ): Promise<{ id: string; status: "received" }> {
    const accepted = input.includeScreenshot ? files : [];
    if (
      accepted.length > 5 ||
      accepted.some((file) => file.size > MAX_FILE_BYTES || !CONTENT_TYPES.has(file.mimetype))
    ) {
      throw new P9Error("INVALID_INPUT", 400, "Invalid bug report attachment");
    }

    const id = randomUUID();
    const writes: Array<{ file: Express.Multer.File; key: string; temp: string }> = [];

    try {
      await mkdir(this.options.storageDir, { recursive: true, mode: 0o700 });
      for (const file of accepted) {
        const key = `${randomUUID()}.bin`;
        const temp = join(this.options.storageDir, `.${key}.tmp`);
        await writeFile(temp, file.buffer, { mode: 0o600, flag: "wx" });
        await rename(temp, join(this.options.storageDir, key));
        writes.push({ file, key, temp });
      }

      await withP9Transaction(this.options.client, async (tx) => {
        const repo = new P9Repositories(tx);
        await repo.bugReport.create({
          data: {
            id,
            userId,
            category: input.category,
            description: input.description,
            ...(input.context ? { context: input.context } : {}),
            attachments: {
              create: writes.map(({ file, key }) => ({
                storageKey: key,
                contentType: file.mimetype,
                byteSize: file.size,
                sha256: createHash("sha256").update(file.buffer).digest("hex"),
              })),
            },
          },
        });

        await repo.auditEvent.create({
          data: {
            eventType: "bug_report.created",
            outcome: "success",
            actorType: "user",
            resourceType: "bug_report",
            resourceId: id,
            userId,
            ...(requestId ? { requestId } : {}),
            metadata: {},
          },
        });
      });

      const user = await this.options.client.user?.findUnique?.({
        where: { id: userId },
        select: { email: true, displayName: true },
      }).catch(() => null);

      this.dispatchNotification({
        id,
        userId,
        userEmail: user?.email ?? undefined,
        userDisplayName: user?.displayName ?? undefined,
        category: input.category,
        description: input.description,
        context: input.context,
        requestId,
        files: accepted,
      });

      return { id, status: "received" };
    } catch (error) {
      await Promise.all(writes.map(({ key }) => rm(join(this.options.storageDir, key), { force: true })));
      await Promise.all(writes.map(({ temp }) => rm(temp, { force: true })));
      throw error;
    }
  }

  private dispatchNotification(params: {
    id: string;
    userId: string;
    userEmail?: string | undefined;
    userDisplayName?: string | undefined;
    category: string;
    description: string;
    context?: string | undefined;
    requestId?: string | undefined;
    files: Express.Multer.File[];
  }): void {
    const apiKey = this.options.resendApiKey ?? "";
    const rawTo = this.options.supportNotificationEmails ?? this.options.supportNotificationEmail;
    const toEmails: string[] = (
      Array.isArray(rawTo)
        ? rawTo
        : typeof rawTo === "string"
          ? rawTo.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
          : ["rangga@binerlabs.com", "cenna@binerlabs.com", "wuwu@binerlabs.com", "niefa@binerlabs.com"]
    ).filter((email) => email.length > 0);
    const fromEmail = this.options.supportFromEmail ?? "Joy from BinerLabs <joy@binerlabs.com>";

    if (!apiKey || toEmails.length === 0) {
      return;
    }

    const attachments: ResendAttachment[] = params.files.map((file, index) => ({
      filename: file.originalname || `screenshot_${index + 1}.png`,
      content: file.buffer.toString("base64"),
    }));

    const subjectSnippet = params.description.replace(/[\r\n]+/g, " ").trim().slice(0, 50);
    const subject = `[Bug Report] ${params.category}: ${subjectSnippet}${params.description.length > 50 ? "..." : ""}`;

    const html = formatBugReportEmailHtml({
      id: params.id,
      userId: params.userId,
      userEmail: params.userEmail,
      userDisplayName: params.userDisplayName,
      category: params.category,
      description: params.description,
      context: params.context,
      requestId: params.requestId,
      screenshotCount: params.files.length,
      createdAt: new Date().toISOString(),
    });

    const payload: ResendEmailPayload = {
      from: fromEmail,
      to: toEmails,
      ...(params.userEmail ? { reply_to: params.userEmail } : {}),
      subject,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    };

    const runner = this.options.dispatcher
      ? this.options.dispatcher(payload)
      : defaultResendDispatcher(apiKey, payload);

    void runner.catch((err) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (this.options.logger) {
        this.options.logger.error({ err, reportId: params.id, userId: params.userId }, "failed to dispatch bug report email");
      } else {
        console.error(
          JSON.stringify({
            msg: "bug_report.resend_notification.failed",
            reportId: params.id,
            userId: params.userId,
            error: errorMessage,
          }),
        );
      }
    });
  }
}
