import { z } from "zod";
import type { MailMessage, MailSender } from "./mail-sender.js";
import { normalizeMailAddress, parseSafeHttpsUrl } from "./mail-runtime-validation.js";
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
  id: z.string().trim().min(1),
});

type FetchMailSenderDependencies = Readonly<{
  fetch?: typeof fetch;
}>;

function rejectMailDelivery(): never {
  throw new Error(MAIL_DELIVERY_ERROR_MESSAGE);
}

function cancelResponseBody(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    if (cancellation) {
      void cancellation.catch(() => undefined);
    }
  } catch {
    // response bodyのcleanup失敗もprovider詳細を露出しない固定errorへ収束させる。
  }
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
        const apiUrl = parseSafeHttpsUrl(mail.apiUrl);
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
        const hasInvalidAllowedRecipient =
          allowedRecipients?.some((value) => value === null) ?? false;
        const isRecipientAllowed =
          recipient !== null && allowedRecipients !== null && allowedRecipients.includes(recipient);

        if (
          apiUrl === null ||
          !providerRequest.success ||
          configuredFrom === null ||
          requestedFrom === null ||
          recipient === null ||
          hasInvalidAllowedRecipient ||
          requestedFrom !== configuredFrom ||
          (target === "staging" && !allowedRecipients?.length) ||
          (allowedRecipients !== null && !isRecipientAllowed) ||
          !Number.isSafeInteger(mail.timeoutMs) ||
          mail.timeoutMs <= 0
        ) {
          rejectMailDelivery();
        }

        const timeoutFailure = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            abortController.abort();
            reject(new Error(MAIL_DELIVERY_ERROR_MESSAGE));
          }, mail.timeoutMs);
        });
        const response = await Promise.race([
          fetchImplementation(apiUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${mail.apiKey}`,
              "Content-Type": "application/json",
              "User-Agent": "Gensoko-Worker/1.0",
            },
            body: JSON.stringify(providerRequest.data),
            signal: abortController.signal,
          }),
          timeoutFailure,
        ]);

        if (!response.ok) {
          cancelResponseBody(response);
          rejectMailDelivery();
        }

        const responseBody: unknown = await Promise.race([response.json(), timeoutFailure]);
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
