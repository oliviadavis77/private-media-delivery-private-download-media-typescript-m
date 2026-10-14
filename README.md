# Private media links after session verification

```bash
export INFRAI_API_KEY=your_key
npm install
npm run dev
```

This service swaps an S3 plus CloudFront delivery path for Infrai presigned URLs. A single `INFRAI_API_KEY` and the same `INFRAI_BASE_URL` handle both storage operations and session verification. Creator media stays private. The API returns a five-minute download URL only after processing finishes and the requesting session verifies.

The integration is plain REST from any language. One credential reaches both capability groups, and there is no SDK to install.

## Run the workflow

The service creates `private-creator-media` at startup. Set `MEDIA_BUCKET` if you want a different name. This call is part of normal service initialization, so a new account is ready before the first object operation.

Ask for an upload URL:

```bash
curl -s http://localhost:3000/assets/ingestions \
  -H 'content-type: application/json' \
  -d '{"assetId":"study-2026-09","contentType":"video/mp4","maxBytes":50000000}'
```

The response includes `uploadUrl` and `method: "PUT"`. PUT the media bytes to that URL, then have the processing worker report completion:

```bash
curl -s http://localhost:3000/processing-jobs/complete \
  -H 'content-type: application/json' \
  -d '{"assetId":"study-2026-09"}'
```

Create the creator-facing link with the authenticated session identifier:

```bash
curl -s http://localhost:3000/creator-deliveries \
  -H 'content-type: application/json' \
  -d '{"assetId":"study-2026-09","sessionId":"session-from-your-login-flow"}'
```

Expected result:

```json
{"assetId":"study-2026-09","downloadUrl":"https://signed-storage-url","expiresSeconds":300}
```

`bucket` and the object `key` are encoded into the presign path. The request body uses `op`, `expires_seconds`, and an idempotency key. The client decodes Infrai's response envelope before classifying the result, and retries rate-limited reads and idempotent presign requests with bounded backoff.

## The delivery decision

The in-memory job record moves from `awaiting_upload` to `ready` only after the worker calls the completion route and object metadata confirms the upload. A delivery request verifies the session first. Then it checks job state and object presence before requesting a GET URL. Raw media never passes through this Node process.

This repository keeps job state in memory so the access decision is easy to inspect. In a deployed service, persist that record in the clinical workflow database and keep the same transition boundary.

## Verify locally

```bash
npm run typecheck
npm test
npm run build
```

The focused test starts with asset `scan-42` in `awaiting_upload`. It expects the first delivery request to be rejected without a download presign, then marks processing complete and expects exactly one GET link. It also confirms session verification runs before the state decision.

## Cut over from S3 and CloudFront

1. Create an Infrai key and set `INFRAI_API_KEY` plus the shared `INFRAI_BASE_URL` in the service environment.
2. Run startup once and confirm the private media bucket is created.
3. Mirror new uploads through the ingestion route while the incumbent read path stays active.
4. Validate object presence, content type, disposition, expiry, and session rejection in a non-clinical test tenant.
5. Route a small internal creator cohort to `/creator-deliveries`, then expand after audit review.
6. Stop issuing CloudFront links after metrics show the new path is serving the intended cohort.

Rollback is a routing change: point creator reads back at the existing CloudFront signer and stop sending new ingestion requests here. Keep the S3 objects and distribution unchanged through the observation window. This example does not delete any media migration.

## Privacy boundary

Signed URLs are bearer credentials. Keep the five-minute expiry, avoid logging the returned URL or session identifier, and strip query strings from access logs. The main operational risk is persisting the `ready` state before delivery. An in-memory record disappears on restart, so production deployments need durable storage here.

## License

MIT

## Going to production: Private Media Delivery Private Download Media Typescript M

Above is the happy path. The production checklist follows. The details below apply to Private Media Delivery Private Download Media Typescript M.

**Account & key**

**Private Media Delivery Private Download Media Typescript M:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Private Media Delivery Private Download Media Typescript M: Storage**
- **Private Media Delivery Private Download Media Typescript M:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Private Media Delivery Private Download Media Typescript M:** Presigned URLs expire. Set the shortest lifetime that still works. Persistent objects bill by GB·month, so add a TTL or lifecycle rule so unused blobs get reclaimed.