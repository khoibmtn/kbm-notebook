import type { securityVi } from "./security.vi";

/** English strings for security-related UI. Must contain every key from security.vi.ts. */
export const securityEn: Record<keyof typeof securityVi, string> = {
  "studio.share.privateSourcesOnly": "This artifact was generated from private sources, so it can only stay Private. Regenerate it from shared sources to share it.",
  "studio.privateSourcesBadge": "Uses private sources",
  "email.verify.subject": "Verify your KBM Notebook email",
  "email.verify.body": "Hello {name},\n\nOpen the link below to verify your email address (valid for 24 hours):\n{url}\n\nIf you did not sign up for KBM Notebook, ignore this email.",
  "auth.verify.banner": "Your email is not verified yet. Until you verify it, you cannot join notebooks through invitations or receive artifacts shared by email.",
  "auth.verify.resend": "Resend verification email",
  "auth.verify.sent": "Verification email sent to {email}. Check your inbox.",
  "auth.verify.resendFailed": "Could not resend the verification email. Try again in a few minutes.",
  "auth.verify.registered": "We sent a verification email to {email}.",
  "invite.verifyFirst": "You need to verify {email} before joining the notebook. Open the verification email we sent you, then come back to this page.",
  "security.chat.noCitations": "This answer cites no source, so it cannot be verified. Review it carefully or ask a more specific question tied to the sources.",
};
