// spaClient.ts
export type OnOffState = 'on' | 'off';

export interface SpaStatus {
  connected: boolean;

  temperatureF?: number;
  setpointF?: number;

  lights?: OnOffState;

  pump1?: string;
  pump2?: string;
  pump3?: string;
  pump4?: string;
  pump5?: string;

  blower1?: OnOffState;
  blower2?: OnOffState;

  easymode?: OnOffState;
  sds?: OnOffState;
  yess?: OnOffState;
  fogger?: OnOffState;

  ph?: number;
  ph_status?: string;
  orp?: number;
  orp_status?: string;
  spaboyPh?: number;
  spaboyOrp?: number;
}

type HttpMethod = 'GET' | 'PUT';


async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t?.trim() ?? '';
  } catch {
    return '';
  }
}


export class SpaClient {
  private readonly baseUrl = 'https://api.myarcticspa.com/v2/spa';
  private readonly apiKey: string;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;

  private lastStatus: SpaStatus | null = null;
  private lastFetchTime = 0;
  private inFlight: Promise<SpaStatus> | null = null;

  public constructor(apiKey: string, minIntervalMs = 0, timeoutMs = 5000) {
    this.apiKey = apiKey;
    this.minIntervalMs = minIntervalMs;
    this.timeoutMs = timeoutMs;
  }

  public async getStatus(): Promise<SpaStatus> {
    const now = Date.now();

    // 1) If we have fresh data, just return it
    if (this.lastStatus && now - this.lastFetchTime < this.minIntervalMs) {
      return this.lastStatus;
    }

    // 2) If a request is already in flight, share it
    if (this.inFlight) {
      return this.inFlight;
    }

    // 3) Otherwise, start a new request and share that promise
    this.inFlight = (async () => {
      try {
        const data = await this.requestJson<SpaStatus>('GET', '/status');
        this.lastStatus = data;
        this.lastFetchTime = Date.now();
        return data;
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  public async setTemperatureF(setpointF: number): Promise<void> {
    await this.requestJson('PUT', '/temperature', { setpointF });
  }

  public async setLights(on: boolean): Promise<void> {
    const state: OnOffState = on ? 'on' : 'off';
    await this.requestJson('PUT', '/lights', { state });
  }

  public async setPump(
    pump: '1' | '2' | '3' | '4' | '5' | 'all',
    state: 'off' | 'on' | 'low' | 'high',
  ): Promise<void> {
    await this.requestJson('PUT', `/pumps/${pump}`, { state });
  }

  public async setBlower(
    blower: '1' | '2' | 'all',
    state: OnOffState,
  ): Promise<void> {
    await this.requestJson('PUT', `/blowers/${blower}`, { state });
  }

  public async setToggle(
    path: 'easymode' | 'sds' | 'yess' | 'fogger',
    on: boolean,
  ): Promise<void> {
    const state: OnOffState = on ? 'on' : 'off';
    await this.requestJson('PUT', `/${path}`, { state });
  }

  public async boost(): Promise<void> {
    await this.requestJson('PUT', '/boost');
  }

  private async requestJson<T = unknown>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      // Helpful error text (avoid “just status code”)
      if (!res.ok) {
        const text = await safeReadText(res);
        throw new Error(`Arctic Spas API ${method} ${path} failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`);
      }

      // Some endpoints might return no body
      if (res.status === 204) {
        return undefined as T;
      }

      // If content-type isn't json, still try to parse, but fail cleanly
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        const text = await safeReadText(res);
        // If caller expects void, allow non-json success
        return (text as unknown) as T;
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
