import type { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import type { ArcticSpasPlatform } from '../platform.js';
import type { SpaClient, SpaStatus } from '../spaClient.js';

type SwitchId =
  | 'pump1' | 'pump2' | 'pump3' | 'pump4' | 'pump5'
  | 'blower1' | 'blower2'
  | 'easymode' | 'sds' | 'yess' | 'fogger'
  | 'boost';

interface SwitchConfig {
  id: SwitchId;
  displayName: string;
  kind: 'pump' | 'blower' | 'toggle' | 'boost';
}

interface EnabledSwitchesConfig {
  pump1: boolean;
  pump2: boolean;
  pump3: boolean;
  pump4: boolean;
  pump5: boolean;
  blower1: boolean;
  blower2: boolean;
  easymode: boolean;
  sds: boolean;
  yess: boolean;
  fogger: boolean;
}


const SWITCHES: readonly SwitchConfig[] = [
  { id: 'pump1', displayName: 'Pump 1', kind: 'pump' },
  { id: 'pump2', displayName: 'Pump 2', kind: 'pump' },
  { id: 'pump3', displayName: 'Pump 3', kind: 'pump' },
  { id: 'pump4', displayName: 'Pump 4', kind: 'pump' },
  { id: 'pump5', displayName: 'Pump 5', kind: 'pump' },

  { id: 'blower1', displayName: 'Blower 1', kind: 'blower' },
  { id: 'blower2', displayName: 'Blower 2', kind: 'blower' },

  { id: 'easymode', displayName: 'Easy Mode', kind: 'toggle' },
  { id: 'sds', displayName: 'SDS', kind: 'toggle' },
  { id: 'yess', displayName: 'YESS', kind: 'toggle' },
  { id: 'fogger', displayName: 'Fogger', kind: 'toggle' },

  { id: 'boost', displayName: 'Boost', kind: 'boost' },
];

export class ArcticSpasPumpsAccessory {
  private readonly platform: ArcticSpasPlatform;
  private readonly accessory: PlatformAccessory;
  private readonly client: SpaClient;
  private readonly pollIntervalMs: number;
  private readonly enabledSwitches: EnabledSwitchesConfig;

  private readonly services: Map<string, Service> = new Map();

  private currentStatus: SpaStatus | null = null;

  public constructor(
    platform: ArcticSpasPlatform,
    accessory: PlatformAccessory,
    client: SpaClient,
    pollIntervalMs: number,
    enabledSwitches: EnabledSwitchesConfig,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.client = client;
    this.pollIntervalMs = pollIntervalMs;
    this.enabledSwitches = enabledSwitches;

    const { Service, Characteristic } = this.platform;

    const infoService =
      this.accessory.getService(Service.AccessoryInformation) ??
      this.accessory.addService(Service.AccessoryInformation);

    infoService
      .setCharacteristic(Characteristic.Manufacturer, 'Arctic Spas')
      .setCharacteristic(Characteristic.Model, 'Arctic Spas (Pumps & Features)')
      .setCharacteristic(Characteristic.SerialNumber, 'ArcticSpa-Pumps');

    for (const cfg of SWITCHES) {
      // Pump / blower / toggle are controlled by config; boost is always on
      if (cfg.kind !== 'boost') {
        const id = cfg.id as Exclude<SwitchId, 'boost'>;
        if (!this.enabledSwitches[id]) {
          continue;
        }
      }

      const service =
        this.accessory.getService(cfg.displayName) ??
        this.accessory.addService(Service.Switch, cfg.displayName, cfg.id);

      service
        .getCharacteristic(Characteristic.On)
        .onSet((value) => this.handleSet(cfg, value));

      this.services.set(cfg.id, service);
    }

    void this.pollStatus();
    setInterval(() => {
      void this.pollStatus();
    }, this.pollIntervalMs);
  }

  private async pollStatus(): Promise<void> {
    try {
      const status = await this.client.getStatus();
      this.currentStatus = status;

      const { Characteristic } = this.platform;

      const setSwitch = (id: string, on: boolean): void => {
        const svc = this.services.get(id);
        if (!svc) {
          return;
        }

        svc.updateCharacteristic(Characteristic.On, on);
      };

      // Pumps: treat anything other than "off" as on
      setSwitch('pump1', Boolean(status.pump1 && status.pump1 !== 'off'));
      setSwitch('pump2', Boolean(status.pump2 && status.pump2 !== 'off'));
      setSwitch('pump3', Boolean(status.pump3 && status.pump3 !== 'off'));
      setSwitch('pump4', Boolean(status.pump4 && status.pump4 !== 'off'));
      setSwitch('pump5', Boolean(status.pump5 && status.pump5 !== 'off'));

      // Blowers
      setSwitch('blower1', status.blower1 === 'on');
      setSwitch('blower2', status.blower2 === 'on');

      // Toggles
      setSwitch('easymode', status.easymode === 'on');
      setSwitch('sds', status.sds === 'on');
      setSwitch('yess', status.yess === 'on');
      setSwitch('fogger', status.fogger === 'on');

      // Boost is write-only; leave switch state as-is

      this.platform.log.debug('Pumps/features status updated');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error('Failed to poll pumps/features status:', message);
    }
  }

  private async handleSet(cfg: SwitchConfig, value: CharacteristicValue): Promise<void> {
    const on = Boolean(value);

    try {
      switch (cfg.kind) {
      case 'pump':
        await this.handleSetPump(cfg.id, on);
        break;

      case 'blower':
        await this.handleSetBlower(cfg.id, on);
        break;

      case 'toggle':
        await this.handleSetToggle(cfg.id, on);
        break;

      case 'boost':
        await this.handleBoost(on);
        break;

      default:
        break;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error(`Failed to set ${cfg.displayName}:`, message);
      throw error;
    }
  }

  private async handleSetPump(id: string, on: boolean): Promise<void> {
    // For now, map "On" to "high" and "Off" to "off"
    const pumpNumber = id.replace('pump', '') as '1' | '2' | '3' | '4' | '5';
    const state = on ? 'high' : 'off';
    this.platform.log.info(`Setting pump ${pumpNumber} -> ${state}`);
    await this.client.setPump(pumpNumber, state);
  }

  private async handleSetBlower(id: string, on: boolean): Promise<void> {
    const blowerNumber = id.replace('blower', '') as '1' | '2';
    const state = on ? 'on' : 'off';
    this.platform.log.info(`Setting blower ${blowerNumber} -> ${state}`);
    await this.client.setBlower(blowerNumber, state);
  }

  private async handleSetToggle(id: string, on: boolean): Promise<void> {
    const path = id as 'easymode' | 'sds' | 'yess' | 'fogger';
    this.platform.log.info(`Setting ${path} -> ${on ? 'on' : 'off'}`);
    await this.client.setToggle(path, on);
  }

  private async handleBoost(on: boolean): Promise<void> {
    if (!on) {
      // we only act on "on"; switch will be reset
      return;
    }

    this.platform.log.info('Triggering boost mode');
    await this.client.boost();

    const service = this.services.get('boost');
    if (!service) {
      return;
    }

    // Auto-reset the switch to "off" after a short delay
    setTimeout(() => {
      try {
        service.updateCharacteristic(
          this.platform.Characteristic.On,
          false,
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.platform.log.error('Failed to reset boost switch:', message);
      }
    }, 1000);
  }
}
