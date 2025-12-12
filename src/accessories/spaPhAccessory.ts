// src/accessories/spaPhAccessory.ts
import type { Service, PlatformAccessory } from 'homebridge';
import type { ArcticSpasPlatform } from '../platform.js';
import type { SpaClient, SpaStatus } from '../spaClient.js';

type Severity = 'green' | 'yellow' | 'red';

function mapPhStatusToSeverity(status: string | undefined): Severity {
  if (!status) {
    return 'red';
  }

  const normalized = status.toLowerCase();

  // Explicit ranges from Arctic / HA config:
  // pH Low, pH Low-OK, pH OK, pH OK-High, pH High

  if (normalized.includes('low-ok') || normalized.includes('ok-high')) {
    return 'yellow';
  }

  if (normalized.endsWith('ok')) {
    return 'green';
  }

  // "low", "high", or anything unknown
  return 'red';
}

function severityEmoji(severity: Severity): string {
  switch (severity) {
  case 'green':
    return '🟢';
  case 'yellow':
    return '🟡';
  case 'red':
  default:
    return '🔴';
  }
}

export class ArcticSpasPhAccessory {
  private readonly platform: ArcticSpasPlatform;
  private readonly accessory: PlatformAccessory;
  private readonly client: SpaClient;
  private readonly pollIntervalMs: number;

  private readonly phService: Service;

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
      .setCharacteristic(Characteristic.Model, 'Arctic Spas (pH)')
      .setCharacteristic(Characteristic.SerialNumber, 'ArcticSpa-Ph');

    // We use a LightSensor just to get a numeric tile
    this.phService =
      this.accessory.getService(Service.LightSensor) ??
      this.accessory.addService(Service.LightSensor, 'Spa pH');

    this.phService
      .getCharacteristic(Characteristic.CurrentAmbientLightLevel)
      .setProps({
        minValue: 0.0001,
        maxValue: 100000,
      });

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

      const phValue = status.spaboyPh ?? status.ph;
      const phStatus = status.ph_status;

      if (typeof phValue === 'number') {
        this.phService.updateCharacteristic(
          Characteristic.CurrentAmbientLightLevel,
          phValue,
        );
      }

      const severity = mapPhStatusToSeverity(phStatus);
      const emoji = severityEmoji(severity);

      // Update the name shown on the tile: "Spa pH 🟢 / 🟡 / 🔴"
      this.phService.updateCharacteristic(
        Characteristic.Name,
        `Spa pH ${emoji}`,
      );

      // Optionally expose fault vs OK for automations
      const fault =
        severity === 'red'
          ? Characteristic.StatusFault.GENERAL_FAULT
          : Characteristic.StatusFault.NO_FAULT;

      this.phService.updateCharacteristic(
        Characteristic.StatusFault,
        fault,
      );

      this.platform.log.debug(
        'pH status updated:',
        JSON.stringify({ phValue, phStatus, severity }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error('Failed to poll pH status:', message);
    }
  }
}
