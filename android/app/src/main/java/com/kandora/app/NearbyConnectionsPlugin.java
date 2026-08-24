package com.kandora.app;

import android.Manifest;
import android.os.Build;
import androidx.annotation.NonNull;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONException;

@CapacitorPlugin(
    name = "NearbyConnections",
    permissions = {
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }
        ),
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
            }
        ),
        @Permission(alias = "nearbyWifi", strings = { Manifest.permission.NEARBY_WIFI_DEVICES })
    }
)
public class NearbyConnectionsPlugin extends Plugin {

    private static final String SERVICE_ID = "com.kandora.app.nearby.v1";
    private static final Strategy STRATEGY = Strategy.P2P_STAR;
    private static final int MAX_BYTES_PAYLOAD = 32 * 1024;

    private ConnectionsClient client;
    private volatile boolean advertising = false;
    private volatile boolean discovering = false;
    private final Map<String, String> endpointNames = new ConcurrentHashMap<>();
    private final Set<String> connectedEndpoints = ConcurrentHashMap.newKeySet();
    private final Set<String> outgoingEndpoints = ConcurrentHashMap.newKeySet();

    @Override
    public void load() {
        super.load();
        client = Nearby.getConnectionsClient(getContext());
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        result.put("advertising", advertising);
        result.put("discovering", discovering);
        result.put("permissions", permissionState());
        JSArray connected = new JSArray();
        for (String endpointId : connectedEndpoints) {
            connected.put(endpoint(endpointId));
        }
        result.put("connected", connected);
        call.resolve(result);
    }

    @PluginMethod
    public void requestNearbyPermissions(PluginCall call) {
        List<String> aliases = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            aliases.add("bluetooth");
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S_V2) {
            aliases.add("nearbyWifi");
        }
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S) {
            aliases.add("location");
        }
        if (aliases.isEmpty()) {
            call.resolve(permissionState());
            return;
        }
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "nearbyPermissionsCallback");
    }

    @PermissionCallback
    private void nearbyPermissionsCallback(PluginCall call) {
        call.resolve(permissionState());
    }

    @PluginMethod
    public void startAdvertising(PluginCall call) {
        if (!ensurePermissions(call)) {
            return;
        }
        String endpointName = requiredString(call, "endpointName");
        if (endpointName == null) {
            return;
        }
        AdvertisingOptions options = new AdvertisingOptions.Builder().setStrategy(STRATEGY).build();
        resolveTask(
            client.startAdvertising(endpointName, SERVICE_ID, connectionLifecycleCallback, options),
            call,
            "startAdvertising",
            () -> advertising = true
        );
    }

    @PluginMethod
    public void stopAdvertising(PluginCall call) {
        client.stopAdvertising();
        advertising = false;
        call.resolve();
    }

    @PluginMethod
    public void startDiscovery(PluginCall call) {
        if (!ensurePermissions(call)) {
            return;
        }
        DiscoveryOptions options = new DiscoveryOptions.Builder().setStrategy(STRATEGY).build();
        resolveTask(client.startDiscovery(SERVICE_ID, endpointDiscoveryCallback, options), call, "startDiscovery", () -> discovering = true);
    }

    @PluginMethod
    public void stopDiscovery(PluginCall call) {
        client.stopDiscovery();
        discovering = false;
        call.resolve();
    }

    @PluginMethod
    public void requestConnection(PluginCall call) {
        if (!ensurePermissions(call)) {
            return;
        }
        String endpointId = requiredString(call, "endpointId");
        String endpointName = requiredString(call, "endpointName");
        if (endpointId == null || endpointName == null) {
            return;
        }
        outgoingEndpoints.add(endpointId);
        resolveTask(
            client.requestConnection(endpointName, endpointId, connectionLifecycleCallback),
            call,
            "requestConnection",
            null
        );
    }

    @PluginMethod
    public void acceptConnection(PluginCall call) {
        String endpointId = requiredString(call, "endpointId");
        if (endpointId == null) {
            return;
        }
        resolveTask(client.acceptConnection(endpointId, payloadCallback), call, "acceptConnection", null);
    }

    @PluginMethod
    public void rejectConnection(PluginCall call) {
        String endpointId = requiredString(call, "endpointId");
        if (endpointId == null) {
            return;
        }
        resolveTask(client.rejectConnection(endpointId), call, "rejectConnection", null);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        String endpointId = requiredString(call, "endpointId");
        if (endpointId == null) {
            return;
        }
        client.disconnectFromEndpoint(endpointId);
        connectedEndpoints.remove(endpointId);
        outgoingEndpoints.remove(endpointId);
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        String data = requiredString(call, "data");
        JSArray endpointIds = call.getArray("endpointIds");
        if (data == null || endpointIds == null) {
            if (endpointIds == null) {
                call.reject("endpointIds is required");
            }
            return;
        }
        byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES_PAYLOAD) {
            call.reject("Nearby byte payload exceeds 32 KiB");
            return;
        }
        List<String> ids;
        try {
            ids = endpointIds.toList();
        } catch (JSONException error) {
            call.reject("endpointIds must contain strings", error);
            return;
        }
        if (ids.isEmpty()) {
            call.reject("At least one endpointId is required");
            return;
        }
        List<Task<Void>> sends = new ArrayList<>();
        for (String endpointId : ids) {
            if (!connectedEndpoints.contains(endpointId)) {
                call.reject("Endpoint is not connected: " + endpointId);
                return;
            }
            sends.add(client.sendPayload(endpointId, Payload.fromBytes(bytes)));
        }
        resolveTask(Tasks.whenAll(sends), call, "send", null);
    }

    @PluginMethod
    public void stopAll(PluginCall call) {
        client.stopAdvertising();
        client.stopDiscovery();
        client.stopAllEndpoints();
        advertising = false;
        discovering = false;
        connectedEndpoints.clear();
        outgoingEndpoints.clear();
        endpointNames.clear();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (client != null) {
            client.stopAdvertising();
            client.stopDiscovery();
            client.stopAllEndpoints();
        }
        super.handleOnDestroy();
    }

    private final EndpointDiscoveryCallback endpointDiscoveryCallback = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(@NonNull String endpointId, @NonNull DiscoveredEndpointInfo info) {
            endpointNames.put(endpointId, info.getEndpointName());
            notifyListeners("endpointFound", endpoint(endpointId));
        }

        @Override
        public void onEndpointLost(@NonNull String endpointId) {
            endpointNames.remove(endpointId);
            JSObject event = new JSObject();
            event.put("endpointId", endpointId);
            notifyListeners("endpointLost", event);
        }
    };

    private final ConnectionLifecycleCallback connectionLifecycleCallback = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(@NonNull String endpointId, @NonNull ConnectionInfo info) {
            endpointNames.put(endpointId, info.getEndpointName());
            JSObject event = endpoint(endpointId);
            event.put("authenticationDigits", info.getAuthenticationDigits());
            event.put("incoming", !outgoingEndpoints.contains(endpointId));
            notifyListeners("connectionInitiated", event);
        }

        @Override
        public void onConnectionResult(@NonNull String endpointId, @NonNull ConnectionResolution resolution) {
            int code = resolution.getStatus().getStatusCode();
            String status;
            if (code == ConnectionsStatusCodes.STATUS_OK) {
                status = "connected";
                connectedEndpoints.add(endpointId);
            } else if (code == ConnectionsStatusCodes.STATUS_CONNECTION_REJECTED) {
                status = "rejected";
            } else {
                status = "error";
            }
            outgoingEndpoints.remove(endpointId);
            JSObject event = endpoint(endpointId);
            event.put("status", status);
            notifyListeners("connectionResult", event);
        }

        @Override
        public void onDisconnected(@NonNull String endpointId) {
            connectedEndpoints.remove(endpointId);
            outgoingEndpoints.remove(endpointId);
            JSObject event = new JSObject();
            event.put("endpointId", endpointId);
            notifyListeners("disconnected", event);
        }
    };

    private final PayloadCallback payloadCallback = new PayloadCallback() {
        @Override
        public void onPayloadReceived(@NonNull String endpointId, @NonNull Payload payload) {
            if (payload.getType() != Payload.Type.BYTES) {
                emitError("receive", "Only byte payloads are supported");
                return;
            }
            byte[] bytes = payload.asBytes();
            if (bytes == null) {
                emitError("receive", "Nearby byte payload was empty");
                return;
            }
            JSObject event = new JSObject();
            event.put("endpointId", endpointId);
            event.put("data", new String(bytes, StandardCharsets.UTF_8));
            notifyListeners("message", event);
        }

        @Override
        public void onPayloadTransferUpdate(@NonNull String endpointId, @NonNull PayloadTransferUpdate update) {
            if (
                update.getStatus() == PayloadTransferUpdate.Status.FAILURE ||
                update.getStatus() == PayloadTransferUpdate.Status.CANCELED
            ) {
                emitError("transfer", "Nearby payload transfer failed for " + endpointId);
            }
        }
    };

    private JSObject permissionState() {
        List<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            missing.add("bluetooth");
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S_V2 && getPermissionState("nearbyWifi") != PermissionState.GRANTED) {
            missing.add("nearbyWifi");
        }
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.S && getPermissionState("location") != PermissionState.GRANTED) {
            missing.add("location");
        }
        JSObject result = new JSObject();
        result.put("granted", missing.isEmpty());
        result.put("missing", new JSArray(missing));
        return result;
    }

    private boolean ensurePermissions(PluginCall call) {
        JSObject permissions = permissionState();
        if (!permissions.optBoolean("granted", false)) {
            call.reject("Nearby permissions are not granted");
            return false;
        }
        return true;
    }

    private String requiredString(PluginCall call, String key) {
        String value = call.getString(key);
        if (value == null || value.trim().isEmpty()) {
            call.reject(key + " is required");
            return null;
        }
        return value;
    }

    private JSObject endpoint(String endpointId) {
        JSObject result = new JSObject();
        result.put("endpointId", endpointId);
        result.put("endpointName", endpointNames.getOrDefault(endpointId, "Nearby device"));
        return result;
    }

    private void resolveTask(Task<Void> task, PluginCall call, String operation, Runnable onSuccess) {
        task
            .addOnSuccessListener(
                ignored -> {
                    if (onSuccess != null) {
                        onSuccess.run();
                    }
                    call.resolve();
                }
            )
            .addOnFailureListener(
                error -> {
                    emitError(operation, error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
                    call.reject("Nearby " + operation + " failed", error);
                }
            );
    }

    private void emitError(String operation, String message) {
        JSObject event = new JSObject();
        event.put("operation", operation);
        event.put("message", message);
        notifyListeners("nearbyError", event);
    }
}
