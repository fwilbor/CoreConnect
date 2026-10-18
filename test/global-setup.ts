import { resetDatabase } from "../scripts/db-reset";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/coreconnect_test";

export default async function setup() {
  await resetDatabase(TEST_DATABASE_URL);
}
