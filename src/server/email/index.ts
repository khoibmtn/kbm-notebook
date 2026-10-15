import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/server/env";

/**
 * Gửi email của máy chủ (hiện chỉ dùng để xác minh địa chỉ email).
 * - `ConsoleEmailSender` (mặc định khi không có `SMTP_URL`): ghi nội dung + liên kết ra log máy chủ — dùng cho dev.
 * - `SmtpEmailSender` (khi có `SMTP_URL`, vd. `smtps://user:pass@smtp.example.com:465`): gửi thật qua nodemailer.
 */
export type EmailMessage = { to: string; subject: string; text: string; html?: string };

export interface EmailSender {
  readonly kind: "console" | "smtp" | "custom";
  send(message: EmailMessage): Promise<void>;
}

export class ConsoleEmailSender implements EmailSender {
  readonly kind = "console" as const;
  constructor(private readonly log: (line: string) => void = (line) => console.info(line)) {}

  async send(message: EmailMessage): Promise<void> {
    this.log(`[email:console] Tới: ${message.to}\n[email:console] Tiêu đề: ${message.subject}\n${message.text}`);
  }
}

export class SmtpEmailSender implements EmailSender {
  readonly kind = "smtp" as const;
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
  }
}

const g = globalThis as unknown as { __kbmEmailSender?: EmailSender | null };

/** Sender hiện hành: SMTP nếu có `SMTP_URL`, ngược lại ghi ra console. */
export function getEmailSender(): EmailSender {
  if (g.__kbmEmailSender) return g.__kbmEmailSender;
  const e = env();
  g.__kbmEmailSender = e.SMTP_URL ? new SmtpEmailSender(e.SMTP_URL, e.EMAIL_FROM) : new ConsoleEmailSender();
  return g.__kbmEmailSender;
}

/** Chỉ dùng trong test: thay sender (truyền `null` để quay về mặc định). */
export function setEmailSender(sender: EmailSender | null): void {
  g.__kbmEmailSender = sender;
}
