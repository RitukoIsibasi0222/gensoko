import nodemailer from "nodemailer";
import type { MailSender } from "./mail-sender.js";

export const mailer = nodemailer.createTransport({
  host: process.env.MAIL_HOST ?? "mailpit",
  port: Number(process.env.MAIL_PORT ?? 1025),
  secure: false,
  auth: undefined,
});

export const nodeMailSender: MailSender = {
  async send(message) {
    await mailer.sendMail(message);
  },
};
