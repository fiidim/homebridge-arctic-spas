import type { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import type { ArcticSpasPlatform } from '../platform.js';
import type { SpaClient, SpaStatus } from '../spaClient.js';

type PumpId = 'pump1' | 'pump2' | 'pump3' | 'pump4' | 'pump5';
type BlowerId = 'blower1' | 'blower2';
type ToggleId = 'easymode' | 'sds' | 'yess' | 'fogger';
type BoostId = 'boost';

type SwitchId = PumpId | BlowerId | ToggleId | BoostId;

type PumpMode = 'two-state' | 'three-state';

interface EnabledSwitchesConfig {
  pump1: boolean;
  pump2: boolean;
  pump3: boolean;
  pump4: boolean;
  pump5: boolean;

  /**
   * Optional per-pump mode overrides (defaults come from DEFAULT_PUMP_MODES).
   * - two-state  => behaves like a simple on/off fan (speed 0/100)
   * - three-state => behaves like off/low/high (speed 0/50/100)
   */
  pumpModes?: Partial<Record<PumpId, PumpMode>>;

  blower1: boolean;
  blower2: boolean;

  easymode: boolean;
  sds: boolean;
  yess: boolean;
  fogger: boolean;
}

interface SwitchConfigBase {
  id: SwitchId;
  displayName: string;
  kind: 'pump' | 'blower' | 'toggle' | 'boost';
}

interface PumpConfig extends SwitchConfigBase {
  kind: 'pump';
  id: PumpId;
  mode: PumpMode;
  pumpNumber: '1' | '2' | '3' | '4' | '5';
}

interface NonPumpConfig extends SwitchConfigBase {
  kind: 'blower' | 'toggle' | 'boost';
}

const DEFAULT_PUMP_MODES: Readonly<Record<PumpId, PumpMode>> = {
  pump1: 'three-state',
  pump2: 'two-state',
  pump3: 'two-state',
  pump4: 'two-state',
  pump5: 'two-state',
};

const PUMP_DEFS: ReadonlyArray<Omit<PumpConfig, 'mode'>> = [
  { id: 'pump1', displayName: 'Pump 1', kind: 'pump', pumpNumber: '1' },
  { id: 'pump2', displayName: 'Pump 2', kind: 'pump', pumpNumber: '2' },
  { id: 'pump3', displayName: 'Pump 3', kind: 'pump', pumpNumber: '3' },
  { id: 'pump4', displayName: 'Pump 4', kind: 'pump', pumpNumber: '4' },
  { id: 'pump5', displayName: 'Pump 5', kind: 'pump', pumpNumber: '5' },
];

const OTHER_SWITCHES: readonly NonPumpConfig[] = [
  { id: 'blower1', displayName: 'Blower 1', kind: 'blower' },
  { id: 'blower2', displayName: 'Blower 2', kind: 'blower' },

  { id: 'easymode', displayName: 'Easy Mode', kind: 'toggle' },
  { id: 'sds', displayName: 'SDS', kind: 'toggle' },
  { id: 'yess', displayName: 'YESS', kind: 'toggle' },
  { id: 'fogger', displayName: 'Fogger', kind: 'toggle' },

  { id: 'boost', displayName: 'Boost', kind: 'boost' },
];

function isPumpId(id: SwitchId): id is PumpId {
  return id === 'pump1' || id === 'pump2' || id === 'pump3' || id === 'pump4' || id === 'pump5';
}


function getStatusValue(status: SpaStatus | undefined, key: string): unknown {
  if (!status) {
    return undefined;
  }
  return (status as unknown as Record<string, unknown>)[key];
}

function getStatusString(status: SpaStatus | undefined, key: string): string | undefined {
  const v = getStatusValue(status, key);
  if (typeof v === 'string') {
    return v;
  }
  return undefined;
}

function clampToDiscreteSpeed(mode: PumpMode, raw: number): 0 | 50 | 100 {
  if (mode === 'two-state') {
    if (raw > 0) {
      return 100;
    }
    return 0;
  }

  // three-state
  if (raw <= 0) {
    return 0;
  }
  if (raw <= 75) {
    return 50;
  }
  return 100;
}

function pumpStateFromSpeed(mode: PumpMode, speed: 0 | 50 | 100): 'off' | 'on' | 'low' | 'high' {
  if (mode === 'two-state') {
    return speed === 0 ? 'off' : 'on';
  }

  // three-state
  if (speed === 0) {
    return 'off';
  }
  if (speed === 50) {
    return 'low';
  }
  return 'high';
}

function pumpActiveFromState(state: string | undefined): boolean {
  return Boolean(state && state !== 'off');
}

export class ArcticSpasPumpsAccessory {
  private readonly platform: ArcticSpasPlatform;
  private readonly accessory: PlatformAccessory;
  private readonly client: SpaClient;
  private readonly pollIntervalMs: number;
  private readonly enabledSwitches: EnabledSwitchesConfig;

  private readonly services: Map<SwitchId, Service> = new Map();
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

    // Build pump configs from defaults + optional overrides.
    const pumpModes = {
      ...DEFAULT_PUMP_MODES,
      ...(this.enabledSwitches.pumpModes ?? {}),
    };

    const pumps: PumpConfig[] = PUMP_DEFS.map((p) => ({
      ...p,
      mode: pumpModes[p.id],
    }));

    // Ensure service types don't get mixed if you previously ran a different implementation.
    // We remove by displayName to avoid leaving behind stale Switch services.
    for (const cfg of [...pumps, ...OTHER_SWITCHES]) {
      this.removeMismatchedServices(cfg.displayName, cfg.kind);
    }

    // Create services for pumps (Fanv2)
    for (const pump of pumps) {
      if (!this.isEnabled(pump.id)) {
        continue;
      }

      const fan =
        this.accessory.getService(pump.displayName) ??
        this.accessory.addService(Service.Fanv2, pump.displayName, pump.id);

      this.services.set(pump.id, fan);

      fan.getCharacteristic(Characteristic.Active)
        .onGet(() => this.getPumpActive(pump))
        .onSet((value) => this.setPumpActive(pump, value));

      const minStep = pump.mode === 'three-state' ? 50 : 100;

      fan.getCharacteristic(Characteristic.RotationSpeed)
        .setProps({ minValue: 0, maxValue: 100, minStep })
        .onGet(() => this.getPumpSpeed(pump))
        .onSet((value) => this.setPumpSpeed(pump, value));
    }

    // Create services for other toggles (Switch)
    for (const cfg of OTHER_SWITCHES) {
      if (!this.isEnabled(cfg.id)) {
        continue;
      }

      const sw =
        this.accessory.getService(cfg.displayName) ??
        this.accessory.addService(Service.Switch, cfg.displayName, cfg.id);

      this.services.set(cfg.id, sw);

      sw.getCharacteristic(Characteristic.On)
        .onGet(() => this.getOn(cfg))
        .onSet((value) => this.setOn(cfg, value));
    }

    // Kick off polling
    void this.pollStatus();
    setInterval(() => void this.pollStatus(), this.pollIntervalMs);
  }

  private isEnabled(id: SwitchId): boolean {
    switch (id) {
    case 'pump1': {
      return this.enabledSwitches.pump1;
    }
    case 'pump2': {
      return this.enabledSwitches.pump2;
    }
    case 'pump3': {
      return this.enabledSwitches.pump3;
    }
    case 'pump4': {
      return this.enabledSwitches.pump4;
    }
    case 'pump5': {
      return this.enabledSwitches.pump5;
    }
    case 'blower1': {
      return this.enabledSwitches.blower1;
    }
    case 'blower2': {
      return this.enabledSwitches.blower2;
    }
    case 'easymode': {
      return this.enabledSwitches.easymode;
    }
    case 'sds': {
      return this.enabledSwitches.sds;
    }
    case 'yess': {
      return this.enabledSwitches.yess;
    }
    case 'fogger': {
      return this.enabledSwitches.fogger;
    }
    case 'boost': {
      return false;
    }
    default: {
      return false;
    }
    }
  }

  private removeMismatchedServices(displayName: string, kind: SwitchConfigBase['kind']): void {
    const { Service } = this.platform;

    const shouldBeFan = kind === 'pump';
    const shouldBeSwitch = kind !== 'pump';

    for (const svc of this.accessory.services.slice()) {
      if (svc.displayName !== displayName) {
        continue;
      }
      const isFan = svc.UUID === Service.Fanv2.UUID;
      const isSwitch = svc.UUID === Service.Switch.UUID;

      if (shouldBeFan && isSwitch) {
        this.platform.log.warn(`Removing stale Switch service for ${displayName} (now Fanv2)`);
        this.accessory.removeService(svc);
      }

      if (shouldBeSwitch && isFan) {
        this.platform.log.warn(`Removing stale Fanv2 service for ${displayName} (now Switch)`);
        this.accessory.removeService(svc);
      }
    }
  }

  private async pollStatus(): Promise<void> {
    try {
      const status = await this.client.getStatus();
      this.currentStatus = status;

      const { Characteristic } = this.platform;

      // Pumps: update Active + RotationSpeed
      for (const [id, svc] of this.services.entries()) {
        if (!isPumpId(id)) {
          continue;
        }
        // Determine mode from enabledSwitches overrides + defaults (same logic as ctor)
        const mode = {
          ...DEFAULT_PUMP_MODES,
          ...(this.enabledSwitches.pumpModes ?? {}),
        }[id];

        const rawState = getStatusString(status, id);

        const active = pumpActiveFromState(rawState);
        const speed: 0 | 50 | 100 =
          mode === 'three-state'
            ? (rawState === 'high' ? 100 : rawState === 'low' ? 50 : 0)
            : (active ? 100 : 0);

        svc.updateCharacteristic(
          Characteristic.Active,
          active ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
        );
        svc.updateCharacteristic(Characteristic.RotationSpeed, speed);
      }

      // Switch toggles: update On
      const setSwitch = (id: SwitchId, on: boolean): void => {
        const svc = this.services.get(id);
        if (!svc) {
          return;
        }
        svc.updateCharacteristic(Characteristic.On, on);
      };

      setSwitch('blower1', getStatusString(status, 'blower1') === 'on');
      setSwitch('blower2', getStatusString(status, 'blower2') === 'on');

      setSwitch('easymode', getStatusString(status, 'easymode') === 'on');
      setSwitch('sds', getStatusString(status, 'sds') === 'on');
      setSwitch('yess', getStatusString(status, 'yess') === 'on');
      setSwitch('fogger', getStatusString(status, 'fogger') === 'on');

      // Boost is write-only (momentary trigger); do not update from status.
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error('Failed to poll pumps/features status:', message);
    }
  }

  private getPumpActive(cfg: PumpConfig): boolean {
    // const { Characteristic } = this.platform;
    const status = this.currentStatus;

    if (!status) {
      return false;
    }

    const rawState = getStatusString(status, cfg.id);
    return pumpActiveFromState(rawState);
  }

  private async setPumpActive(cfg: PumpConfig, value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.platform;
    const active = Number(value) === Characteristic.Active.ACTIVE;

    try {
      if (cfg.mode === 'two-state') {
        await this.client.setPump(cfg.pumpNumber, active ? 'on' : 'off');
      } else {
        // three-state: turning on defaults to low (as before), off is off
        await this.client.setPump(cfg.pumpNumber, active ? 'low' : 'off');
      }

      // Keep UI in sync
      const svc = this.services.get(cfg.id);
      if (svc) {
        svc.updateCharacteristic(
          Characteristic.Active,
          active ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE,
        );

        const speed = cfg.mode === 'three-state' ? (active ? 50 : 0) : (active ? 100 : 0);
        svc.updateCharacteristic(Characteristic.RotationSpeed, speed);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error(`Failed to set ${cfg.id} active:`, message);
      throw error;
    }
  }

  private getPumpSpeed(cfg: PumpConfig): number {
    const status = this.currentStatus;
    if (!status) {
      return 0;
    }
    const rawState = getStatusString(status, cfg.id);

    if (cfg.mode === 'two-state') {
      return pumpActiveFromState(rawState) ? 100 : 0;
    }

    if (rawState === 'high') {

      return 100;

    }
    if (rawState === 'low') {
      return 50;
    }
    return 0;
  }

  private async setPumpSpeed(cfg: PumpConfig, value: CharacteristicValue): Promise<void> {
    const { Characteristic } = this.platform;

    const raw = typeof value === 'number' ? value : Number(value);
    const snapped = clampToDiscreteSpeed(cfg.mode, raw);
    const state = pumpStateFromSpeed(cfg.mode, snapped);

    try {
      // Pump 1 expects off/low/high; others expect on/off (two-state) or off/low/high (if configured).
      await this.client.setPump(cfg.pumpNumber, state);

      const svc = this.services.get(cfg.id);
      if (svc) {
        svc.updateCharacteristic(
          Characteristic.Active,
          state === 'off' ? Characteristic.Active.INACTIVE : Characteristic.Active.ACTIVE,
        );
        svc.updateCharacteristic(Characteristic.RotationSpeed, snapped);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error(`Failed to set ${cfg.id} speed:`, message);
      throw error;
    }
  }

  private getOn(cfg: NonPumpConfig): boolean {
    const status = this.currentStatus;
    if (!status) {
      return false;
    }
    const raw = getStatusString(status, cfg.id);

    if (cfg.kind === 'boost') {
      return Boolean(raw && raw !== 'off');
    }

    return raw === 'on';
  }

  private async setOn(cfg: NonPumpConfig, value: CharacteristicValue): Promise<void> {
    const on = Boolean(value);

    try {
      if (cfg.kind === 'blower') {
        const blowerNumber = cfg.id.replace('blower', '') as '1' | '2';
        await this.client.setBlower(blowerNumber, on ? 'on' : 'off');
      } else if (cfg.kind === 'toggle') {
        const path = cfg.id as ToggleId;
        await this.client.setToggle(path, on);
      } else if (cfg.kind === 'boost') {
        if (on) {
          this.platform.log.info('Triggering Boost');
          await this.client.boost();

          const svc = this.services.get('boost');
          if (svc) {
            setTimeout(() => {
              try {
                svc.updateCharacteristic(this.platform.Characteristic.On, false);
              } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                this.platform.log.error('Failed to reset Boost switch:', message);
              }
            }, 1000);
          }
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error(`Failed to set ${cfg.displayName}:`, message);
      throw error;
    }
  }
}
