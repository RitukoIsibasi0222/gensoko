import { describe, expect, it, vi } from "vitest";
import type { MailMessage } from "./mail-sender.js";
import { createNodeMailSender } from "./mail.js";

describe("createNodeMailSender", () => {
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
});
