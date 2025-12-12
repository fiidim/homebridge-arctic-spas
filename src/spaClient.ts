import axios, { AxiosInstance } from 'axios';

export interface SpaStatus {
  connected: boolean;
  temperatureF?: number;
  setpointF?: number;
  lights?: 'on' | 'off';
  pump1?: string;
  pump2?: string;
  pump3?: string;
  pump4?: string;
  pump5?: string;
  blower1?: 'on' | 'off';
  blower2?: 'on' | 'off';
  easymode?: 'on' | 'off';
  sds?: 'on' | 'off';
  yess?: 'on' | 'off';
  fogger?: 'on' | 'off';
  // ... add more fields as needed
}

export class SpaClient {
  private readonly http: AxiosInstance;

  constructor(apiKey: string) {
    this.http = axios.create({
      baseURL: 'https://api.myarcticspa.com/v2/spa',
      headers: {
        'X-API-KEY': apiKey, // from security scheme ApikeyAuth:contentReference[oaicite:3]{index=3}
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });
  }

  async getStatus(): Promise<SpaStatus> {
    const response = await this.http.get<SpaStatus>('/status');
    return response.data;
  }

  async setTemperatureF(setpointF: number): Promise<void> {
    await this.http.put('/temperature', { setpointF });
  }

  async setLights(on: boolean): Promise<void> {
    await this.http.put('/lights', { state: on ? 'on' : 'off' });
  }

  async setPump(pump: '1' | '2' | '3' | '4' | '5' | 'all', state: 'off' | 'on' | 'low' | 'high'): Promise<void> {
    await this.http.put(`/pumps/${pump}`, { state });
  }

  async setBlower(blower: '1' | '2' | 'all', state: 'on' | 'off'): Promise<void> {
    await this.http.put(`/blowers/${blower}`, { state });
  }

  async setSimpleToggle(path: 'easymode' | 'sds' | 'yess' | 'fogger', on: boolean): Promise<void> {
    await this.http.put(`/${path}`, { state: on ? 'on' : 'off' });
  }

  async boost(): Promise<void> {
    await this.http.put('/boost');
  }
}
