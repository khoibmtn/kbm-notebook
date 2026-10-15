/**
 * Tải tệp lên bằng XMLHttpRequest để có tiến độ upload theo từng tệp (fetch chưa hỗ trợ).
 * Trả JSON của server; lỗi chuẩn `{ error: { code, message } }` → ApiClientError.
 */
import { ApiClientError } from "@/lib/api-client";

export function uploadFormData<T>(
  url: string,
  form: FormData,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.responseType = "text";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiClientError(0, "network_error", "Không kết nối được máy chủ"));
    xhr.onabort = () => reject(new ApiClientError(0, "aborted", "Đã huỷ tải lên"));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(data as T);
        return;
      }
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      reject(new ApiClientError(xhr.status, err?.code ?? "unknown", err?.message ?? `Lỗi ${xhr.status}`));
    };
    xhr.send(form);
  });
}
