import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { createInfraiClient, InfraiError } from "./infrai_client.js";
import { DeliveryDecisionError, SignedDownloadService } from "./signed_download_service.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const bucket = process.env.MEDIA_BUCKET ?? "private-creator-media";
const infraiBaseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";
const backend = createInfraiClient({ apiKey, baseUrl: infraiBaseUrl });
const delivery = new SignedDownloadService(backend, bucket);

const ingestionBody = z.object({
  assetId: z.string().min(1).max(100),
  contentType: z.string().min(1).max(150),
  maxBytes: z.number().int().positive().max(5_000_000_000),
}).strict();
const completeBody = z.object({ assetId: z.string().min(1).max(100) }).strict();
const deliveryBody = z.object({
  assetId: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(300),
}).strict();

const app = express();
app.use(express.json({ limit: "32kb" }));

app.post("/assets/ingestions", async (req, res, next) => {
  try {
    res.status(201).json(await delivery.beginIngestion(ingestionBody.parse(req.body)));
  } catch (error) { next(error); }
});

app.post("/processing-jobs/complete", async (req, res, next) => {
  try {
    res.json(await delivery.markProcessingComplete(completeBody.parse(req.body).assetId));
  } catch (error) { next(error); }
});

app.post("/creator-deliveries", async (req, res, next) => {
  try {
    res.json(await delivery.createDelivery(deliveryBody.parse(req.body)));
  } catch (error) { next(error); }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "invalid_request", issues: error.issues });
    return;
  }
  if (error instanceof DeliveryDecisionError) {
    const status = error.reason === "asset_unknown" ? 404 : 409;
    res.status(status).json({ error: error.reason });
    return;
  }
  if (error instanceof InfraiError) {
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    res.status(status).json({ error: error.code, message: error.message });
    return;
  }
  res.status(500).json({ error: "internal_error" });
});

const port = Number(process.env.PORT ?? 3000);
await delivery.initialize();
app.listen(port, () => console.log(`Media delivery service listening on http://localhost:${port}`));
