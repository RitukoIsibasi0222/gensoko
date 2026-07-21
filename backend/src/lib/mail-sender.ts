export type MailMessage = Readonly<{
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}>;

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}
