import { ENTRY_ORIGIN } from "../config/site.js";

type SiteBootstrap = {
digit: string;
dataApiBaseUrl: string;
entryOrigin: string;
};

const cached: SiteBootstrap = {
digit: "foth",
dataApiBaseUrl: "https://apis-data10.tcpwe138stya.ru",
entryOrigin: ENTRY_ORIGIN,
};

export async function loadSiteBootstrap(): Promise<SiteBootstrap> {
return cached;
}
