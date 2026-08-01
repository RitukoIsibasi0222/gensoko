import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailMessage } from "./mail-sender.js";
import { createNodeMailSender } from "./mail.js";

describe("createNodeMailSender", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("共通MailSender messageを既存Nodemailer transportへそのまま渡す", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "node-message-id" });
    const sender = createNodeMailSender({ sendMail });
    const message: MailMessage = {
      from: "noreply@gensoko.local",
      to: "user@example.test",
      subject: "確認メール",
      text: "本文",
      html: "<p>本文</p>",
    };

    await expect(sender.send(message)).resolves.toBeUndefined();

    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledWith(message);
  });

  it("Nodemailer transportの送信失敗を呼出元へ伝播し、adapterではlogを出さない", async () => {
    const transportError = new Error("SMTP password=sensitive-secret");
    const sendMail = vi.fn().mockRejectedValue(transportError);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sender = createNodeMailSender({ sendMail });
    const message: MailMessage = {
      from: "noreply@gensoko.local",
      to: "user@example.test",
      subject: "確認メール",
      text: "本文",
    };

    await expect(sender.send(message)).rejects.toBe(transportError);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
