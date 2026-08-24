import Capacitor
import Foundation
import NearbyConnections

@objc(NearbyConnectionsPlugin)
public class NearbyConnectionsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NearbyConnectionsPlugin"
    public let jsName = "NearbyConnections"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNearbyPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startAdvertising", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAdvertising", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acceptConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rejectConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopAll", returnType: CAPPluginReturnPromise)
    ]

    private static let serviceID = "com.kandora.app.nearby.v1"
    private static let maximumPayloadBytes = 32 * 1024

    private var connectionManager: ConnectionManager?
    private var advertiser: Advertiser?
    private var discoverer: Discoverer?
    private var isAdvertising = false
    private var isDiscovering = false
    private var endpointNames: [EndpointID: String] = [:]
    private var connectedEndpoints = Set<EndpointID>()
    private var outgoingEndpoints = Set<EndpointID>()
    private var pendingVerification: [EndpointID: (Bool) -> Void] = [:]

    @objc func getState(_ call: CAPPluginCall) {
        let connected: JSArray = connectedEndpoints.map { endpointID in
            endpointObject(endpointID) as JSValue
        }
        call.resolve([
            "available": true,
            "advertising": isAdvertising,
            "discovering": isDiscovering,
            "connected": connected,
            "permissions": permissionState()
        ])
    }

    @objc func requestNearbyPermissions(_ call: CAPPluginCall) {
        call.resolve(permissionState())
    }

    @objc func startAdvertising(_ call: CAPPluginCall) {
        guard let endpointName = requiredString(call, key: "endpointName") else {
            return
        }
        stopModes { [weak self] stopError in
            guard let self else {
                call.reject("Nearby Connections is unavailable")
                return
            }
            if let stopError {
                call.reject(stopError.localizedDescription)
                return
            }
            let manager = self.makeConnectionManager()
            let nextAdvertiser = Advertiser(connectionManager: manager)
            nextAdvertiser.delegate = self
            self.advertiser = nextAdvertiser
            nextAdvertiser.startAdvertising(using: Data(endpointName.utf8)) { [weak self] error in
                if let error {
                    self?.emitError(operation: "startAdvertising", message: error.localizedDescription)
                    call.reject(error.localizedDescription)
                    return
                }
                self?.isAdvertising = true
                call.resolve()
            }
        }
    }

    @objc func stopAdvertising(_ call: CAPPluginCall) {
        guard let advertiser else {
            isAdvertising = false
            call.resolve()
            return
        }
        advertiser.stopAdvertising { [weak self] error in
            self?.isAdvertising = false
            self?.advertiser = nil
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func startDiscovery(_ call: CAPPluginCall) {
        stopModes { [weak self] stopError in
            guard let self else {
                call.reject("Nearby Connections is unavailable")
                return
            }
            if let stopError {
                call.reject(stopError.localizedDescription)
                return
            }
            let manager = self.makeConnectionManager()
            let nextDiscoverer = Discoverer(connectionManager: manager)
            nextDiscoverer.delegate = self
            self.discoverer = nextDiscoverer
            nextDiscoverer.startDiscovery { [weak self] error in
                if let error {
                    self?.emitError(operation: "startDiscovery", message: error.localizedDescription)
                    call.reject(error.localizedDescription)
                    return
                }
                self?.isDiscovering = true
                call.resolve()
            }
        }
    }

    @objc func stopDiscovery(_ call: CAPPluginCall) {
        guard let discoverer else {
            isDiscovering = false
            call.resolve()
            return
        }
        discoverer.stopDiscovery { [weak self] error in
            self?.isDiscovering = false
            self?.discoverer = nil
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func requestConnection(_ call: CAPPluginCall) {
        guard let endpointID = requiredString(call, key: "endpointId") else {
            return
        }
        guard let endpointName = requiredString(call, key: "endpointName") else {
            return
        }
        guard let discoverer else {
            call.reject("Start discovery before requesting a connection")
            return
        }
        outgoingEndpoints.insert(endpointID)
        discoverer.requestConnection(to: endpointID, using: Data(endpointName.utf8)) { [weak self] error in
            if let error {
                self?.outgoingEndpoints.remove(endpointID)
                self?.emitError(operation: "requestConnection", message: error.localizedDescription)
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func acceptConnection(_ call: CAPPluginCall) {
        guard let endpointID = requiredString(call, key: "endpointId") else {
            return
        }
        guard let verificationHandler = pendingVerification.removeValue(forKey: endpointID) else {
            call.reject("No pending verification for this endpoint")
            return
        }
        verificationHandler(true)
        call.resolve()
    }

    @objc func rejectConnection(_ call: CAPPluginCall) {
        guard let endpointID = requiredString(call, key: "endpointId") else {
            return
        }
        guard let verificationHandler = pendingVerification.removeValue(forKey: endpointID) else {
            call.reject("No pending verification for this endpoint")
            return
        }
        verificationHandler(false)
        call.resolve()
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        guard let endpointID = requiredString(call, key: "endpointId") else {
            return
        }
        guard let connectionManager else {
            call.reject("Nearby Connections is not active")
            return
        }
        connectionManager.disconnect(from: endpointID) { [weak self] error in
            self?.connectedEndpoints.remove(endpointID)
            self?.outgoingEndpoints.remove(endpointID)
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let data = requiredString(call, key: "data") else {
            return
        }
        guard let endpointIDs = call.getArray("endpointIds", String.self) else {
            call.reject("endpointIds is required")
            return
        }
        guard let connectionManager else {
            call.reject("Nearby Connections is not active")
            return
        }
        let payload = Data(data.utf8)
        guard payload.count <= Self.maximumPayloadBytes else {
            call.reject("Nearby byte payload exceeds 32 KiB")
            return
        }
        guard !endpointIDs.isEmpty else {
            call.reject("At least one endpointId is required")
            return
        }
        guard endpointIDs.allSatisfy(connectedEndpoints.contains) else {
            call.reject("Every endpoint must be connected")
            return
        }
        _ = connectionManager.send(payload, to: endpointIDs) { error in
            if let error {
                call.reject(error.localizedDescription)
            } else {
                call.resolve()
            }
        }
    }

    @objc func stopAll(_ call: CAPPluginCall) {
        stopModes { [weak self] stopError in
            guard let self else {
                call.reject("Nearby Connections is unavailable")
                return
            }
            self.disconnectAll { disconnectError in
                if let error = stopError ?? disconnectError {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve()
                }
            }
        }
    }

    private func makeConnectionManager() -> ConnectionManager {
        let manager = ConnectionManager(serviceID: Self.serviceID, strategy: .star)
        manager.delegate = self
        connectionManager = manager
        return manager
    }

    private func stopModes(completion: @escaping (Error?) -> Void) {
        if let advertiser {
            advertiser.stopAdvertising { [weak self] error in
                self?.advertiser = nil
                self?.isAdvertising = false
                self?.stopDiscoveryMode(previousError: error, completion: completion)
            }
            return
        }
        stopDiscoveryMode(previousError: nil, completion: completion)
    }

    private func stopDiscoveryMode(
        previousError: Error?,
        completion: @escaping (Error?) -> Void
    ) {
        guard let discoverer else {
            isDiscovering = false
            completion(previousError)
            return
        }
        discoverer.stopDiscovery { [weak self] error in
            self?.discoverer = nil
            self?.isDiscovering = false
            completion(previousError ?? error)
        }
    }

    private func disconnectAll(completion: @escaping (Error?) -> Void) {
        for verificationHandler in pendingVerification.values {
            verificationHandler(false)
        }
        pendingVerification.removeAll()
        guard let connectionManager, !connectedEndpoints.isEmpty else {
            connectedEndpoints.removeAll()
            outgoingEndpoints.removeAll()
            endpointNames.removeAll()
            self.connectionManager = nil
            completion(nil)
            return
        }
        let endpointIDs = Array(connectedEndpoints)
        var remaining = endpointIDs.count
        var firstError: Error?
        for endpointID in endpointIDs {
            connectionManager.disconnect(from: endpointID) { [weak self] error in
                firstError = firstError ?? error
                self?.connectedEndpoints.remove(endpointID)
                remaining -= 1
                if remaining == 0 {
                    self?.outgoingEndpoints.removeAll()
                    self?.endpointNames.removeAll()
                    self?.connectionManager = nil
                    completion(firstError)
                }
            }
        }
    }

    private func permissionState() -> JSObject {
        return ["granted": true, "missing": JSArray()]
    }

    private func requiredString(_ call: CAPPluginCall, key: String) -> String? {
        guard let value = call.getString(key)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            call.reject("\(key) is required")
            return nil
        }
        return value
    }

    private func endpointObject(_ endpointID: EndpointID) -> JSObject {
        return [
            "endpointId": endpointID,
            "endpointName": endpointNames[endpointID] ?? "Nearby device"
        ]
    }

    private func emitError(operation: String, message: String) {
        notifyListeners("nearbyError", data: [
            "operation": operation,
            "message": message
        ])
    }
}

extension NearbyConnectionsPlugin: AdvertiserDelegate {
    public func advertiser(
        _ advertiser: Advertiser,
        didReceiveConnectionRequestFrom endpointID: EndpointID,
        with context: Data,
        connectionRequestHandler: @escaping (Bool) -> Void
    ) {
        endpointNames[endpointID] = String(data: context, encoding: .utf8) ?? "Nearby device"
        connectionRequestHandler(true)
    }
}

extension NearbyConnectionsPlugin: DiscovererDelegate {
    public func discoverer(
        _ discoverer: Discoverer,
        didFind endpointID: EndpointID,
        with context: Data
    ) {
        endpointNames[endpointID] = String(data: context, encoding: .utf8) ?? "Nearby device"
        notifyListeners("endpointFound", data: endpointObject(endpointID))
    }

    public func discoverer(_ discoverer: Discoverer, didLose endpointID: EndpointID) {
        endpointNames.removeValue(forKey: endpointID)
        notifyListeners("endpointLost", data: ["endpointId": endpointID])
    }
}

extension NearbyConnectionsPlugin: ConnectionManagerDelegate {
    public func connectionManager(
        _ connectionManager: ConnectionManager,
        didReceive verificationCode: String,
        from endpointID: EndpointID,
        verificationHandler: @escaping (Bool) -> Void
    ) {
        pendingVerification.removeValue(forKey: endpointID)?(false)
        pendingVerification[endpointID] = verificationHandler
        var event = endpointObject(endpointID)
        event["authenticationDigits"] = verificationCode
        event["incoming"] = !outgoingEndpoints.contains(endpointID)
        notifyListeners("connectionInitiated", data: event)
    }

    public func connectionManager(
        _ connectionManager: ConnectionManager,
        didReceive data: Data,
        withID payloadID: PayloadID,
        from endpointID: EndpointID
    ) {
        guard let text = String(data: data, encoding: .utf8) else {
            emitError(operation: "receive", message: "Nearby byte payload is not UTF-8")
            return
        }
        notifyListeners("message", data: [
            "endpointId": endpointID,
            "data": text
        ])
    }

    public func connectionManager(
        _ connectionManager: ConnectionManager,
        didReceive stream: InputStream,
        withID payloadID: PayloadID,
        from endpointID: EndpointID,
        cancellationToken token: CancellationToken
    ) {
        emitError(operation: "receive", message: "Only byte payloads are supported")
    }

    public func connectionManager(
        _ connectionManager: ConnectionManager,
        didStartReceivingResourceWithID payloadID: PayloadID,
        from endpointID: EndpointID,
        at localURL: URL,
        withName name: String,
        cancellationToken token: CancellationToken
    ) {
        emitError(operation: "receive", message: "Only byte payloads are supported")
    }

    public func connectionManager(
        _ connectionManager: ConnectionManager,
        didReceiveTransferUpdate update: TransferUpdate,
        from endpointID: EndpointID,
        forPayload payloadID: PayloadID
    ) {
        switch update {
        case .failure, .canceled:
            emitError(operation: "transfer", message: "Nearby payload transfer failed for \(endpointID)")
        case .success, .progress:
            break
        }
    }

    public func connectionManager(
        _ connectionManager: ConnectionManager,
        didChangeTo state: ConnectionState,
        for endpointID: EndpointID
    ) {
        switch state {
        case .connecting:
            return
        case .connected:
            connectedEndpoints.insert(endpointID)
            outgoingEndpoints.remove(endpointID)
            var event = endpointObject(endpointID)
            event["status"] = "connected"
            notifyListeners("connectionResult", data: event)
        case .rejected:
            pendingVerification.removeValue(forKey: endpointID)
            outgoingEndpoints.remove(endpointID)
            var event = endpointObject(endpointID)
            event["status"] = "rejected"
            notifyListeners("connectionResult", data: event)
        case .disconnected:
            pendingVerification.removeValue(forKey: endpointID)
            connectedEndpoints.remove(endpointID)
            outgoingEndpoints.remove(endpointID)
            notifyListeners("disconnected", data: ["endpointId": endpointID])
        }
    }
}