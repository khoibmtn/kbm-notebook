export type UploadedFile = { fileId: string; name: string; mime: string; size: number };

/** Tải một tệp lên kênh bằng XHR để có tiến độ. Trả về thông tin tệp (fileId) để gửi kèm tin nhắn. */
export function uploadChannelFile(
  channelId: string,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/channels/${channelId}/upload`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new Error("aborted"));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const first = (data as { files?: UploadedFile[] } | null)?.files?.[0];
        if (first) resolve(first);
        else reject(new Error("invalid_response"));
        return;
      }
      const message = (data as { error?: { message?: string } } | null)?.error?.message;
      reject(new Error(message ?? `Lỗi ${xhr.status}`));
    };
    signal?.addEventListener("abort", () => xhr.abort());
    const form = new FormData();
    form.append("files", file);
    xhr.send(form);
  });
}
