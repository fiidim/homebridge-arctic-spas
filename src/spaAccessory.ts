import {
  Service,
  PlatformAccessory,
} from 'homebridge';
import { ArcticSpaPlatform } from './platform.js';
import { SpaClient, SpaStatus } from './spaClient.js';

export class ArcticSpaAccessory {
  private thermostatService: Service;
  private lightService: Service;
  private pump1Service: Service;
  private blower1Service: Service;

  private currentStatus: SpaStatus | null = null;
  private readonly minTempC = 10;
  private readonly maxTempC = 40;

  constructor(
    private readonly platform: ArcticSpaPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly client: SpaClient,
    pollIntervalMs: number,
  ) {
    const { Service, Characteristic } = this.platform;

    // Accessory information
    this.accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Arctic Spas')
      .setCharacteristic(Characteristic.Model, 'Arctic Spa (API)')
      .setCharacteristic(Characteristic.SerialNumber, 'ArcticSpa-1');

    // Thermostat
    this.thermostatService =
      this.accessory.getService(Service.Thermostat) ||
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

    // Lights
    this.lightService =
      this.accessory.getService(Service.Lightbulb) ||
      this.accessory.addService(Service.Lightbulb, 'Spa Lights');

    this.lightService
      .getCharacteristic(Characteristic.On)
      .onSet(this.handleSetLights.bind(this));

    // Pump 1 as a Switch (simple on/off → high/off)
    this.pump1Service =
      this.accessory.getService('Pump 1') ||
      this.accessory.addService(Service.Switch, 'Pump 1', 'Pump1');

    this.pump1Service
      .getCharacteristic(Characteristic.On)
      .onSet(this.handleSetPump1.bind(this));

    // Blower 1 as a Switch
    this.blower1Service =
      this.accessory.getService('Blower 1') ||
      this.accessory.addService(Service.Switch, 'Blower 1', 'Blower1');

    this.blower1Service
      .getCharacteristic(Characteristic.On)
      .onSet(this.handleSetBlower1.bind(this));

    // Start polling
    this.pollStatus();
    setInterval(() => this.pollStatus(), pollIntervalMs);
  }

  private fToC(f?: number): number | null {
    if (f == null) {
      return null;
    }
    return (f - 32) * 5 / 9;
  }

  private cToF(c: number): number {
    return Math.round(c * 9 / 5 + 32);
  }

  private async pollStatus() {
    try {
      const status = await this.client.getStatus();
      this.currentStatus = status;

      const { Characteristic } = this.platform;

      // Thermostat
      const currentC = this.fToC(status.temperatureF);
      const targetC = this.fToC(status.setpointF);

      if (currentC != null) {
        this.thermostatService.updateCharacteristic(Characteristic.CurrentTemperature, currentC);
      }
      if (targetC != null) {
        this.thermostatService.updateCharacteristic(Characteristic.TargetTemperature, targetC);
      }

      const heatingState =
        currentC != null && targetC != null && currentC < targetC
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

      // Lights
      if (status.lights) {
        this.lightService.updateCharacteristic(
          Characteristic.On,
          status.lights === 'on',
        );
      }

      // Pump 1
      if (status.pump1) {
        this.pump1Service.updateCharacteristic(
          Characteristic.On,
          status.pump1 !== 'off',
        );
      }

      // Blower 1
      if (status.blower1) {
        this.blower1Service.updateCharacteristic(
          Characteristic.On,
          status.blower1 === 'on',
        );
      }

      this.platform.log.debug('Updated spa status:', JSON.stringify(status));
    } catch (err) {
      this.platform.log.error('Failed to poll Arctic Spa status:', (err as Error).message);
    }
  }

  private async handleSetTargetTemperature(value: unknown) {
    const c = Number(value);
    const f = this.cToF(c);
    this.platform.log.info(`Setting spa temperature to ${c.toFixed(1)}°C (${f}°F)`);
    try {
      await this.client.setTemperatureF(f);
      // After changing, we rely on next poll to reconcile actual state
    } catch (err) {
      this.platform.log.error('Failed to set spa temperature:', (err as Error).message);
      throw err;
    }
  }

  private async handleSetLights(value: unknown) {
    const on = !!value;
    this.platform.log.info(`Setting spa lights: ${on ? 'on' : 'off'}`);
    try {
      await this.client.setLights(on);
    } catch (err) {
      this.platform.log.error('Failed to set spa lights:', (err as Error).message);
      throw err;
    }
  }

  private async handleSetPump1(value: unknown) {
    const on = !!value;
    this.platform.log.info(`Setting pump 1: ${on ? 'on/high' : 'off'}`);
    try {
      await this.client.setPump('1', on ? 'high' : 'off');
    } catch (err) {
      this.platform.log.error('Failed to set pump 1:', (err as Error).message);
      throw err;
    }
  }

  private async handleSetBlower1(value: unknown) {
    const on = !!value;
    this.platform.log.info(`Setting blower 1: ${on ? 'on' : 'off'}`);
    try {
      await this.client.setBlower('1', on ? 'on' : 'off');
    } catch (err) {
      this.platform.log.error('Failed to set blower 1:', (err as Error).message);
      throw err;
    }
  }
}
