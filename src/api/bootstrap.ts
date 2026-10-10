import { ENTRY_ORIGIN, USER_AGENT } from "../config/site.js";

type SiteBootstrap = {
  digit: string;
  dataApiBaseUrl: string;
  entryOrigin: string;
};

let cached: SiteBootstrap | null = null;

export async function loadSiteBootstrap(): Promise<SiteBootstrap> {
  if (cached) return cached;

  const response = await fetch(`${ENTRY_ORIGIN}/`, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": `${ENTRY_ORIGIN}/`,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`entry page ${response.status}; body: ${body}`);
  }

  const html = await response.text();

  const match = html.match(
    /"([a-z]+)","(?:\\u002F|\/)",true,"production","https:\\u002F\\u002F(apis-data\d+\.[^"]+)"/,
  );

  if (!match?.[1] || !match[2]) {
    throw new Error("entry bootstrap not found");
  }

  cached = {
    digit: match[1],
    dataApiBaseUrl: `https://${match[2].replace(/\\u002F/g, "/")}`,
    entryOrigin: ENTRY_ORIGIN,
  };

  return cached;
}
