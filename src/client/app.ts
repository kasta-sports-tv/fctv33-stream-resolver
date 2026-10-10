type LiveMatch = {
  matchId: number;
  sportType: number;
  name: string;
};

type ResolveResult = {
  name?: string;
  streamUrl?: string;
  playableUrl?: string;
  referer?: string;
  error?: string;
};

type HlsPlayer = {
  destroy: () => void;
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
};

type HlsApi = {
  isSupported: () => boolean;
  Events: { ERROR: string; MANIFEST_PARSED: string };
  new (config?: Record<string, unknown>): HlsPlayer;
};

declare const Hls: HlsApi;

const SPORTS = [
  { type: 1, label: "Футбол", icon: "⚽" },
  { type: 2, label: "Баскетбол", icon: "🏀" },
  { type: 3, label: "Теніс", icon: "🎾" },
  { type: 4, label: "Бейсбол", icon: "⚾" },
  { type: 6, label: "Крикет", icon: "🏏" },
  { type: 7, label: "Автоспорт", icon: "🏎️" },
  { type: 8, label: "Регбі", icon: "🏉" },
  { type: 9, label: "Амер. футбол", icon: "🏈" },
  { type: 11, label: "Хокей", icon: "🏒" },
  { type: 90, label: "Інше", icon: "🏆" },
] as const;

const el = {
  sports: document.getElementById("sport-tabs")!,
  refresh: document.getElementById("refresh-button") as HTMLButtonElement,
  liveMeta: document.getElementById("live-meta")!,
  status: document.querySelector(".status") as HTMLElement,
  matches: document.getElementById("match-list")!,
  title: document.getElementById("stream-title")!,
  screen: document.querySelector(".screen") as HTMLElement,
  video: document.getElementById("video-element") as HTMLVideoElement,
  error: document.getElementById("error-message")!,
  search: document.getElementById("match-search") as HTMLInputElement,
};

const state = {
  sportType: 1,
  matches: [] as LiveMatch[],
  activeId: null as number | null,
  loading: false,
  resolving: false,
  hls: null as HlsPlayer | null,
  gen: 0,
  search: "",
};

const showError = (message: string) => {
  el.error.textContent = message;
  el.error.hidden = false;
};

const clearError = () => {
  el.error.hidden = true;
  el.error.textContent = "";
};

const stopPlayback = () => {
  state.gen += 1;
  state.hls?.destroy();
  state.hls = null;
  el.video.pause();
  el.video.removeAttribute("src");
  el.video.load();
  el.screen.classList.remove("is-active");
  el.video.hidden = true;
};

const startPlayback = (url: string) => {
  stopPlayback();
  const gen = state.gen;
  const current = () => gen === state.gen;

  return new Promise<void>((resolve, reject) => {
    let done = false;

    const finish = (ok: boolean, error?: Error) => {
      if (!current() || done) return;
      done = true;
      el.video.removeEventListener("playing", onPlaying);
      el.video.removeEventListener("error", onError);

      if (ok) {
        clearError();
        resolve();
      } else {
        reject(error ?? new Error("Не вдалося відтворити відео"));
      }
    };

    const onPlaying = () => finish(true);
    const onError = () =>
      finish(false, new Error("Помилка відтворення відео"));

    el.video.addEventListener("playing", onPlaying);
    el.video.addEventListener("error", onError);

    el.video.hidden = false;
    el.screen.classList.add("is-active");

    if (Hls.isSupported()) {
      state.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });

      state.hls.on(Hls.Events.ERROR, (_event, data) => {
        if ((data as { fatal?: boolean } | undefined)?.fatal) {
          finish(false, new Error("Помилка потоку HLS"));
        }
      });

      state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (current()) void el.video.play().catch(() => undefined);
      });

      state.hls.attachMedia(el.video);
      state.hls.loadSource(url);
      return;
    }

    if (el.video.canPlayType("application/vnd.apple.mpegurl")) {
      el.video.src = url;
      void el.video.play().catch(() => undefined);
      return;
    }

    finish(false, new Error("Цей браузер не підтримує HLS"));
  });
};

const renderSports = () => {
  el.sports.replaceChildren(
    ...SPORTS.map((sport) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        `sports__btn${sport.type === state.sportType ? " is-active" : ""}`;
      button.innerHTML =
        `<span class="sports__icon">${sport.icon}</span>` +
        `<span>${sport.label}</span>`;

      button.setAttribute(
        "aria-pressed",
        String(sport.type === state.sportType),
      );

      button.onclick = () => {
        if (state.sportType === sport.type) return;

        stopPlayback();
        state.activeId = null;
        state.sportType = sport.type;
        el.title.textContent = "Оберіть матч";
        renderSports();
        void loadMatches();
      };

      return button;
    }),
  );
};

const renderMatches = () => {
  const filtered = state.matches.filter((match) =>
    (match.name || `Матч ${match.matchId}`)
      .toLocaleLowerCase("uk")
      .includes(state.search.toLocaleLowerCase("uk")),
  );

  el.matches.replaceChildren(
    ...filtered.map((match) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        `match${match.matchId === state.activeId ? " is-active" : ""}`;
      button.disabled = state.resolving;

      const live = document.createElement("span");
      live.className = "match__live";
      live.innerHTML = '<span class="match__live-dot"></span> LIVE';

      const title = document.createElement("span");
      title.className = "match__title";
      title.textContent = match.name || `Матч ${match.matchId}`;

      const meta = document.createElement("span");
      meta.className = "match__meta";
      meta.textContent = "Доступна трансляція";

      const text = document.createElement("span");
      text.className = "match__text";
      text.append(title, meta);

      const arrow = document.createElement("span");
      arrow.className = "match__arrow";
      arrow.textContent = "›";

      button.append(live, text, arrow);
      button.onclick = () => void playMatch(match);
      item.append(button);

      return item;
    }),
  );

  if (!filtered.length && !state.loading) {
    const empty = document.createElement("li");
    empty.className = "matches__empty";
    empty.textContent = state.search
      ? "За цим запитом матчів не знайдено."
      : "Зараз немає доступних трансляцій у цій категорії.";
    el.matches.append(empty);
  }

  const count = document.getElementById("match-count");
  if (count) count.textContent = String(filtered.length);
};

const loadMatches = async () => {
  state.loading = true;
  el.refresh.disabled = true;
  el.status.className = "status is-loading";
  el.liveMeta.textContent = "Завантаження";
  clearError();
  renderMatches();

  try {
    const response = await fetch(
      `/api/live?sportType=${encodeURIComponent(state.sportType)}`,
    );

    const result = (await response.json()) as {
      matches?: LiveMatch[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(result.error ?? `Помилка запиту (${response.status})`);
    }

    state.matches = result.matches ?? [];
    el.status.className = "status";
    el.liveMeta.textContent = "З’єднання активне";

    const count = document.getElementById("match-count");
    if (count) count.textContent = String(state.matches.length);
  } catch (error) {
    state.matches = [];
    el.status.className = "status is-error";
    el.liveMeta.textContent = "Немає з’єднання";
    showError(
      error instanceof Error ? error.message : "Не вдалося завантажити матчі",
    );
  } finally {
    state.loading = false;
    el.refresh.disabled = false;
    renderMatches();
  }
};

const playMatch = async (match: LiveMatch) => {
  if (state.resolving) return;

  state.resolving = true;
  state.activeId = match.matchId;
  clearError();
  stopPlayback();

  el.title.textContent = match.name || `Матч ${match.matchId}`;
  el.video.hidden = true;
  renderMatches();

  try {
    const response = await fetch(
      `/api/resolve?matchId=${encodeURIComponent(match.matchId)}` +
      `&sportType=${encodeURIComponent(match.sportType)}`,
    );

    const result = (await response.json()) as ResolveResult;

    if (!response.ok) {
      throw new Error(result.error ?? `Помилка запиту (${response.status})`);
    }

    el.title.textContent = result.name || match.name || "Трансляція";

    if (!result.playableUrl) {
      throw new Error(result.error || "Посилання для відтворення не отримано");
    }

    await startPlayback(result.playableUrl);
  } catch (error) {
    stopPlayback();
    showError(
      error instanceof Error ? error.message : "Не вдалося запустити трансляцію",
    );
  } finally {
    state.resolving = false;
    renderMatches();
  }
};

el.refresh.onclick = () => void loadMatches();

el.search.addEventListener("input", () => {
  state.search = el.search.value.trim();
  renderMatches();
});

setInterval(() => {
  if (!state.loading && !state.resolving) void loadMatches();
}, 120_000);

renderSports();
void loadMatches();
