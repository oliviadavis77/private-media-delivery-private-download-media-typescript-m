import assert from "node:assert/strict";
import test from "node:test";
import type { MediaBackend } from "../src/infrai_client.js";
import { DeliveryDecisionError, SignedDownloadService } from "../src/signed_download_service.js";

test("a creator cannot receive a download link before processing completes", async () => {
  let downloadPresigns = 0;
  let sessionChecks = 0;
  const backend: MediaBackend = {
    createBucket: async () => ({}),
    headObject: async () => ({ found: true }),
    verifySession: async () => { sessionChecks += 1; },
    presignObject: async (_bucket, _key, body) => {
      if (body.op === "get") downloadPresigns += 1;
      return { url: `https://media.example/${body.op}` };
    },
  };
  const service = new SignedDownloadService(backend, "private-media");
  await service.beginIngestion({
    assetId: "scan-42",
    contentType: "video/mp4",
    maxBytes: 50_000_000,
  });

  await assert.rejects(
    service.createDelivery({ assetId: "scan-42", sessionId: "session-7" }),
    (error: unknown) =>
      error instanceof DeliveryDecisionError && error.reason === "processing_incomplete",
  );
  assert.equal(sessionChecks, 1);
  assert.equal(downloadPresigns, 0);

  await service.markProcessingComplete("scan-42");
  const result = await service.createDelivery({ assetId: "scan-42", sessionId: "session-7" });
  assert.equal(result.downloadUrl, "https://media.example/get");
  assert.equal(downloadPresigns, 1);
});
