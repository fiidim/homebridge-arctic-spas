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

      if (cfg.id === 'pump1') {
        const fan =
    this.accessory.getService(cfg.displayName) ??
    this.accessory.addService(Service.Fanv2, cfg.displayName, cfg.id);

        fan.getCharacteristic(Characteristic.Active)
          .onSet((value) => this.handleSetPump1Active(value));

        fan.getCharacteristic(Characteristic.RotationSpeed)
          .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
          .onSet((value) => this.handleSetPump1Speed(value));

        this.services.set(cfg.id, fan);
        continue;
      }

      const service =
  this.accessory.getService(cfg.displayName) ??
  this.accessory.addService(Service.Switch, cfg.displayName, cfg.id);

      service.getCharacteristic(Characteristic.On)
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
      const pump1Svc = this.services.get('pump1');
      if (pump1Svc) {
        const pump1 = status.pump1 ?? 'off';
        const isActive = pump1 !== 'off';

        pump1Svc.updateCharacteristic(
          Characteristic.Active,
          isActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
        );

        const speed =
          pump1 === 'high' ? 100 :
            pump1 === 'low' ? 33 :
              0;

        pump1Svc.updateCharacteristic(Characteristic.RotationSpeed, speed);
      }

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
    const pumpNumber = id.replace('pump', '') as '2' | '3' | '4' | '5';
    const state = on ? 'on' : 'off';
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

  private async handleSetPump1Active(value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.platform;
    const active = Number(value) === Characteristic.Active.ACTIVE;

    try {
      if (!active) {
        this.platform.log.info('Setting pump 1 -> off');
        await this.client.setPump('1', 'off');
        return;
      }

      // If turning on, default to low unless user sets speed
      this.platform.log.info('Setting pump 1 -> low');
      await this.client.setPump('1', 'low');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error('Failed to set Pump 1 active:', message);
      throw error;
    }
  }

  private async handleSetPump1Speed(value: CharacteristicValue): Promise<void> {
    const speed = typeof value === 'number' ? value : Number(value);

    try {
      let state: 'off' | 'low' | 'high';
      if (speed <= 0) {
        state = 'off';
      } else if (speed < 67) {
        state = 'low';
      } else {
        state = 'high';
      }

      this.platform.log.info(`Setting pump 1 -> ${state}`);
      await this.client.setPump('1', state);

      // Keep Active consistent with speed
      const { Characteristic } = this.platform;
      const pump1Svc = this.services.get('pump1');
      if (pump1Svc) {
        pump1Svc.updateCharacteristic(
          Characteristic.Active,
          state === 'off' ? Characteristic.Active.INACTIVE : Characteristic.Active.ACTIVE,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error('Failed to set Pump 1 speed:', message);
      throw error;
    }
  }

}
