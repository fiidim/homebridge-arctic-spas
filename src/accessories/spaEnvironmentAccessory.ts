// src/accessories/spaEnvironmentAccessory.ts
import type { Service, PlatformAccessory } from 'homebridge';
import type { ArcticSpasPlatform } from '../platform.js';
import type { SpaClient, SpaStatus } from '../spaClient.js';

export class ArcticSpasEnvironmentAccessory {
  private readonly platform: ArcticSpasPlatform;
  private readonly accessory: PlatformAccessory;
  private readonly client: SpaClient;
  private readonly pollIntervalMs: number;

  private readonly thermostatService: Service;

  private currentStatus: SpaStatus | null = null;

  private readonly minTempC = 10;
  private readonly maxTempC = 40;

  public constructor(
    platform: ArcticSpasPlatform,
    accessory: PlatformAccessory,
    client: SpaClient,
    pollIntervalMs: number,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.client = client;
    this.pollIntervalMs = pollIntervalMs;

    const { Service, Characteristic } = this.platform;

    const infoService =
      this.accessory.getService(Service.AccessoryInformation) ??
      this.accessory.addService(Service.AccessoryInformation);

    infoService
      .setCharacteristic(Characteristic.Manufacturer, 'Arctic Spas')
      .setCharacteristic(Characteristic.Model, 'Arctic Spas (Environment)')
      .setCharacteristic(Characteristic.SerialNumber, 'ArcticSpa-Environment');

    this.thermostatService =
      this.accessory.getService(Service.Thermostat) ??
      this.accessory.addService(Service.Thermostat, 'Spa Temperature');

    this.thermostatService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({ minValue: this.minTempC, maxValue: this.maxTempC });

    this.thermostatService
      .getCharacteristic(Characteristic.TargetTemperature)
      .setProps({ minValue: this.minTempC, maxValue: this.maxTempC })
      .onSet(this.handleSetTargetTemperature.bind(this));

    this.thermostatService
      .getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .updateValue(Characteristic.TemperatureDisplayUnits.CELSIUS);

    void this.pollStatus();
    setInterval(() => {
      void this.pollStatus();
    }, this.pollIntervalMs);
  }

  private fToC(f: number | undefined): number | null {
    if (typeof f !== 'number') {
      return null;
    }

    return ((f - 32) * 5) / 9;
  }

  private cToF(c: number): number {
    return Math.round((c * 9) / 5 + 32);
  }

  private async pollStatus(): Promise<void> {
    try {
      const status = await this.client.getStatus();
      this.currentStatus = status;

      const { Characteristic } = this.platform;

      const currentC = this.fToC(status.temperatureF);
      const targetC = this.fToC(status.setpointF);

      if (currentC !== null) {
        this.thermostatService.updateCharacteristic(
          Characteristic.CurrentTemperature,
          currentC,
        );
      }

      if (targetC !== null) {
        this.thermostatService.updateCharacteristic(
          Characteristic.TargetTemperature,
          targetC,
        );
      }

      const heatingState =
        currentC !== null &&
        targetC !== null &&
        currentC < targetC
          ? Characteristic.CurrentHeatingCoolingState.HEAT
          : Characteristic.CurrentHeatingCoolingState.OFF;

      this.thermostatService.updateCharacteristic(
        Characteristic.CurrentHeatingCoolingState,
        heatingState,
      );

      this.thermostatService.updateCharacteristic(
        Characteristic.TargetHeatingCoolingState,
        Characteristic.TargetHeatingCoolingState.HEAT,
      );

      this.platform.log.debug(
        'Environment status updated:',
        JSON.stringify({ temperatureF: status.temperatureF, setpointF: status.setpointF }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error('Failed to poll environment status:', message);
    }
  }

  private async handleSetTargetTemperature(value: unknown): Promise<void> {
    const c = Number(value);
    const f = this.cToF(c);

    this.platform.log.info(`Setting spa temperature to ${c.toFixed(1)}°C (${f}°F)`);

    try {
      await this.client.setTemperatureF(f);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error('Failed to set spa temperature:', message);
      throw error;
    }
  }
}
