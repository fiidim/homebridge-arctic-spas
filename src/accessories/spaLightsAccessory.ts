import type { Service, PlatformAccessory } from 'homebridge';
import type { ArcticSpasPlatform } from '../platform.js';
import type { SpaClient, SpaStatus } from '../spaClient.js';

export class ArcticSpasLightsAccessory {
  private readonly platform: ArcticSpasPlatform;
  private readonly accessory: PlatformAccessory;
  private readonly client: SpaClient;
  private readonly pollIntervalMs: number;

  private readonly lightService: Service;

  private currentStatus: SpaStatus | null = null;

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
      .setCharacteristic(Characteristic.Model, 'Arctic Spas (Lights)')
      .setCharacteristic(Characteristic.SerialNumber, 'ArcticSpa-Lights');

    this.lightService =
      this.accessory.getService(Service.Lightbulb) ??
      this.accessory.addService(Service.Lightbulb, 'Spa Lights');

    this.lightService
      .getCharacteristic(Characteristic.On)
      .onSet(this.handleSetLights.bind(this));

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

      if (status.lights) {
        this.lightService.updateCharacteristic(
          Characteristic.On,
          status.lights === 'on',
        );
      }

      this.platform.log.debug(
        'Lights status updated:',
        JSON.stringify({ lights: status.lights }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error('Failed to poll lights status:', message);
    }
  }

  private async handleSetLights(value: unknown): Promise<void> {
    const on = Boolean(value);
    this.platform.log.info(`Setting spa lights: ${on ? 'on' : 'off'}`);

    try {
      await this.client.setLights(on);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error('Failed to set spa lights:', message);
      throw error;
    }
  }
}
