import { ApiClient } from "../api/client.js";
import { parseApiEnvelope } from "../api/protobuf.js";

export async function listScheduledMatches(
  sportTypeRaw: string | null,
  startRaw: string | null,
  endRaw: string | null,
): Promise<Response> {
  const sportType = Number(sportTypeRaw ?? 1);

  if (!Number.isFinite(sportType)) {
    return Response.json({ error: "invalid sportType" }, { status: 400 });
  }

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const defaultEnd = new Date(tomorrow);
  defaultEnd.setDate(defaultEnd.getDate() + 3);

  const matchDateStart = Number(startRaw ?? tomorrow.getTime());
  const matchDateEnd = Number(endRaw ?? defaultEnd.getTime());

  if (
    !Number.isFinite(matchDateStart) ||
    !Number.isFinite(matchDateEnd) ||
    matchDateStart >= matchDateEnd
  ) {
    return Response.json({ error: "invalid date range" }, { status: 400 });
  }

  try {
    const data = await new ApiClient().fetchScheduledMatches(
      sportType,
      matchDateStart,
      matchDateEnd,
    );

    const envelope = parseApiEnvelope(Buffer.from(data));

    return Response.json({
      sportType,
      matchDateStart,
      matchDateEnd,
      message: envelope.message,
      payloadCount: envelope.payload.length,
      payloadSizes: envelope.payload.map((item) => item.length),
      payloadPreview: envelope.payload.map((item) =>
        item.subarray(0, 80).toString("hex"),
      ),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "schedule request failed",
      },
      { status: 502 },
    );
  }
}
