import { testDatabase, run } from "./test-database.mjs";
const database = await testDatabase();
try {
  await run(
    [
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/integration/commerce.test.ts",
      "tests/integration/cod.test.ts",
    ],
    database.env,
  );
} finally {
  await database.cleanup();
}
