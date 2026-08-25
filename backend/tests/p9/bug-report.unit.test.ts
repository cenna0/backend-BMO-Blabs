import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BugReportService, type ResendEmailPayload } from "../../src/p9/services/bug-report.service.js";

describe("BugReportService", () => {
  it("creates bug report in DB and fires Resend email notification with screenshots", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bmo-bug-test-"));
    const createdReports: any[] = [];
    const createdAudits: any[] = [];
    const dispatchedEmails: ResendEmailPayload[] = [];

    const mockPrisma = {
      user: {
        findUnique: vi.fn(async () => ({
          email: "user@example.com",
          displayName: "Alice User",
        })),
      },
    } as any;
    const mockTx = {
      bugReport: {
        create: vi.fn(async ({ data }) => {
          createdReports.push(data);
          return data;
        }),
      },
      auditEvent: {
        create: vi.fn(async ({ data }) => {
          createdAudits.push(data);
          return data;
        }),
      },
    };

    // mock transaction
    mockPrisma.$transaction = async (fn: any) => fn(mockTx);

    const mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const service = new BugReportService({
      client: mockPrisma,
      repositories: {} as any,
      storageDir: tempDir,
      resendApiKey: "re_test_key",
      supportNotificationEmails: ["rangga@binerlabs.com", "cenna@binerlabs.com", "wuwu@binerlabs.com", "niefa@binerlabs.com"],
      supportFromEmail: "Joy from BinerLabs <joy@binerlabs.com>",
      logger: mockLogger as any,
      dispatcher: async (payload) => {
        dispatchedEmails.push(payload);
      },
    });

    const fakeScreenshot: Express.Multer.File = {
      fieldname: "screenshots",
      originalname: "screen1.png",
      encoding: "7bit",
      mimetype: "image/png",
      size: 1024,
      buffer: Buffer.from("fake-png-content"),
      destination: "",
      filename: "",
      path: "",
      stream: null as any,
    };

    const result = await service.create(
      "user-123",
      {
        category: "UI",
        description: "Button is misaligned on settings sheet",
        context: JSON.stringify({ platform: "android", version: "14" }),
        includeScreenshot: true,
      },
      [fakeScreenshot],
      "req-456",
    );

    expect(result).toMatchObject({
      id: expect.any(String),
      status: "received",
    });

    expect(createdReports).toHaveLength(1);
    expect(createdReports[0]).toMatchObject({
      userId: "user-123",
      category: "UI",
      description: "Button is misaligned on settings sheet",
      context: '{"platform":"android","version":"14"}',
    });
    expect(createdReports[0].attachments.create).toHaveLength(1);
    expect(createdReports[0].attachments.create[0]).toMatchObject({
      contentType: "image/png",
      byteSize: 1024,
    });

    expect(createdAudits).toHaveLength(1);
    expect(createdAudits[0]).toMatchObject({
      eventType: "bug_report.created",
      outcome: "success",
      userId: "user-123",
      requestId: "req-456",
    });

    // Verify email payload
    expect(dispatchedEmails).toHaveLength(1);
    const email = dispatchedEmails[0]!;
    expect(email.from).toBe("Joy from BinerLabs <joy@binerlabs.com>");
    expect(email.to).toEqual(["rangga@binerlabs.com", "cenna@binerlabs.com", "wuwu@binerlabs.com", "niefa@binerlabs.com"]);
    expect(email.reply_to).toBe("user@example.com");
    expect(email.html).toContain("Alice User");
    expect(email.html).toContain("user@example.com");
    expect(email.subject).toContain("[Bug Report] UI: Button is misaligned on settings sheet");
    expect(email.html).toContain("user-123");
    expect(email.html).toContain("Button is misaligned on settings sheet");
    expect(email.html).toContain("platform");
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments![0]!.filename).toBe("screen1.png");
    expect(email.attachments![0]!.content).toBe(Buffer.from("fake-png-content").toString("base64"));

    await rm(tempDir, { recursive: true, force: true });
  });

  it("does not fail create response if Resend dispatcher fails", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bmo-bug-test-2-"));
    const mockPrisma = {
      user: {
        findUnique: vi.fn(async () => ({
          email: "user@example.com",
          displayName: "Alice User",
        })),
      },
    } as any;
    const mockTx = {
      bugReport: { create: vi.fn(async ({ data }) => data) },
      auditEvent: { create: vi.fn(async ({ data }) => data) },
    };
    mockPrisma.$transaction = async (fn: any) => fn(mockTx);

    const mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    const service = new BugReportService({
      client: mockPrisma,
      repositories: {} as any,
      storageDir: tempDir,
      resendApiKey: "re_test_key",
      supportNotificationEmails: ["rangga@binerlabs.com", "cenna@binerlabs.com", "wuwu@binerlabs.com", "niefa@binerlabs.com"],
      supportFromEmail: "Joy from BinerLabs <joy@binerlabs.com>",
      logger: mockLogger as any,
      dispatcher: async () => {
        throw new Error("Resend rate limited");
      },
    });

    const result = await service.create(
      "user-123",
      {
        category: "GENERAL",
        description: "Something is broken",
        includeScreenshot: false,
      },
      [],
    );

    expect(result.status).toBe("received");
    expect(result.id).toBeDefined();

    // Allow async tick for rejection handler
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: result.id,
        userId: "user-123",
      }),
      "failed to dispatch bug report email",
    );

    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects invalid attachments (>5MB or wrong mimetype)", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "bmo-bug-test-3-"));
    const service = new BugReportService({
      client: {} as any,
      repositories: {} as any,
      storageDir: tempDir,
    });

    const oversizedFile: Express.Multer.File = {
      fieldname: "screenshots",
      originalname: "big.png",
      encoding: "7bit",
      mimetype: "image/png",
      size: 6 * 1024 * 1024,
      buffer: Buffer.alloc(10),
      destination: "",
      filename: "",
      path: "",
      stream: null as any,
    };

    await expect(
      service.create(
        "user-123",
        { category: "GENERAL", description: "Bug", includeScreenshot: true },
        [oversizedFile],
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      status: 400,
    });

    const invalidMimeFile: Express.Multer.File = {
      fieldname: "screenshots",
      originalname: "test.pdf",
      encoding: "7bit",
      mimetype: "application/pdf",
      size: 1024,
      buffer: Buffer.alloc(10),
      destination: "",
      filename: "",
      path: "",
      stream: null as any,
    };

    await expect(
      service.create(
        "user-123",
        { category: "GENERAL", description: "Bug", includeScreenshot: true },
        [invalidMimeFile],
      ),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      status: 400,
    });

    await rm(tempDir, { recursive: true, force: true });
  });
});
