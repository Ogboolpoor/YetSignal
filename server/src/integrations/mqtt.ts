import mqtt, { type MqttClient } from 'mqtt';
import { config } from '../config.ts';
import { logger } from '../logger.ts';
import type { SensingState } from '../types.ts';

const log = logger('mqtt');
const BASE = 'yetsignal';
const STATE_TOPIC = `${BASE}/state`;
const AVAIL_TOPIC = `${BASE}/availability`;

const DEVICE = {
  identifiers: ['yetsignal-server'],
  name: 'YetSignal',
  manufacturer: 'YetSignal',
  model: 'CSI Sensing Server',
  sw_version: config.version,
};

/**
 * FR-24 — MQTT with Home Assistant auto-discovery. Optional: only active when
 * MQTT_URL is configured. Publishes one retained discovery config per entity,
 * then a single JSON state payload that all entities read via value_template.
 */
export class MqttIntegration {
  private client: MqttClient | null = null;
  connected = false;

  start() {
    if (!config.mqttUrl) {
      log.info('MQTT disabled (set MQTT_URL to enable)');
      return;
    }
    log.info(`connecting to ${config.mqttUrl}`);
    this.client = mqtt.connect(config.mqttUrl, {
      will: { topic: AVAIL_TOPIC, payload: 'offline', retain: true, qos: 0 },
      reconnectPeriod: 5000,
    });
    this.client.on('connect', () => {
      this.connected = true;
      log.info('connected');
      this.client!.publish(AVAIL_TOPIC, 'online', { retain: true });
      this.publishDiscovery();
    });
    this.client.on('error', (e) => log.error(`error: ${e.message}`));
    this.client.on('close', () => {
      this.connected = false;
    });
  }

  private discoveryConfig(component: string, objectId: string, payload: Record<string, unknown>) {
    const topic = `${config.mqttDiscoveryPrefix}/${component}/${BASE}/${objectId}/config`;
    this.client!.publish(
      topic,
      JSON.stringify({
        availability_topic: AVAIL_TOPIC,
        state_topic: STATE_TOPIC,
        unique_id: `${BASE}_${objectId}`,
        device: DEVICE,
        ...payload,
      }),
      { retain: true },
    );
  }

  private publishDiscovery() {
    this.discoveryConfig('binary_sensor', 'presence', {
      name: 'Presence',
      device_class: 'occupancy',
      value_template: '{{ value_json.presence }}',
      payload_on: true,
      payload_off: false,
    });
    this.discoveryConfig('binary_sensor', 'fall', {
      name: 'Fall detected',
      device_class: 'safety',
      value_template: '{{ value_json.fall }}',
      payload_on: true,
      payload_off: false,
    });
    this.discoveryConfig('sensor', 'people', {
      name: 'People count',
      state_class: 'measurement',
      value_template: '{{ value_json.peopleCount }}',
      icon: 'mdi:account-group',
    });
    this.discoveryConfig('sensor', 'motion', {
      name: 'Motion level',
      unit_of_measurement: '%',
      value_template: '{{ (value_json.motionLevel * 100) | round(0) }}',
      icon: 'mdi:run',
    });
    this.discoveryConfig('sensor', 'breathing', {
      name: 'Breathing rate',
      unit_of_measurement: 'bpm',
      value_template: '{{ value_json.breathingRateBpm }}',
      icon: 'mdi:lungs',
    });
    this.discoveryConfig('sensor', 'heart', {
      name: 'Heart rate',
      unit_of_measurement: 'bpm',
      value_template: '{{ value_json.heartRateBpm }}',
      icon: 'mdi:heart-pulse',
    });
    log.info('published Home Assistant discovery configs');
  }

  publishState(s: SensingState) {
    if (!this.client || !this.connected) return;
    this.client.publish(
      STATE_TOPIC,
      JSON.stringify({
        presence: s.presence,
        fall: s.fall,
        peopleCount: s.peopleCount,
        motionLevel: s.motionLevel,
        activity: s.activity,
        breathingRateBpm: s.breathingRateBpm,
        heartRateBpm: s.heartRateBpm,
      }),
    );
  }

  publishEvent(kind: string, value: number) {
    if (!this.client || !this.connected) return;
    this.client.publish(`${BASE}/event/${kind}`, String(value));
  }

  stop() {
    if (this.client) {
      this.client.publish(AVAIL_TOPIC, 'offline', { retain: true });
      this.client.end();
    }
  }
}
