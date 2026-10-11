import { rot47 } from "../crypto/rot47.js";
import {
  requestHashPrefix,
  sortRequestParams,
  type RequestParams,
} from "../crypto/request-hash.js";
import {
  PATH,
  SIGNATURE,
  SIGNATURE_CODES,
  USER_AGENT,
} from "../config/site.js";
import { loadSiteBootstrap } from "./bootstrap.js";
import {
  parseApiEnvelope,
  parseLiveMatchList,
  parseMatchDetail,
  parseSignatureEntries,
  parseStreamDetail,
  parseUserGeo,
  type LiveMatch,
  type StreamItem,
  type UserGeo,
} from "./protobuf.js";

type RequestContext = { referer: string; origin: string };

function headers(context: RequestContext): Record<string, string> {
  return {
    Referer: context.referer,
    Origin: context.origin,
    Accept: "application/json, text/plain, */*",
    "User-Agent": USER_AGENT,
  };
}

export class ApiClient {
  private signatureKeys = new Map<number, string>();
  private signatureCacheKey = "";
  private siteConfig: Record<string, string> | null = null;
  private dataApiBaseUrl: string | null = null;
  private digit: string | null = null;
  private context: RequestContext | null = null;
  private playerReferer: string | null = null;

  private async bootstrap(): Promise<void> {
    if (this.dataApiBaseUrl && this.digit && this.context) return;

    const site = await loadSiteBootstrap();

    this.dataApiBaseUrl = site.dataApiBaseUrl.replace(/\/$/, "");
    this.digit = site.digit;
    this.context = {
      referer: `${site.entryOrigin}/`,
      origin: site.entryOrigin,
    };
  }

  private baseUrl(): string {
    if (!this.dataApiBaseUrl) {
      throw new Error("data api base url not set");
    }

    return this.dataApiBaseUrl;
  }

  private req(): RequestContext {
    if (!this.context) {
      throw new Error("request context not set");
    }

    return this.context;
  }

  private async loadSiteConfig(): Promise<Record<string, string>> {
    await this.bootstrap();

    if (this.siteConfig) return this.siteConfig;

    const response = await fetch(`${this.baseUrl()}${PATH.params}`, {
      headers: headers(this.req()),
    });

    if (!response.ok) {
      throw new Error(`site config request failed: HTTP=${response.status}`);
    }

    this.siteConfig = JSON.parse(
      rot47(await response.text()),
    ) as Record<string, string>;

    return this.siteConfig;
  }

  async resolvePlayerReferer(): Promise<string> {
    if (this.playerReferer) return this.playerReferer;

    const config = await this.loadSiteConfig();

    const webClients = JSON.parse(
      config["common:web:client"] ?? "{}",
    ) as Record<string, { iframePlayerDomains?: string[] }>;

    for (const client of Object.values(webClients)) {
      const host = client.iframePlayerDomains?.[0];

      if (host) {
        this.playerReferer = `https://${host
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "")}/`;

        return this.playerReferer;
      }
    }

    const domains = JSON.parse(
      config.g_player_domains ?? "{}",
    ) as Record<string, string[]>;

    await this.bootstrap();

    const fallback = domains[this.digit ?? ""]?.find((item) =>
      /^https?:\/\//i.test(item),
    );

    if (!fallback) {
      throw new Error("player referer not found");
    }

    this.playerReferer = `${new URL(fallback).origin}/`;

    return this.playerReferer;
  }

  async resolveCslConfig(): Promise<{
    salt: string;
    maxRetryTimes: number;
    minFetchTimeout: number;
  }> {
    const config = await this.loadSiteConfig();

    const raw = JSON.parse(
      config["common:cdnSmartLink"] ?? "{}",
    ) as {
      auth?: { salt?: string };
      maxRetryTimes?: number;
      minFetchTimeout?: number;
    };

    return {
      salt: raw.auth?.salt ?? "00",
      maxRetryTimes: raw.maxRetryTimes ?? 2,
      minFetchTimeout: raw.minFetchTimeout ?? 3.2,
    };
  }

  async fetchUserGeo(): Promise<UserGeo> {
    await this.bootstrap();

    return parseUserGeo(
      Buffer.from(await this.get(PATH.userInfo)),
    );
  }

  private async loadSignatures(
    matchId: string | number,
    sportType: number,
  ): Promise<void> {
    await this.bootstrap();

    const cacheKey = `${matchId}:${sportType}`;

    if (
      this.signatureCacheKey === cacheKey &&
      this.signatureKeys.size
    ) {
      return;
    }

    const query = new URLSearchParams({
      stream: "true",
      sportType: String(sportType),
      matchId: String(matchId),
    });

    for (const code of SIGNATURE_CODES) {
      query.append("code", String(code));
    }

    const { message, payload } = parseApiEnvelope(
      Buffer.from(
        await this.get(`${PATH.signatures}?${query}`),
      ),
    );

    if (message !== "Success") {
      throw new Error(
        `signature bootstrap failed: ${message}`,
      );
    }

    this.signatureKeys = new Map(
      payload
        .flatMap((chunk) => parseSignatureEntries(chunk))
        .map((entry) => [entry.code, entry.value]),
    );

    this.signatureCacheKey = cacheKey;
  }

  async fetchLiveMatches(
    sportType: number,
  ): Promise<LiveMatch[]> {
    await this.loadSignatures(0, sportType);

    const params: RequestParams = {
      language: 0,
      sportType,
      stream: true,
    };

    return parseLiveMatchList(
      Buffer.from(
        await this.signedGet(
          PATH.live,
          params,
          SIGNATURE.live,
        ),
      ),
    );
  }

  async fetchScheduledMatches(
    sportType: number,
    matchDateStart: number,
    matchDateEnd: number,
  ): Promise<ArrayBuffer> {
    await this.loadSignatures(0, sportType);

    const params: RequestParams = {
      language: 0,
      sportType,
      stream: true,
      matchDateStart,
      matchDateEnd,
    };

    return this.signedGet(
      PATH.schedule,
      params,
      SIGNATURE.schedule,
    );
  }

  async fetchMatchDetail(
    matchId: string,
    sportType: number,
  ): Promise<{ stream: StreamItem[] }> {
    await this.loadSignatures(matchId, sportType);

    const params: RequestParams = {
      matchId,
      sportType,
      language: 0,
      stream: true,
    };

    return parseMatchDetail(
      Buffer.from(
        await this.signedGet(
          PATH.matchDetail,
          params,
          SIGNATURE.detail,
        ),
      ),
    );
  }

  async fetchStreamDetail(input: {
    streamId: string;
    matchId: string;
    sportType: number;
    siteType: number;
    country?: string;
    continent?: string;
  }): Promise<{
    stream: StreamItem;
    sessionToken: string;
  }> {
    await this.bootstrap();

    if (!this.digit) {
      throw new Error("site digit not set");
    }

    const url = new URL(
      `${this.baseUrl()}${PATH.streamDetail}`,
    );

    url.searchParams.set("streamId", input.streamId);
    url.searchParams.set("matchId", input.matchId);
    url.searchParams.set(
      "sportType",
      String(input.sportType),
    );
    url.searchParams.set(
      "siteType",
      String(input.siteType),
    );
    url.searchParams.set("digit", this.digit);

    if (input.continent) {
      url.searchParams.set("continent", input.continent);
    }

    if (input.country) {
      url.searchParams.set("country", input.country);
    }

    const response = await fetch(url, {
      headers: headers(this.req()),
    });

    const buffer = Buffer.from(
      await response.arrayBuffer(),
    );

    if (!response.ok) {
      throw new Error(
        `stream detail request failed: HTTP=${response.status}`,
      );
    }

    const envelope = parseApiEnvelope(buffer);

    if (envelope.message !== "Success") {
      throw new Error(
        `stream detail failed: ${envelope.message}`,
      );
    }

    const sessionToken = response.headers.get("rb-session");

    if (!sessionToken) {
      throw new Error(
        "stream detail missing session token",
      );
    }

    return {
      stream: parseStreamDetail(buffer),
      sessionToken,
    };
  }

  private async get(path: string): Promise<ArrayBuffer> {
    const response = await fetch(
      `${this.baseUrl()}${path}`,
      {
        headers: headers(this.req()),
      },
    );

    if (!response.ok) {
      throw new Error(
        `FCTV33 request failed: path=${path}, HTTP=${response.status}`,
      );
    }

    return response.arrayBuffer();
  }

  private async signedGet(
    path: string,
    params: RequestParams,
    code: number,
  ): Promise<ArrayBuffer> {
    const suffix = this.signatureKeys.get(code);

    if (!suffix) {
      throw new Error(
        `missing body signature for ${path}`,
      );
    }

    const sortedParams = sortRequestParams(params);
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(sortedParams)) {
      query.set(key, String(value));
    }

    const hashPrefix = requestHashPrefix(params);

    const url =
      `${this.baseUrl()}/sfver${hashPrefix}${suffix}${path}?${query}`;

    const response = await fetch(url, {
      headers: headers(this.req()),
    });

    const buffer = await response.arrayBuffer();

    if (path === PATH.schedule) {
      const diagnostic = {
        path,
        code,
        params: sortedParams,
        hashPrefix,
        signatureFound: true,
        httpStatus: response.status,
        contentType: response.headers.get("content-type"),
        bytes: buffer.byteLength,
        bodyPreview: Buffer.from(buffer)
          .subarray(0, 160)
          .toString("utf8")
          .replace(/[^\x20-\x7E]/g, "."),
      };

      console.log(
        "[FCTV33 schedule diagnostic]",
        JSON.stringify(diagnostic),
      );
    }

    if (!response.ok || buffer.byteLength === 0) {
      throw new Error(
        `FCTV33 request failed: path=${path}, HTTP=${response.status}, bytes=${buffer.byteLength}`,
      );
    }

    return buffer;
  }
}
