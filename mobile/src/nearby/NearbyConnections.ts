import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface NearbyEndpoint {
  endpointId: string;
  endpointName: string;
}

export interface NearbyPermissionState {
  granted: boolean;
  missing: string[];
}

export interface NearbyState {
  available: boolean;
  advertising: boolean;
  discovering: boolean;
  connected: NearbyEndpoint[];
  permissions: NearbyPermissionState;
}

export interface NearbyConnectionInitiated extends NearbyEndpoint {
  authenticationDigits: string;
  incoming: boolean;
}

export interface NearbyConnectionResult extends NearbyEndpoint {
  status: "connected" | "rejected" | "error";
}

export interface NearbyMessage {
  endpointId: string;
  data: string;
}

export interface NearbyError {
  operation: string;
  message: string;
}

export interface NearbyConnectionsPlugin {
  getState(): Promise<NearbyState>;
  requestNearbyPermissions(): Promise<NearbyPermissionState>;
  startAdvertising(options: { endpointName: string }): Promise<void>;
  stopAdvertising(): Promise<void>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  requestConnection(options: {
    endpointId: string;
    endpointName: string;
  }): Promise<void>;
  acceptConnection(options: { endpointId: string }): Promise<void>;
  rejectConnection(options: { endpointId: string }): Promise<void>;
  disconnect(options: { endpointId: string }): Promise<void>;
  send(options: { endpointIds: string[]; data: string }): Promise<void>;
  stopAll(): Promise<void>;
  addListener(
    eventName: "endpointFound",
    listener: (event: NearbyEndpoint) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "endpointLost",
    listener: (event: { endpointId: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "connectionInitiated",
    listener: (event: NearbyConnectionInitiated) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "connectionResult",
    listener: (event: NearbyConnectionResult) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "disconnected",
    listener: (event: { endpointId: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "message",
    listener: (event: NearbyMessage) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "nearbyError",
    listener: (event: NearbyError) => void
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const NearbyConnections = registerPlugin<NearbyConnectionsPlugin>(
  "NearbyConnections",
  {
    web: () =>
      import("./NearbyConnectionsWeb").then(
        ({ NearbyConnectionsWeb }) => new NearbyConnectionsWeb()
      ),
  }
);
