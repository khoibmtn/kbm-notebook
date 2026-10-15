import { notFound } from "next/navigation";
import { DevSlides } from "./dev-slides";
import sample from "./sample-deck.json";

/**
 * Trang xem thử editor slide (CHỈ môi trường dev). Dữ liệu lấy từ fixture JSON dùng cho dev/test,
 * không phải dữ liệu sản phẩm.
 */
export default function DevSlidesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { _comment, ...deck } = sample;
  return <DevSlides initial={deck} banner={_comment} />;
}
