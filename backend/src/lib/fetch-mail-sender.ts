import { z } from "zod";
import type { MailMessage, MailSender } from "./mail-sender.js";
import type { WorkerRuntimeConfig } from "./worker-config.js";

export const MAIL_DELIVERY_ERROR_MESSAGE = "メールを送信できませんでした";

const mailProviderRequestSchema = z.object({
  from: z.email(),
  to: z.email(),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().min(1).optional(),
});

const mailProviderResponseSchema = z.object({
  id: z.string().min(1),
});

type FetchMailSenderDependencies = Readonly<{
  fetch?: typeof fetch;
}>;

function rejectMailDelivery(): never {
  throw new Error(MAIL_DELIVERY_ERROR_MESSAGE);
}

function normalizeMailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function validateMailApiUrl(value: string): string {
  const apiUrl = new URL(value);

  if (
    apiUrl.protocol !== "https:" ||
    apiUrl.username !== "" ||
    apiUrl.password !== "" ||
    apiUrl.hash !== ""
  ) {
    rejectMailDelivery();
  }

  return apiUrl.toString();
}

export function createFetchMailSender(
  { target, mail }: Pick<WorkerRuntimeConfig, "target" | "mail">,
  { fetch: fetchImplementation = globalThis.fetch }: FetchMailSenderDependencies = {},
): MailSender {
  return {
    async send(message: MailMessage): Promise<void> {
      const abortController = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;

      try {
        const apiUrl = validateMailApiUrl(mail.apiUrl);
        const providerRequest = mailProviderRequestSchema.safeParse({
          from: mail.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        const configuredFrom = normalizeMailAddress(mail.from);
        const requestedFrom = normalizeMailAddress(message.from);
        const recipient = normalizeMailAddress(message.to);
        const allowedRecipients = mail.allowedRecipients?.map(normalizeMailAddress) ?? null;

        if (
          !providerRequest.success ||
          requestedFrom !== configuredFrom ||
          (target === "staging" &&
            (!allowedRecipients?.length || !allowedRecipients.includes(recipient))) ||
          !Number.isSafeInteger(mail.timeoutMs) ||
          mail.timeoutMs <= 0
        ) {
          rejectMailDelivery();
        }

        timeout = setTimeout(() => abortController.abort(), mail.timeoutMs);
        const response = await fetchImplementation(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mail.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(providerRequest.data),
          signal: abortController.signal,
        });

        if (!response.ok) {
          rejectMailDelivery();
        }

        const responseBody: unknown = await response.json();
        if (!mailProviderResponseSchema.safeParse(responseBody).success) {
          rejectMailDelivery();
        }
      } catch {
        rejectMailDelivery();
      } finally {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      }
    },
  };
}
