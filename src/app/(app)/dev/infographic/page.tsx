import { notFound } from "next/navigation";
import { DevInfographic } from "./dev-infographic";
import sample from "./sample-infographic.json";

/** Trang xem thử infographic (CHỈ môi trường dev); dữ liệu từ fixture dev, không phải dữ liệu sản phẩm. */
export default function DevInfographicPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { _comment, ...content } = sample;
  return <DevInfographic initial={content} banner={_comment} />;
}
