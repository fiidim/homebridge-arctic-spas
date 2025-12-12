// src/accessories/spaOrpAccessory.ts
import type { Service, PlatformAccessory } from 'homebridge';
import type { ArcticSpasPlatform } from '../platform.js';
import type { SpaClient, SpaStatus } from '../spaClient.js';

type Severity = 'green' | 'yellow' | 'red';

function mapOrpStatusToSeverity(status: string | undefined): Severity {
  if (!status) {
    return 'red';
  }

  const normalized = status.toLowerCase();

  // CL Low, CL Low-OK, CL OK, CL OK-High, CL High
  if (normalized.includes('low-ok') || normalized.includes('ok-high')) {
    return 'yellow';
  }

  if (normalized.endsWith('ok')) {
    return 'green';
  }

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

export class ArcticSpasOrpAccessory {
  private readonly platform: ArcticSpasPlatform;
  private readonly accessory: PlatformAccessory;
  private readonly client: SpaClient;
  private readonly pollIntervalMs: number;

  private readonly orpService: Service;

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
      .setCharacteristic(Characteristic.Model, 'Arctic Spas (ORP)')
      .setCharacteristic(Characteristic.SerialNumber, 'ArcticSpa-Orp');

    this.orpService =
      this.accessory.getService(Service.LightSensor) ??
      this.accessory.addService(Service.LightSensor, 'Spa ORP');

    this.orpService
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

      const orpValue = status.spaboyOrp ?? status.orp;
      const orpStatus = status.orp_status;

      if (typeof orpValue === 'number') {
        this.orpService.updateCharacteristic(
          Characteristic.CurrentAmbientLightLevel,
          orpValue,
        );
      }

      const severity = mapOrpStatusToSeverity(orpStatus);
      const emoji = severityEmoji(severity);

      this.orpService.updateCharacteristic(
        Characteristic.Name,
        `Spa ORP ${emoji}`,
      );

      const fault =
        severity === 'red'
          ? Characteristic.StatusFault.GENERAL_FAULT
          : Characteristic.StatusFault.NO_FAULT;

      this.orpService.updateCharacteristic(
        Characteristic.StatusFault,
        fault,
      );

      this.platform.log.debug(
        'ORP status updated:',
        JSON.stringify({ orpValue, orpStatus, severity }),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error('Failed to poll ORP status:', message);
    }
  }
}
