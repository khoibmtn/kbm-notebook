import { z } from "zod";

/**
 * Tên mô hình AI do client gửi: chỉ chữ/số/`.`/`_`/`-` (vd. `gemini-2.5-flash`). Chặn đường dẫn, URL, khoảng trắng,
 * ký tự điều khiển để tên không bị nối thẳng vào đường dẫn API của nhà cung cấp. Tên cụ thể vẫn do nhà cung cấp kiểm tra.
 */
export const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export const modelNameSchema = z.string().trim().regex(MODEL_NAME_RE, "Tên mô hình không hợp lệ");
