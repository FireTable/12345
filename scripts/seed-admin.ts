export * from "./init-admin";
import { initAdminUser } from "./init-admin";

if (process.argv[1]?.endsWith("seed-admin.ts")) {
  initAdminUser()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
