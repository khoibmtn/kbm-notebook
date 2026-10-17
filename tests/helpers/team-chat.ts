/* eslint-disable @typescript-eslint/no-explicit-any -- helper test: JSON phản hồi được kiểm tra bằng expect */
import { GET as listChannels, POST as createChannel } from "@/app/api/notebooks/[id]/channels/route";
import { GET as listMessages, POST as postMessage } from "@/app/api/channels/[channelId]/messages/route";
import { createNotebookWithMembers } from "./fixtures";
import { makeRequest, params, type TestUser } from "./users";

export async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function getChannels(user: TestUser, notebookId: string) {
  const res = await listChannels(makeRequest(`/api/notebooks/${notebookId}/channels`, { user }), params({ id: notebookId }));
  return { res, body: await json(res) };
}

export async function generalChannelId(user: TestUser, notebookId: string): Promise<string> {
  const { body } = await getChannels(user, notebookId);
  return body.channels.find((c: any) => c.type === "general").id;
}

export async function openDm(user: TestUser, notebookId: string, otherId: string) {
  const res = await createChannel(
    makeRequest(`/api/notebooks/${notebookId}/channels`, { method: "POST", user, body: { type: "dm", userId: otherId } }),
    params({ id: notebookId }),
  );
  return { res, body: await json(res) };
}

export async function send(user: TestUser, channelId: string, body: Record<string, unknown>) {
  const res = await postMessage(
    makeRequest(`/api/channels/${channelId}/messages`, { method: "POST", user, body: { kind: "text", ...body } }),
    params({ channelId }),
  );
  return { res, body: await json(res) };
}

export async function fetchMessages(user: TestUser, channelId: string, query = "") {
  const res = await listMessages(makeRequest(`/api/channels/${channelId}/messages`, { user, query }), params({ channelId }));
  return { res, body: await json(res) };
}

/** Notebook gồm owner + viewer/editor/admin; tiện cho hầu hết bài test chat. */
export async function chatFixture() {
  const fx = await createNotebookWithMembers(["viewer", "editor", "admin"]);
  const general = await generalChannelId(fx.owner, fx.notebook.id);
  return { ...fx, general };
}
