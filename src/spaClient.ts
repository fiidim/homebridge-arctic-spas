import axios, { AxiosInstance } from 'axios';

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

  // extend with any other fields you care about
}

export class SpaClient {
  private readonly http: AxiosInstance;
  private readonly minIntervalMs: number;

  private lastStatus: SpaStatus | null = null;
  private lastFetchTime = 0;
  private inFlight: Promise<SpaStatus> | null = null;

  public constructor(apiKey: string, minIntervalMs = 0) {
    this.minIntervalMs = minIntervalMs;

    this.http = axios.create({
      baseURL: 'https://api.myarcticspa.com/v2/spa',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });
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
        const response = await this.http.get<SpaStatus>('/status');
        this.lastStatus = response.data;
        this.lastFetchTime = Date.now();
        return response.data;
      } finally {
        this.inFlight = null;
      }
    })();

    return this.inFlight;
  }

  public async setTemperatureF(setpointF: number): Promise<void> {
    await this.http.put('/temperature', { setpointF });
  }

  public async setLights(on: boolean): Promise<void> {
    const state: OnOffState = on ? 'on' : 'off';
    await this.http.put('/lights', { state });
  }

  public async setPump(
    pump: '1' | '2' | '3' | '4' | '5' | 'all',
    state: 'off' | 'on' | 'low' | 'high',
  ): Promise<void> {
    await this.http.put(`/pumps/${pump}`, { state });
  }

  public async setBlower(
    blower: '1' | '2' | 'all',
    state: OnOffState,
  ): Promise<void> {
    await this.http.put(`/blowers/${blower}`, { state });
  }

  public async setToggle(
    path: 'easymode' | 'sds' | 'yess' | 'fogger',
    on: boolean,
  ): Promise<void> {
    const state: OnOffState = on ? 'on' : 'off';
    await this.http.put(`/${path}`, { state });
  }

  public async boost(): Promise<void> {
    await this.http.put('/boost');
  }
}
