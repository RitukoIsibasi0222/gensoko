import nodemailer from "nodemailer";
import type { MailMessage, MailSender } from "./mail-sender.js";

type NodeMailTransport = Readonly<{
  sendMail(message: MailMessage): Promise<unknown>;
}>;

export const mailer = nodemailer.createTransport({
  host: process.env.MAIL_HOST ?? "mailpit",
  port: Number(process.env.MAIL_PORT ?? 1025),
  secure: false,
  auth: undefined,
});

export function createNodeMailSender(transport: NodeMailTransport): MailSender {
  return {
    async send(message) {
      await transport.sendMail(message);
    },
  };
}

export const nodeMailSender = createNodeMailSender(mailer);
