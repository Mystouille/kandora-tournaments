import { WebPlugin } from "@capacitor/core";
import type {
  NearbyConnectionsPlugin,
  NearbyPermissionState,
  NearbyState,
} from "./NearbyConnections";

const UNSUPPORTED = "Nearby Connections requires the Android or iOS app";

export class NearbyConnectionsWeb
  extends WebPlugin
  implements NearbyConnectionsPlugin
{
  async getState(): Promise<NearbyState> {
    return {
      available: false,
      advertising: false,
      discovering: false,
      connected: [],
      permissions: { granted: false, missing: ["native-platform"] },
    };
  }

  async requestNearbyPermissions(): Promise<NearbyPermissionState> {
    return { granted: false, missing: ["native-platform"] };
  }

  async startAdvertising(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async stopAdvertising(): Promise<void> {}

  async startDiscovery(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async stopDiscovery(): Promise<void> {}

  async requestConnection(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async acceptConnection(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async rejectConnection(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async disconnect(): Promise<void> {}

  async send(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async stopAll(): Promise<void> {}
}
