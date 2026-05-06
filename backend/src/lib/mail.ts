import nodemailer from "nodemailer";

export const mailer = nodemailer.createTransport({
  host: process.env.MAIL_HOST ?? "mailpit",
  port: Number(process.env.MAIL_PORT ?? 1025),
  secure: false,
  auth: undefined,
});
