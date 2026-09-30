import { randomUUID } from "node:crypto";
import type { MediaBackend } from "./infrai_client.js";

export type ProcessingState = "awaiting_upload" | "ready";

type AssetRecord = {
  objectKey: string;
  state: ProcessingState;
};

export class DeliveryDecisionError extends Error {
  readonly reason: "asset_unknown" | "processing_incomplete" | "object_missing";

  constructor(reason: "asset_unknown" | "processing_incomplete" | "object_missing") {
    super(reason);
    this.reason = reason;
    this.name = "DeliveryDecisionError";
  }
}

export class SignedDownloadService {
  private readonly assets = new Map<string, AssetRecord>();
  private readonly backend: MediaBackend;
  private readonly bucket: string;

  constructor(backend: MediaBackend, bucket: string) {
    this.backend = backend;
    this.bucket = bucket;
  }

  async initialize(): Promise<void> {
    await this.backend.createBucket(this.bucket);
  }

  async beginIngestion(input: {
    assetId: string;
    contentType: string;
    maxBytes: number;
  }): Promise<{ assetId: string; uploadUrl: string; method: "PUT" }> {
    const objectKey = `media/${input.assetId}/source`;
    const signed = await this.backend.presignObject(this.bucket, objectKey, {
      op: "put",
      expires_seconds: 600,
      content_type: input.contentType,
      max_bytes: input.maxBytes,
      idempotency_key: `ingest-${input.assetId}`,
    });
    this.assets.set(input.assetId, { objectKey, state: "awaiting_upload" });
    return { assetId: input.assetId, uploadUrl: signed.url, method: "PUT" };
  }

  async markProcessingComplete(assetId: string): Promise<{ assetId: string; state: "ready" }> {
    const asset = this.requireAsset(assetId);
    const object = await this.backend.headObject(this.bucket, asset.objectKey);
    if (!object.found) throw new DeliveryDecisionError("object_missing");
    asset.state = "ready";
    return { assetId, state: "ready" };
  }

  async createDelivery(input: {
    assetId: string;
    sessionId: string;
  }): Promise<{ assetId: string; downloadUrl: string; expiresSeconds: number }> {
    await this.backend.verifySession(input.sessionId);
    const asset = this.requireAsset(input.assetId);
    if (asset.state !== "ready") {
      throw new DeliveryDecisionError("processing_incomplete");
    }
    const object = await this.backend.headObject(this.bucket, asset.objectKey);
    if (!object.found) throw new DeliveryDecisionError("object_missing");

    const expiresSeconds = 300;
    const signed = await this.backend.presignObject(this.bucket, asset.objectKey, {
      op: "get",
      expires_seconds: expiresSeconds,
      response_disposition: `attachment; filename="${input.assetId}.media"`,
      idempotency_key: `delivery-${input.assetId}-${randomUUID()}`,
    });
    return { assetId: input.assetId, downloadUrl: signed.url, expiresSeconds };
  }

  private requireAsset(assetId: string): AssetRecord {
    const asset = this.assets.get(assetId);
    if (!asset) throw new DeliveryDecisionError("asset_unknown");
    return asset;
  }
}
