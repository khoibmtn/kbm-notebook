"use client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : undefined,
});

export const { signIn, signUp, signOut, useSession } = authClient;

/** Scope Drive — chỉ xin khi người dùng chủ động kết nối (chưa có UI Drive ở P0). */
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/**
 * Plumbing cho luồng "Kết nối Google Drive": liên kết tài khoản Google với scope drive.readonly.
 * UI sẽ được xây ở phase Connectors.
 */
export async function connectGoogleDrive(callbackURL = "/settings") {
  return authClient.linkSocial({
    provider: "google",
    scopes: [GOOGLE_DRIVE_SCOPE],
    callbackURL,
  });
}
