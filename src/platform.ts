// src/platform.ts
import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { PLUGIN_NAME, PLATFORM_NAME } from './settings.js';
import { SpaClient } from './spaClient.js';
import { ArcticSpasEnvironmentAccessory } from './accessories/spaEnvironmentAccessory.js';
import { ArcticSpasLightsAccessory } from './accessories/spaLightsAccessory.js';
import { ArcticSpasPumpsAccessory } from './accessories/spaPumpsAccessory.js';
import { ArcticSpasPhAccessory } from './accessories/spaPhAccessory.js';
import { ArcticSpasOrpAccessory } from './accessories/spaOrpAccessory.js';

interface ArcticSpaConfig extends PlatformConfig {
  apiKey: string;
  pollIntervalSeconds?: number;

  enableLights?: boolean;

  enablePump1?: boolean;
  enablePump2?: boolean;
  enablePump3?: boolean;
  enablePump4?: boolean;
  enablePump5?: boolean;

  enableBlower1?: boolean;
  enableBlower2?: boolean;

  enableEasyMode?: boolean;
  enableSds?: boolean;
  enableYess?: boolean;
  enableFogger?: boolean;

  enablePh?: boolean;
  enableOrp?: boolean;
}


export class ArcticSpasPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly log: Logger;
  public readonly api: API;
  public readonly config: ArcticSpaConfig;

  private readonly accessories: PlatformAccessory[] = [];
  private client?: SpaClient;
  private pollIntervalMs = 60000;

  public constructor(
    log: Logger,
    config: PlatformConfig,
    api: API,
  ) {
    this.log = log;
    this.api = api;
    this.config = config as ArcticSpaConfig;

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.info('Initializing Arctic Spas Platform');
    // Work out the poll interval first
    if (
      typeof this.config.pollIntervalSeconds === 'number' &&
    this.config.pollIntervalSeconds >= 15
    ) {
      this.pollIntervalMs = this.config.pollIntervalSeconds * 1000;
    }

    if (!this.config.apiKey) {
      this.log.error('No apiKey configured for Arctic Spas plugin – plugin will be disabled.');
      return;
    }

    // 👇 Pass the poll interval into the client so it can rate-limit /status
    this.client = new SpaClient(this.config.apiKey, this.pollIntervalMs);

    this.api.on('didFinishLaunching', () => {
      this.log.info('Homebridge finished launching – setting up Arctic Spas accessories...');
      this.setupAccessories();
    });
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loaded accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private setupAccessories(): void {
    if (!this.client) {
      this.log.error('SpaClient is not initialized; cannot set up accessories.');
      return;
    }

    const envUuid = this.api.hap.uuid.generate('ArcticSpas:Environment');
    const lightsUuid = this.api.hap.uuid.generate('ArcticSpas:Lights');
    const pumpsUuid = this.api.hap.uuid.generate('ArcticSpas:Pumps');
    const phUuid = this.api.hap.uuid.generate('ArcticSpas:Ph');
    const orpUuid = this.api.hap.uuid.generate('ArcticSpas:Orp');

    const environmentAccessory =
    this.getOrCreateAccessory('Arctic Spas Environment', envUuid);

    const pumpsAccessory =
    this.getOrCreateAccessory('Arctic Spas Pumps', pumpsUuid);

    // 🔦 lights (optional)
    const enableLights = this.config.enableLights ?? true;
    let lightsAccessory: PlatformAccessory | undefined;
    if (enableLights) {
      lightsAccessory =
      this.getOrCreateAccessory('Arctic Spas Lights', lightsUuid);
    }

    const enablePh = this.config.enablePh ?? true;
    const enableOrp = this.config.enableOrp ?? true;

    let phAccessory: PlatformAccessory | undefined;
    let orpAccessory: PlatformAccessory | undefined;

    if (enablePh) {
      phAccessory =
      this.getOrCreateAccessory('Arctic Spas pH', phUuid);
    }

    if (enableOrp) {
      orpAccessory =
      this.getOrCreateAccessory('Arctic Spas ORP', orpUuid);
    }

    const pollIntervalMs = this.pollIntervalMs;

    const enabledSwitches = {
      pump1: this.config.enablePump1 ?? true,
      pump2: this.config.enablePump2 ?? true,
      pump3: this.config.enablePump3 ?? true,
      pump4: this.config.enablePump4 ?? false,
      pump5: this.config.enablePump5 ?? false,

      blower1: this.config.enableBlower1 ?? true,
      blower2: this.config.enableBlower2 ?? true,

      easymode: this.config.enableEasyMode ?? true,
      sds: this.config.enableSds ?? true,
      yess: this.config.enableYess ?? true,
      fogger: this.config.enableFogger ?? true,
    } as const;


    new ArcticSpasEnvironmentAccessory(this, environmentAccessory, this.client, pollIntervalMs);

    if (lightsAccessory) {

      new ArcticSpasLightsAccessory(this, lightsAccessory, this.client, pollIntervalMs);
    }


    new ArcticSpasPumpsAccessory(this, pumpsAccessory, this.client, pollIntervalMs, enabledSwitches);

    if (phAccessory) {

      new ArcticSpasPhAccessory(this, phAccessory, this.client, pollIntervalMs);
    }

    if (orpAccessory) {

      new ArcticSpasOrpAccessory(this, orpAccessory, this.client, pollIntervalMs);
    }
  }

  private getOrCreateAccessory(name: string, uuid: string): PlatformAccessory {
    const cached = this.accessories.find((a) => a.UUID === uuid);
    if (cached) {
      return cached;
    }

    const accessory = new this.api.platformAccessory(name, uuid);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.log.info('Registered new accessory:', name);
    this.accessories.push(accessory);
    return accessory;
  }
}
