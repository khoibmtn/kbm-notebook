// Side-effect import: nạp .env trước khi các module khác đọc process.env (custom server, script, worker).
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
