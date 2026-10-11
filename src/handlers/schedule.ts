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

  const tomorrow = new Date();
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

    const buffer = Buffer.from(data);
    const envelope = parseApiEnvelope(buffer);

    return Response.json({
      sportType,
      matchDateStart,
      matchDateEnd,
      byteLength: buffer.length,
      firstBytesHex: buffer.subarray(0, 160).toString("hex"),
      firstBytesText: buffer.subarray(0, 300).toString("utf8"),
      message: envelope.message,
      payloadCount: envelope.payload.length,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "schedule request failed",
      },
      { status: 502 },
    );
  }
}
