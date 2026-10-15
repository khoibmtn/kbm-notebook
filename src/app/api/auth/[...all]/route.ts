import { getAuth } from "@/server/auth/auth";

// better-auth xử lý toàn bộ /api/auth/* (khởi tạo lười để build không cần env).
const handler = (req: Request) => getAuth().handler(req);

export { handler as GET, handler as POST };
