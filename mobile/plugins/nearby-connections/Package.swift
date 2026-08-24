// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "KandoraCapacitorNearbyConnections",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "KandoraCapacitorNearbyConnections",
            targets: ["KandoraCapacitorNearbyConnections"])
    ],
    dependencies: [
        .package(
            url: "https://github.com/ionic-team/capacitor-swift-pm.git",
            from: "8.0.0"),
        .package(
            url: "https://github.com/google/nearby.git",
            revision: "217eeb5f01362b7b1fb85b56e46a90676dbbb4ae")
    ],
    targets: [
        .target(
            name: "KandoraCapacitorNearbyConnections",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "NearbyConnections", package: "nearby")
            ],
            path: "ios/Sources/KandoraCapacitorNearbyConnections")
    ]
)