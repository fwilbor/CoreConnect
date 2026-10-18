// Defaults every test file can rely on. Individual files may override.
process.env.APP_TOKEN_SECRET ??= "test-token-secret-that-is-long-enough-123";
process.env.IP_HASH_SECRET ??= "test-secret";
