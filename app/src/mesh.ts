import { BridgewiseMesh, MeshStartError, type Mesh } from '@bridgewise/mesh-react-native';
import type { AppConfig } from './core/config';

/**
 * Bridgewise Mesh: payments travel to the settlement agent through nearby phones over Bluetooth,
 * and the receipt comes back the same way. Webhook mode: the Mesh Cloud POSTs each message to
 * https://agent.lorapay.io/mesh/webhook.
 */
let mesh: Mesh = BridgewiseMesh;
let initialised = false;

export function getMesh(): Mesh {
  return mesh;
}

/** Tests: an in-memory FakeMesh */
export function setMeshForTests(m: Mesh) {
  mesh = m;
  initialised = false;
}

export type MeshState = 'running' | 'needs_permission' | 'bluetooth_off' | 'location_off' | 'unsupported' | 'failed';

/** At app start: never asks for anything. */
export async function startMesh(cfg: AppConfig): Promise<MeshState> {
  if (!mesh.isSupported()) {
    return 'unsupported';
  }
  if (!initialised) {
    await mesh.init({
      appKey: cfg.meshAppKey,
      baseUrl: cfg.meshBaseUrl,
      notification: { title: 'Aevum Pay', text: 'Passing on offline payments for phones nearby', channelName: 'Offline payments' },
    });
    initialised = true;
  }
  if ((await mesh.missingPermissions()).length > 0) {
    return 'needs_permission';
  }
  return run();
}

/** When the person turns the mesh on: asks for "Nearby devices" (or location on old Android). */
export async function enableMesh(cfg: AppConfig): Promise<MeshState> {
  const first = await startMesh(cfg);
  if (first !== 'needs_permission') {
    return first;
  }
  return (await mesh.requestPermissions()) ? run() : 'needs_permission';
}

async function run(): Promise<MeshState> {
  try {
    if (!mesh.isRunning()) {
      await mesh.start();
    }
    await mesh.setRelayInBackground(true).catch(() => false);
    return 'running';
  } catch (e) {
    if (e instanceof MeshStartError) {
      if (e.code === 'permission_denied') return 'needs_permission';
      if (e.code === 'bluetooth_off' || e.code === 'location_off' || e.code === 'unsupported') return e.code;
    }
    return 'failed';
  }
}

export function meshStateText(s: MeshState): string {
  switch (s) {
    case 'running':
      return 'Passing payments through nearby phones';
    case 'needs_permission':
      return 'Allow "Nearby devices" to pay without signal';
    case 'bluetooth_off':
      return 'Turn on Bluetooth to pay without signal';
    case 'location_off':
      return 'Turn on location to pay without signal (older Android)';
    case 'unsupported':
      return 'This phone cannot use the mesh';
    default:
      return 'The mesh could not start';
  }
}
