import Docker from 'dockerode';
import fs from 'fs';
import { UdpRange } from './types';

const HOST_IP = process.env.HOST_IP || '130.61.105.83';
const STATIC_PORT = 8080;
const STATIC_NEKO_URL =
  process.env.NEKO_URL || `http://${HOST_IP}:${STATIC_PORT}`;

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const NEKO_IMAGE =
  process.env.NEKO_IMAGE || 'ghcr.io/m1k1o/neko/firefox:latest';
const WEB_PORT_START = parseInt(process.env.WEB_PORT_START || '8081', 10);
const UDP_PORT_START = parseInt(process.env.UDP_PORT_START || '52000', 10);
const UDP_PORT_END = parseInt(process.env.UDP_PORT_END || '52100', 10);
const UDP_PORTS_PER_ROOM = parseInt(
  process.env.UDP_PORTS_PER_ROOM || '10',
  10
);
const USE_STATIC_NEKO = process.env.USE_STATIC_NEKO === 'true';

const usedWebPorts = new Set<number>();
const usedUdpStarts = new Set<number>();

let dockerClient: Docker | null = null;

function isDockerAvailable(): boolean {
  if (USE_STATIC_NEKO) return false;
  if (process.platform !== 'win32') {
    return fs.existsSync(DOCKER_SOCKET);
  }
  return Boolean(process.env.DOCKER_HOST);
}

function getDocker(): Docker {
  if (!dockerClient) {
    dockerClient = new Docker({ socketPath: DOCKER_SOCKET });
  }
  return dockerClient;
}

export interface AllocatedResources {
  port: number;
  udpRange: UdpRange;
  isStatic: boolean;
}

export function allocatePorts(): AllocatedResources {
  if (!isDockerAvailable()) {
    return {
      port: STATIC_PORT,
      udpRange: {
        start: UDP_PORT_START,
        end: UDP_PORT_END,
      },
      isStatic: true,
    };
  }

  let webPort = WEB_PORT_START;
  while (usedWebPorts.has(webPort)) {
    webPort++;
  }

  let udpStart: number | null = null;
  for (
    let start = UDP_PORT_START;
    start + UDP_PORTS_PER_ROOM - 1 <= UDP_PORT_END;
    start += UDP_PORTS_PER_ROOM
  ) {
    if (!usedUdpStarts.has(start)) {
      udpStart = start;
      break;
    }
  }

  if (udpStart === null) {
    throw new Error(
      'Boşta WebRTC UDP port aralığı kalmadı. Maksimum eşzamanlı oda sınırına ulaşıldı.'
    );
  }

  usedWebPorts.add(webPort);
  usedUdpStarts.add(udpStart);

  return {
    port: webPort,
    udpRange: {
      start: udpStart,
      end: udpStart + UDP_PORTS_PER_ROOM - 1,
    },
    isStatic: false,
  };
}

export function releasePorts(port: number, udpStart: number): void {
  usedWebPorts.delete(port);
  usedUdpStarts.delete(udpStart);
}

async function waitForNekoReady(url: string, timeoutMs = 12000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(1500),
      });
      if (res.status < 500) {
        return;
      }
    } catch {
      // Container henüz ayağa kalkıyor
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

export async function startNekoContainer(params: {
  roomId: string;
  port: number;
  udpRange: UdpRange;
  nekoPassword: string;
  isStatic?: boolean;
}): Promise<{ containerId: string; nekoUrl: string }> {
  if (params.isStatic || !isDockerAvailable()) {
    console.log(
      `[Docker-Static] Oda ${params.roomId} için mevcut Neko sunucusu (${STATIC_NEKO_URL}) kullanılıyor.`
    );
    return {
      containerId: `static-neko-${STATIC_PORT}`,
      nekoUrl: STATIC_NEKO_URL,
    };
  }

  const docker = getDocker();
  const containerName = `neko-room-${params.roomId}`;
  const { port, udpRange, nekoPassword } = params;

  const exposedPorts: Record<string, Record<string, never>> = {
    '8080/tcp': {},
  };
  const portBindings: Record<string, Array<{ HostPort: string }>> = {
    '8080/tcp': [{ HostPort: String(port) }],
  };

  for (let udpPort = udpRange.start; udpPort <= udpRange.end; udpPort++) {
    const key = `${udpPort}/udp`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: String(udpPort) }];
  }

  const container = await docker.createContainer({
    Image: NEKO_IMAGE,
    name: containerName,
    ExposedPorts: exposedPorts,
    Env: [
      `NEKO_SCREEN=1280x720@30`,
      `NEKO_PASSWORD=${nekoPassword}`,
      `NEKO_PASSWORD_ADMIN=${nekoPassword}`,
      `NEKO_EPR=${udpRange.start}-${udpRange.end}`,
      `NEKO_NAT1TO1=${HOST_IP}`,
      `NEKO_ICELITE=0`,
      // Neko v3 ortam değişkenleri uyumluluğu
      `NEKO_CAPTURE_SCREEN=1280x720@30`,
      `NEKO_MEMBER_MULTIUSER_USER_PASSWORD=${nekoPassword}`,
      `NEKO_MEMBER_MULTIUSER_ADMIN_PASSWORD=${nekoPassword}`,
      `NEKO_WEBRTC_EPR=${udpRange.start}-${udpRange.end}`,
      `NEKO_WEBRTC_NAT1TO1=${HOST_IP}`,
      `NEKO_WEBRTC_ICELITE=false`,
      `NEKO_WEBRTC_ICESERVERS_FRONTEND=[{"urls":["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}]`,
      `NEKO_WEBRTC_ICESERVERS_BACKEND=[{"urls":["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}]`,
    ],
    HostConfig: {
      ShmSize: 2 * 1024 * 1024 * 1024, // 2GB /dev/shm (Firefox çökmesini önler)
      PortBindings: portBindings,
      CapAdd: ['SYS_ADMIN'],
    },
  });

  try {
    await container.start();

    const nekoUrl = `http://${HOST_IP}:${port}`;
    await waitForNekoReady(nekoUrl);

    console.log(
      `[Docker] Oda ${params.roomId} için container başlatıldı (${container.id.slice(0, 12)}) -> ${nekoUrl} [UDP ${udpRange.start}-${udpRange.end}]`
    );

    return {
      containerId: container.id,
      nekoUrl,
    };
  } catch (err) {
    await container.remove({ force: true }).catch(() => {});
    throw err;
  }
}

export async function cleanupOrphanContainers(): Promise<void> {
  if (!isDockerAvailable()) return;
  try {
    const docker = getDocker();
    const containers = await docker.listContainers({ all: true });
    for (const c of containers) {
      const isNekoRoom = c.Names.some((n) => n.includes('neko-room-'));
      if (isNekoRoom) {
        console.log(`[Docker] Başlangıçta artık container temizleniyor: ${c.Names.join(', ')}`);
        const cont = docker.getContainer(c.Id);
        await cont.remove({ force: true }).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[Docker] Başlangıç container temizliği hatası:', err);
  }
}

export async function stopAndRemoveContainer(
  containerId: string
): Promise<void> {
  if (!containerId || containerId.startsWith('static-neko-')) {
    console.log(
      `[Docker-Static] Sabit Neko container korunuyor (${containerId}).`
    );
    return;
  }

  if (!isDockerAvailable()) return;

  try {
    const docker = getDocker();
    const container = docker.getContainer(containerId);
    await container.remove({ force: true });
    console.log(`[Docker] Container durduruldu ve silindi: ${containerId.slice(0, 12)}`);
  } catch (err) {
    console.warn(`[Docker] Container silinirken uyarı (${containerId.slice(0, 12)}):`, err);
  }
}

export function getHostIp(): string {
  return HOST_IP;
}

export function getNekoUrl(): string {
  return STATIC_NEKO_URL;
}
