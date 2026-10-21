import AppKit
import SwiftUI
import SceneKit
import Combine
import simd

private struct MaterialData: Decodable {
    var color: [Float]?
    var roughness: Float?
    var metalness: Float?
    var emissive: [Float]?
    var opacity: Float?
    var transparent: Bool?
}
private struct GeometryData: Decodable {
    var id: String?
    var positions: [Float]
    var normals: [Float]?
    var uvs: [Float]?
    var indices: [Int]
}
private struct MeshData: Decodable {
    var geometryId: String?
    var positions: [Float]?
    var normals: [Float]?
    var uvs: [Float]?
    var indices: [Int]?
    var material: MaterialData
}
private struct NodeData: Decodable {
    var name: String?
    var visible: Bool?
    var position: [Float]?
    var rotation: [Float]?
    var scale: [Float]?
    var children: [NodeData]?
    var mesh: MeshData?
}
private struct PresetData: Decodable { var id: String; var name: String; var root: NodeData }
private struct PropsData: Decodable { var gift: NodeData?; var cookieWhole: NodeData?; var cookieBitten: NodeData? }
private struct TownData: Decodable { var version: Int; var root: NodeData; var presets: [PresetData]; var geometries: [GeometryData]?; var props: PropsData? }

private func vec(_ value: [Float]?, _ fallback: SCNVector3 = SCNVector3Zero) -> SCNVector3 {
    guard let value, value.count >= 3 else { return fallback }
    return SCNVector3(value[0], value[1], value[2])
}
private func color(_ v: [Float]?, alpha: CGFloat = 1) -> NSColor {
    guard let v, v.count >= 3 else { return NSColor.white }
    // Three exports linear RGB; NSColor's explicit sRGB initializer expects encoded values.
    func encode(_ x: Float) -> CGFloat { CGFloat(x <= 0.0031308 ? x * 12.92 : 1.055 * pow(x, 1 / 2.4) - 0.055) }
    return NSColor(srgbRed: encode(v[0]), green: encode(v[1]), blue: encode(v[2]), alpha: alpha)
}

private final class SharedMeshImporter {
    private(set) var meshCount = 0
    private(set) var triangleCount = 0
    private var materials: [String: SCNMaterial] = [:]
    private var geometries: [String: GeometryData] = [:]
    private var geometrySources: [String: SCNGeometry] = [:]
    init(geometries: [GeometryData] = []) { for geometry in geometries { if let id = geometry.id { self.geometries[id] = geometry } } }
    func node(_ source: NodeData) -> SCNNode {
        let result = SCNNode()
        result.name = source.name ?? "original-node"
        result.isHidden = source.visible == false
        result.position = vec(source.position)
        result.scale = vec(source.scale, SCNVector3(1, 1, 1))
        if let q = source.rotation, q.count == 4 { result.orientation = SCNQuaternion(q[0], q[1], q[2], q[3]) }
        if let mesh = source.mesh {
            let pool = mesh.geometryId.flatMap { geometries[$0] }
            let positions = mesh.positions ?? pool?.positions ?? []
            let normals = mesh.normals ?? pool?.normals
            let uvs = mesh.uvs ?? pool?.uvs
            let indices = mesh.indices ?? pool?.indices ?? []
            guard positions.count >= 9 else { return result }
            let geometry: SCNGeometry
            if let id = mesh.geometryId, let cached = geometrySources[id] {
                geometry = cached.copy() as! SCNGeometry
            } else {
                var sources = [SCNGeometrySource(vertices: stride(from: 0, to: positions.count - 2, by: 3).map {
                    SCNVector3(positions[$0], positions[$0 + 1], positions[$0 + 2])
                })]
                if let normals, normals.count == positions.count {
                    sources.append(SCNGeometrySource(normals: stride(from: 0, to: normals.count - 2, by: 3).map { SCNVector3(normals[$0], normals[$0 + 1], normals[$0 + 2]) }))
                }
                if let uv = uvs, uv.count == positions.count / 3 * 2 {
                    sources.append(SCNGeometrySource(textureCoordinates: stride(from: 0, to: uv.count - 1, by: 2).map { CGPoint(x: Double(uv[$0]), y: Double(uv[$0 + 1])) }))
                }
                geometry = SCNGeometry(sources: sources, elements: [SCNGeometryElement(indices: indices.map(UInt32.init), primitiveType: .triangles)])
                if let id = mesh.geometryId { geometrySources[id] = geometry }
            }
            let signature = "\(mesh.material.color ?? [])|\(mesh.material.roughness ?? 0.65)|\(mesh.material.metalness ?? 0)|\(mesh.material.emissive ?? [])|\(mesh.material.opacity ?? 1)|\(mesh.material.transparent ?? false)"
            let material = materials[signature] ?? SCNMaterial()
            material.lightingModel = .physicallyBased
            material.diffuse.contents = color(mesh.material.color)
            material.roughness.contents = NSNumber(value: mesh.material.roughness ?? 0.65)
            material.metalness.contents = NSNumber(value: mesh.material.metalness ?? 0)
            material.emission.contents = color(mesh.material.emissive ?? [0, 0, 0])
            material.transparency = 1
            result.opacity = CGFloat(mesh.material.opacity ?? 1)
            if mesh.material.transparent == true { material.transparencyMode = .aOne; material.blendMode = .alpha; material.writesToDepthBuffer = false }
            material.isDoubleSided = false
            materials[signature] = material
            geometry.materials = [material]
            result.geometry = geometry
            result.castsShadow = !(mesh.material.transparent ?? false)
            meshCount += 1; triangleCount += indices.count / 3
        }
        for child in source.children ?? [] { result.addChildNode(node(child)) }
        return result
    }
}

private struct RestPose {
    let node: SCNNode
    let position: SCNVector3
    let orientation: SCNQuaternion
    let scale: SCNVector3
    init(_ node: SCNNode) { self.node = node; position = node.position; orientation = node.orientation; scale = node.scale }
    func restore() { node.position = position; node.orientation = orientation; node.scale = scale }
}

final class OriginalTownModel: ObservableObject {
    let scene = SCNScene()
    let cameraNode = SCNNode()
    weak var view: SCNView?
    @Published var loadingError: String?
    @Published var selectedPreset = 0 { didSet { updatePreset() } }
    @Published var motion = "idle"
    @Published var timeOfDay = "day" { didSet { updateLighting() } }
    @Published var highQuality = true { didSet { updateQuality() } }
    @Published var height: Double = 1
    @Published var headWidth: Double = 1
    @Published var headSize: Double = 1
    @Published var bodyWidth: Double = 1
    @Published var cinematic = false
    @Published var presetNames: [String] = []
    @Published var meshSummary = "读取原创资产…"
    @Published var subtitle = "欢迎来到属于你的生活小镇。"
    @Published var paused = false
    private var presets: [SCNNode] = []
    private var partner: SCNNode?
    private var rest: [RestPose] = []
    private var primary = SCNNode()
    private let sunlight = SCNNode()
    private let ambient = SCNNode()
    private var lampNodes: [SCNNode] = []
    private var lampBulbs: [SCNMaterial] = []
    private var fountainSurface: SCNNode?
    private var fountainRipples: SCNNode?
    private var fountainDrops: SCNNode?
    private var timer: Timer?
    private var start = Date.timeIntervalSinceReferenceDate
    private var animationTime: Double = 0
    private var previousTick = Date.timeIntervalSinceReferenceDate
    private var interactionTime: Double?
    private var qaStage = -1
    private var qaReport: [String: Any] = [:]
    private var gift: SCNNode?
    private var cookieWhole: SCNNode?
    private var cookieBitten: SCNNode?
    private var actionStarted: Double = 0

    init() {
        setupScene()
        do {
            guard let url = Bundle.main.url(forResource: "OriginalTown", withExtension: "json") else {
                throw NSError(domain: "OriginalTown", code: 1, userInfo: [NSLocalizedDescriptionKey: "缺少同源场景文件 OriginalTown.json，请先运行导出和构建脚本。"])
            }
            let data = try JSONDecoder().decode(TownData.self, from: Data(contentsOf: url))
            guard data.version == 1, !data.presets.isEmpty else { throw NSError(domain: "OriginalTown", code: 2, userInfo: [NSLocalizedDescriptionKey: "原创资产版本或角色列表不正确。"])}
            let importer = SharedMeshImporter(geometries: data.geometries ?? [])
            let town = importer.node(data.root)
            town.isHidden = false
            scene.rootNode.addChildNode(town)
            configureTown(town)
            for preset in data.presets {
                let node = importer.node(preset.root)
                node.position = SCNVector3(-1.55, 0, 3.0)
                node.isHidden = true
                scene.rootNode.addChildNode(node)
                presets.append(node)
                presetNames.append(preset.name)
            }
            let companion = importer.node(data.presets[min(1, data.presets.count - 1)].root)
            companion.isHidden = false
            companion.position = SCNVector3(1.5, 0, 2.8)
            companion.eulerAngles.y = -0.18
            scene.rootNode.addChildNode(companion)
            partner = companion
            meshSummary = "同源原创资产 · \(importer.meshCount) 个网格"
            qaReport = ["assetVersion": data.version, "presetCount": data.presets.count, "meshCount": importer.meshCount, "triangleCount": importer.triangleCount, "sameSource": "OriginalTown.json"]
            if let props = data.props {
                gift = props.gift.map { importer.node($0) }
                cookieWhole = props.cookieWhole.map { importer.node($0) }
                cookieBitten = props.cookieBitten.map { importer.node($0) }
            }
            updatePreset()
            updateLighting()
            focus("residents", animated: false)
        } catch { loadingError = error.localizedDescription }
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in self?.tick() }
    }

    deinit { timer?.invalidate() }

    private func setupScene() {
        scene.background.contents = NSColor(srgbRed: 0.84, green: 0.87, blue: 0.84, alpha: 1)
        cameraNode.name = "original-preview-camera"
        let camera = SCNCamera()
        camera.fieldOfView = 36
        camera.zNear = 0.1; camera.zFar = 180
        camera.wantsHDR = true
        camera.wantsExposureAdaptation = false
        camera.exposureOffset = -0.05
        camera.averageGray = 0.18
        camera.whitePoint = 1.1
        camera.bloomIntensity = 0.13
        camera.bloomThreshold = 1.1
        camera.bloomBlurRadius = 5
        camera.screenSpaceAmbientOcclusionIntensity = 0.75
        camera.screenSpaceAmbientOcclusionRadius = 0.25
        cameraNode.camera = camera
        scene.rootNode.addChildNode(cameraNode)
        sunlight.name = "original-key-light"
        sunlight.light = SCNLight()
        sunlight.light?.type = .directional
        sunlight.light?.castsShadow = true
        sunlight.light?.shadowMode = .deferred
        sunlight.light?.shadowMapSize = CGSize(width: 2048, height: 2048)
        sunlight.light?.shadowRadius = 5
        sunlight.light?.shadowSampleCount = 16
        sunlight.light?.orthographicScale = 24
        sunlight.light?.zNear = 1; sunlight.light?.zFar = 70
        sunlight.light?.shadowColor = NSColor(white: 0, alpha: 0.19)
        sunlight.position = SCNVector3(-9, 18, 9)
        sunlight.look(at: SCNVector3Zero)
        scene.rootNode.addChildNode(sunlight)
        ambient.light = SCNLight(); ambient.light?.type = .ambient
        scene.rootNode.addChildNode(ambient)
    }

    private func configureTown(_ town: SCNNode) {
        town.enumerateChildNodes { node, _ in
            if node.name == "original-street-lamp" {
                let light = SCNNode(); light.position = SCNVector3(0, 3.78, 0); light.light = SCNLight()
                light.light?.type = .omni
                light.light?.color = NSColor(srgbRed: 1, green: 0.76, blue: 0.5, alpha: 1)
                light.light?.attenuationStartDistance = 0.5; light.light?.attenuationEndDistance = 7
                node.addChildNode(light); self.lampNodes.append(light)
                if let bulb = node.childNodes.first(where: { abs($0.position.y - 3.95) < 0.01 }), let material = bulb.geometry?.firstMaterial {
                    self.lampBulbs.append(material)
                }
            }
            if node.name == "original-wish-fountain" {
                self.fountainSurface = node.childNodes.first(where: { abs($0.position.y - 0.559) < 0.005 && $0.geometry != nil })
                self.fountainRipples = node.childNodes.first(where: { $0.childNodes.count == 4 && abs($0.position.y - 0.567) < 0.005 })
                self.fountainDrops = node.childNodes.first(where: { $0.childNodes.count == 12 })
            }
        }
    }

    func attach(_ view: SCNView) {
        self.view = view
        view.pointOfView = cameraNode
        view.defaultCameraController.target = SCNVector3(0, 1.6, 2.5)
        view.defaultCameraController.interactionMode = .orbitTurntable
        view.defaultCameraController.inertiaEnabled = true
        view.defaultCameraController.minimumVerticalAngle = 5
        view.defaultCameraController.maximumVerticalAngle = 85
        updateQuality()
    }

    func focus(_ kind: String, animated: Bool = true) {
        view?.defaultCameraController.stopInertia()
        let target: SCNVector3
        let position: SCNVector3
        switch kind {
        case "face": target = SCNVector3(-1.55, 2.12, 3); position = SCNVector3(-1.55, 2.5, 7.35)
        case "town": target = SCNVector3(0, 1.6, -1); position = SCNVector3(15, 12, 21)
        default: target = SCNVector3(0, 1.6, 2.8); position = SCNVector3(2.0, 4.2, 13.2)
        }
        view?.pointOfView = cameraNode
        view?.defaultCameraController.target = target
        SCNTransaction.begin()
        SCNTransaction.animationDuration = animated ? 0.7 : 0
        cameraNode.position = position; cameraNode.look(at: target, up: SCNVector3(0, 1, 0), localFront: SCNVector3(0, 0, -1))
        SCNTransaction.commit()
    }

    private func updatePreset() {
        for pose in rest { pose.restore() }
        guard presets.indices.contains(selectedPreset) else { return }
        for (i, preset) in presets.enumerated() { preset.isHidden = i != selectedPreset }
        primary = presets[selectedPreset]
        rest = []
        func record(_ node: SCNNode) { rest.append(RestPose(node)); for child in node.childNodes { record(child) } }
        record(primary)
        height = 1; headWidth = 1; headSize = 1; bodyWidth = 1
        if let body = primary.childNode(withName: "orig-root", recursively: true) {
            for prop in [gift, cookieWhole, cookieBitten].compactMap({ $0 }) {
                prop.removeFromParentNode(); body.addChildNode(prop); prop.isHidden = true
            }
        }
        subtitle = "\(presetNames[selectedPreset])搬来小镇了。试着换一种神情和动作。"
    }

    private func updateLighting() {
        SCNTransaction.begin(); SCNTransaction.animationDuration = 0.6
        if timeOfDay == "night" {
            scene.background.contents = NSColor(srgbRed: 0.13, green: 0.19, blue: 0.27, alpha: 1)
            ambient.light?.color = NSColor(srgbRed: 0.53, green: 0.65, blue: 0.86, alpha: 1)
            ambient.light?.intensity = 320
            sunlight.light?.color = NSColor(srgbRed: 0.62, green: 0.72, blue: 1, alpha: 1)
            sunlight.light?.intensity = 550
            lampNodes.forEach { $0.light?.intensity = highQuality ? 50 : 25 }
        } else if timeOfDay == "sunset" {
            scene.background.contents = NSColor(srgbRed: 0.9, green: 0.76, blue: 0.67, alpha: 1)
            ambient.light?.color = NSColor(srgbRed: 0.83, green: 0.75, blue: 0.72, alpha: 1)
            ambient.light?.intensity = 510
            sunlight.light?.color = NSColor(srgbRed: 1, green: 0.72, blue: 0.48, alpha: 1)
            sunlight.light?.intensity = 1100
            lampNodes.forEach { $0.light?.intensity = 25 }
        } else {
            scene.background.contents = NSColor(srgbRed: 0.83, green: 0.87, blue: 0.84, alpha: 1)
            ambient.light?.color = NSColor(srgbRed: 0.86, green: 0.89, blue: 0.86, alpha: 1)
            ambient.light?.intensity = 640
            sunlight.light?.color = NSColor(srgbRed: 1, green: 0.91, blue: 0.77, alpha: 1)
            sunlight.light?.intensity = 1050
            lampNodes.forEach { $0.light?.intensity = 0 }
        }
        for bulb in lampBulbs {
            bulb.emission.contents = NSColor(srgbRed: 1, green: 0.76, blue: 0.46, alpha: 1)
            bulb.emission.intensity = timeOfDay == "night" ? 0.65 : timeOfDay == "sunset" ? 0.18 : 0
        }
        SCNTransaction.commit()
    }

    private func updateQuality() {
        view?.antialiasingMode = highQuality ? .multisampling4X : .none
        view?.preferredFramesPerSecond = highQuality ? 60 : 30
        cameraNode.camera?.screenSpaceAmbientOcclusionIntensity = highQuality ? 0.75 : 0
        cameraNode.camera?.bloomIntensity = highQuality ? 0.13 : 0
        sunlight.light?.castsShadow = highQuality
        updateLighting()
    }

    func perform(_ action: String) {
        motion = action; actionStarted = animationTime; interactionTime = nil
        let messages = ["idle": "让生活慢下来，看看身边的小事。", "wave": "嗨，很高兴在这里遇见你。", "walk": "一起去广场走走吧。", "talk": "今天想聊点什么？", "receive": "这是送给我的吗？谢谢你。", "eat": "慢慢吃，今天也要好好照顾自己。", "happy": "这真是美好的一天！"]
        subtitle = messages[action] ?? ""
    }

    func meet() {
        interactionTime = animationTime
        subtitle = "先看向对方，再开口打招呼。"
        motion = "wave"
        focus("residents")
    }

    private func tick() {
        let now = Date.timeIntervalSinceReferenceDate
        let dt = min(0.05, now - previousTick); previousTick = now
        if !paused { animationTime += dt }
        guard !presets.isEmpty else { runQA(now - start); return }
        let t = animationTime
        SCNTransaction.begin(); SCNTransaction.disableActions = true
        fountainSurface?.position.y = 0.559 + CGFloat(sin(t * 1.4) * 0.004)
        fountainDrops?.isHidden = !highQuality
        for (index, ripple) in (fountainRipples?.childNodes ?? []).enumerated() {
            let phase = (t * 0.28 + Double(index) * 0.25).truncatingRemainder(dividingBy: 1)
            let scale = 0.25 + phase * 0.8
            ripple.scale = SCNVector3(scale, scale, scale); ripple.opacity = (1 - phase) * 0.24
        }
        for (index, drop) in (fountainDrops?.childNodes ?? []).enumerated() {
            let phase = (t * 0.74 + Double(index) * 0.17).truncatingRemainder(dividingBy: 1)
            let angle = Double(index / 3) * .pi / 2 + 0.18
            let radius = 0.08 + 1.05 * phase, scale = 0.024 + 0.017 * sin(phase * .pi)
            drop.position = SCNVector3(cos(angle) * radius, 1.86 + 1.45 * phase - 2.75 * phase * phase, sin(angle) * radius)
            drop.scale = SCNVector3(scale, scale, scale)
        }
        for pose in rest { pose.restore() }
        primary.scale = SCNVector3(1, Float(height), 1)
        if let body = primary.childNode(withName: "orig-root", recursively: true) {
            for part in body.childNodes where part.name != "orig-head" {
                part.scale.x *= CGFloat(bodyWidth)
                part.position.x *= CGFloat(bodyWidth)
            }
        }
        let head = primary.childNode(withName: "orig-head", recursively: true)
        if let head {
            let scale = head.scale
            head.scale = SCNVector3(scale.x * CGFloat(headWidth * headSize), scale.y * CGFloat(headSize), scale.z * CGFloat(headSize))
        }
        primary.position.y = CGFloat(sin(t * 2.2) * 0.009)
        func rotate(_ name: String, _ x: Float = 0, _ y: Float = 0, _ z: Float = 0) {
            guard let node = primary.childNode(withName: name, recursively: true) else { return }
            node.eulerAngles.x += CGFloat(x); node.eulerAngles.y += CGFloat(y); node.eulerAngles.z += CGFloat(z)
        }
        switch motion {
        case "wave": rotate("orig-arm-right", -0.25, 0, -1.25 + Float(sin(t * 7)) * 0.13); rotate("orig-forearm-right", -1.3); rotate("orig-head", 0, 0, 0.07)
        case "walk":
            let stride = Float(sin(t * 6)) * 0.34
            rotate("orig-leg-left", stride); rotate("orig-leg-right", -stride)
            rotate("orig-arm-left", -stride * 0.6); rotate("orig-arm-right", stride * 0.6)
            primary.position.y += CGFloat(abs(sin(t * 6)) * 0.04)
        case "talk": rotate("orig-head", Float(sin(t * 3)) * 0.035, Float(sin(t * 1.7)) * 0.06); rotate("orig-arm-right", -0.19, 0, -0.12); rotate("orig-forearm-right", -0.34)
        case "receive": rotate("orig-arm-left", -0.68, 0, 0.22); rotate("orig-arm-right", -0.68, 0, -0.22); rotate("orig-forearm-left", -0.5); rotate("orig-forearm-right", -0.5)
        case "eat": rotate("orig-arm-right", -0.85, 0, -0.13); rotate("orig-forearm-right", -0.7 + Float(sin(t * 2.5)) * 0.15); rotate("orig-head", 0.06)
        case "happy":
            rotate("orig-arm-left", 0, 0, 0.42); rotate("orig-arm-right", 0, 0, -0.42); rotate("orig-forearm-left", -0.85); rotate("orig-forearm-right", -0.85)
            primary.position.y += CGFloat(max(0, sin(t * 4)) * 0.08)
        default: rotate("orig-head", 0, Float(sin(t * 0.8)) * 0.035)
        }
        animateFace(primary, time: t, speaking: motion == "talk", cheerful: motion == "happy")
        animateProps(time: t - actionStarted)
        if let partner { animateFace(partner, time: t + 1.3, speaking: interactionTime != nil && t - (interactionTime ?? t) > 2, cheerful: false) }
        if let meeting = interactionTime {
            let elapsed = t - meeting
            primary.eulerAngles.y = 0.22
            partner?.eulerAngles.y = -0.22
            if elapsed > 2 && elapsed < 2.05 { motion = "talk"; subtitle = "“下次也一起在喷泉边坐坐吧。”" }
            if elapsed > 5.5 { motion = "happy"; interactionTime = nil; subtitle = "一次温暖的相遇。你们都记住了今天的笑容。" }
        }
        SCNTransaction.commit()
        runQA(now - start)
    }

    private func reach(side: Float, target: SCNVector3) {
        let sideName = side > 0 ? "left" : "right"
        guard let body = primary.childNode(withName: "orig-root", recursively: true),
              let arm = primary.childNode(withName: "orig-arm-\(sideName)", recursively: true),
              let forearm = primary.childNode(withName: "orig-forearm-\(sideName)", recursively: true),
              let hand = primary.childNode(withName: "orig-hand-\(sideName)", recursively: true),
              let parent = arm.parent else { return }
        let targetPoint = parent.convertPosition(target, from: body)
        let shoulder = arm.simdPosition
        let goal = SIMD3<Float>(Float(targetPoint.x), Float(targetPoint.y), Float(targetPoint.z))
        let delta = goal - shoulder
        let length1 = Float(abs(forearm.position.y))
        let length2 = Float(abs(hand.parent?.position.y ?? -0.37))
        let distance = min(simd_length(delta), length1 + length2 - 0.004)
        guard distance > 0.001 else { return }
        let direction = simd_normalize(delta)
        let projection = (length1 * length1 - length2 * length2 + distance * distance) / (2 * distance)
        let rise = sqrt(max(0, length1 * length1 - projection * projection))
        var pole = SIMD3<Float>(side, -0.38, 0.05)
        pole = simd_normalize(pole - direction * simd_dot(direction, pole))
        let elbow = shoulder + direction * projection + pole * rise
        let upper = simd_quatf(from: SIMD3<Float>(0, -1, 0), to: simd_normalize(elbow - shoulder))
        let lower = simd_quatf(from: SIMD3<Float>(0, -1, 0), to: simd_normalize(goal - elbow))
        arm.simdOrientation = upper
        forearm.simdOrientation = upper.inverse * lower
    }

    private func animateProps(time: Double) {
        gift?.isHidden = motion != "receive"
        cookieWhole?.isHidden = true; cookieBitten?.isHidden = true
        guard let body = primary.childNode(withName: "orig-root", recursively: true),
              let leg = primary.childNode(withName: "orig-leg-right", recursively: true) else { return }
        let hip = leg.position.y
        if motion == "receive" {
            reach(side: -1, target: SCNVector3(-0.225, hip + 0.35, 0.36))
            reach(side: 1, target: SCNVector3(0.225, hip + 0.35, 0.36))
            gift?.position = SCNVector3(0, hip + 0.35, 0.425)
            gift?.orientation = SCNQuaternion(0, 0, 0, 1)
        } else if motion == "eat", let mouth = primary.childNode(withName: "orig-mouth", recursively: true) {
            let cycle = time.truncatingRemainder(dividingBy: 6.8)
            let lift = cycle < 0.9 ? cycle / 0.9 : cycle < 2.1 ? 1 : cycle < 3.2 ? 1 - (cycle - 2.1) / 1.1 : 0
            let eased = lift * lift * (3 - 2 * lift)
            let mouthPoint = body.convertPosition(SCNVector3Zero, from: mouth)
            let wrist = SCNVector3(-0.22 + eased * 0.165, Double(hip + 0.3) * (1 - eased) + Double(mouthPoint.y - 0.115) * eased, 0.38 + eased * 0.055)
            reach(side: -1, target: wrist)
            let prop = cycle < 1.65 ? cookieWhole : cookieBitten
            prop?.isHidden = cycle >= 5.2
            prop?.position = SCNVector3(wrist.x + 0.03, wrist.y + 0.065, wrist.z + 0.042)
            prop?.orientation = SCNQuaternion(0, 0, 0, 1)
            prop?.scale = cycle > 3.4 ? SCNVector3(0.79, 0.79, 0.79) : SCNVector3(1, 1, 1)
        }
    }

    private func animateFace(_ resident: SCNNode, time: Double, speaking: Bool, cheerful: Bool) {
        let cycle = time.truncatingRemainder(dividingBy: 4.7)
        let blink = cycle > 4.42 ? sin((cycle - 4.42) / 0.28 * .pi) : 0
        for side in ["left", "right"] {
            if let eye = resident.childNode(withName: "orig-eye-\(side)", recursively: true), let lid = eye.childNodes.first {
                lid.scale.y = CGFloat(max(0.035, 1 - blink * 0.965))
            }
        }
        if let mouth = resident.childNode(withName: "orig-mouth", recursively: true), mouth.childNodes.count >= 2 {
            let amount = speaking ? (0.2 + abs(sin(time * 9.1)) * 0.58) * (sin(time * 2.3) > -0.65 ? 1 : 0.08) : cheerful ? 0.25 : 0
            mouth.childNodes[0].isHidden = amount > 0.09
            mouth.childNodes[1].isHidden = amount <= 0.09
            mouth.childNodes[1].scale.y = CGFloat(0.2 + amount * 0.85)
        }
    }

    private func runQA(_ elapsed: Double) {
        guard let folder = ProcessInfo.processInfo.environment["LINGOLIFE_NATIVE_QA_DIR"], let view else { return }
        let stage = elapsed < 3 ? -1 : elapsed < 6 ? 0 : elapsed < 9 ? 1 : elapsed < 12 ? 2 : elapsed < 15 ? 3 : elapsed < 18 ? 4 : elapsed < 21 ? 5 : 6
        guard stage > qaStage else { return }; qaStage = stage
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        func snapshot(_ name: String) {
            guard let tiff = view.snapshot().tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) else { return }
            try? png.write(to: URL(fileURLWithPath: folder).appendingPathComponent(name))
        }
        switch stage {
        case 0:
            snapshot("native-residents-day.png")
            qaReport["initialPrimaryBounds"] = "\(primary.boundingBox)"
            height = 1.12; headWidth = 1.13; headSize = 1.06
            perform("wave"); focus("face", animated: false)
        case 1:
            snapshot("native-character-customized.png")
            qaReport["heightChanged"] = abs(primary.scale.y - 1.12) < 0.001
            qaReport["headWidthChanged"] = (primary.childNode(withName: "orig-head", recursively: true)?.scale.x ?? 1) > 1.1
            qaReport["waveJointExists"] = primary.childNode(withName: "orig-arm-right", recursively: true) != nil
            selectedPreset = min(2, presets.count - 1); timeOfDay = "night"; focus("town", animated: false)
        case 2:
            snapshot("native-town-night.png")
            qaReport["presetSwitch"] = selectedPreset == min(2, presets.count - 1)
            highQuality = false; timeOfDay = "sunset"; perform("happy")
        case 3:
            snapshot("native-town-sunset-low.png")
            qaReport["lowQualityDisablesShadows"] = sunlight.light?.castsShadow == false
            highQuality = true; timeOfDay = "day"; perform("receive"); focus("residents", animated: false)
        case 4:
            snapshot("native-receive-shared-gift.png")
            qaReport["sharedGiftVisible"] = gift?.isHidden == false
            if let hand = primary.childNode(withName: "orig-hand-right", recursively: true),
               let body = primary.childNode(withName: "orig-root", recursively: true),
               let leg = primary.childNode(withName: "orig-leg-right", recursively: true) {
                let p = body.convertPosition(SCNVector3Zero, from: hand)
                let delta = SIMD3<Float>(Float(p.x + 0.225), Float(p.y - leg.position.y - 0.35), Float(p.z - 0.36))
                qaReport["giftHandDistance"] = simd_length(delta)
                qaReport["giftHandContact"] = simd_length(delta) < 0.12
            }
            perform("eat"); focus("face", animated: false)
        case 5:
            snapshot("native-eat-shared-cookie.png")
            qaReport["sharedCookieVisible"] = cookieBitten?.isHidden == false
            qaReport["loadingError"] = loadingError ?? NSNull()
            let checks = ["heightChanged", "headWidthChanged", "waveJointExists", "presetSwitch", "lowQualityDisablesShadows", "sharedGiftVisible", "giftHandContact", "sharedCookieVisible"]
            qaReport["status"] = loadingError == nil && checks.allSatisfy { qaReport[$0] as? Bool == true } ? "passed" : "failed"
            if let data = try? JSONSerialization.data(withJSONObject: qaReport, options: [.prettyPrinted, .sortedKeys]) { try? data.write(to: URL(fileURLWithPath: folder).appendingPathComponent("report.json")) }
        case 6: NSApplication.shared.terminate(nil)
        default: break
        }
    }
}

private struct OriginalSceneView: NSViewRepresentable {
    @ObservedObject var model: OriginalTownModel
    func makeNSView(context: Context) -> SCNView {
        let view = SCNView(frame: .zero, options: [SCNView.Option.preferredRenderingAPI.rawValue: SCNRenderingAPI.metal.rawValue])
        view.scene = model.scene
        view.allowsCameraControl = true
        view.rendersContinuously = true
        view.backgroundColor = NSColor(srgbRed: 0.84, green: 0.87, blue: 0.84, alpha: 1)
        model.attach(view)
        return view
    }
    func updateNSView(_ nsView: SCNView, context: Context) {}
}

private let ink = Color(red: 0.22, green: 0.28, blue: 0.25)
private let sage = Color(red: 0.38, green: 0.51, blue: 0.43)
private let paper = Color(red: 0.98, green: 0.97, blue: 0.93)

private struct OriginalPreviewView: View {
    @StateObject private var model = OriginalTownModel()
    private let motions = [("idle", "自在"), ("wave", "招呼"), ("walk", "散步"), ("talk", "聊天"), ("receive", "接礼物"), ("eat", "品尝"), ("happy", "开心")]
    var body: some View {
        ZStack {
            OriginalSceneView(model: model).ignoresSafeArea()
            VStack(spacing: 18) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("LingoLife").font(.system(size: 30, weight: .semibold, design: .rounded)).tracking(-1)
                        Text("原创生活小镇 · 原生视觉样板").font(.system(size: 12, weight: .medium)).foregroundStyle(ink.opacity(0.7))
                    }
                    Spacer()
                    HStack(spacing: 7) {
                        ForEach([("day", "晴日"), ("sunset", "黄昏"), ("night", "夜晚")], id: \.0) { key, label in
                            Button(label) { model.timeOfDay = key }.buttonStyle(PillButton(active: model.timeOfDay == key))
                        }
                        Divider().frame(height: 18)
                        Button(model.highQuality ? "精致画质" : "轻盈画质") { model.highQuality.toggle() }.buttonStyle(PillButton(active: false))
                    }.padding(8).background(paper.opacity(0.95), in: Capsule())
                }
                HStack(alignment: .top) {
                    if !model.cinematic {
                        VStack(alignment: .leading, spacing: 19) {
                            VStack(alignment: .leading, spacing: 5) {
                                Text("遇见不同的自己").font(.system(size: 19, weight: .semibold))
                                Text("同一套原创角色，细调你的模样。")
                                    .font(.system(size: 11)).foregroundStyle(ink.opacity(0.65))
                            }
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                                ForEach(Array(model.presetNames.enumerated()), id: \.offset) { index, name in
                                    Button(name) { model.selectedPreset = index }.buttonStyle(PillButton(active: model.selectedPreset == index))
                                }
                            }
                            Divider().overlay(sage.opacity(0.15))
                            adjustment("身高", value: $model.height, range: 0.84...1.16)
                            adjustment("脸部宽度", value: $model.headWidth, range: 0.83...1.17)
                            adjustment("头身比例", value: $model.headSize, range: 0.88...1.12)
                            adjustment("身形饱满", value: $model.bodyWidth, range: 0.82...1.18)
                            Button("恢复这个角色的比例") { model.height = 1; model.headWidth = 1; model.headSize = 1; model.bodyWidth = 1 }
                                .font(.system(size: 11)).buttonStyle(.plain).foregroundStyle(sage)
                            Divider()
                            Text("拖动旋转 · 滚轮缩放\n此页是独立样板，探索不改动居民存档。")
                                .font(.system(size: 10)).lineSpacing(4).foregroundStyle(ink.opacity(0.58))
                        }.padding(23).frame(width: 232).background(paper.opacity(0.96), in: RoundedRectangle(cornerRadius: 25))
                            .shadow(color: Color.black.opacity(0.045), radius: 18, y: 8)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 8) {
                        Button("人物近景") { model.focus("face") }.buttonStyle(PillButton(active: false))
                        Button("两人相遇") { model.meet() }.buttonStyle(PillButton(active: false))
                        Button("小镇全景") { model.focus("town") }.buttonStyle(PillButton(active: false))
                        Button(model.cinematic ? "显示调节" : "安静观赏") { model.cinematic.toggle() }.buttonStyle(PillButton(active: false))
                    }
                }
                Spacer(minLength: 0)
                VStack(spacing: 14) {
                    if let error = model.loadingError {
                        Text(error).font(.system(size: 14)).foregroundStyle(Color.red).padding().background(paper, in: RoundedRectangle(cornerRadius: 12))
                    } else {
                        Text(model.subtitle).font(.system(size: 14, weight: .medium)).padding(.horizontal, 25).padding(.vertical, 12)
                            .background(paper.opacity(0.95), in: Capsule())
                    }
                    HStack(spacing: 7) {
                        Text("此刻的心情").font(.system(size: 11)).foregroundStyle(ink.opacity(0.55)).padding(.horizontal, 8)
                        ForEach(motions, id: \.0) { id, label in
                            Button(label) { model.perform(id) }.buttonStyle(PillButton(active: model.motion == id))
                        }
                        Button(model.paused ? "继续" : "暂停") { model.paused.toggle() }.buttonStyle(PillButton(active: model.paused))
                    }.padding(8).background(paper.opacity(0.96), in: Capsule())
                }
            }.padding(28)
        }.foregroundStyle(ink).tint(sage).frame(minWidth: 1060, minHeight: 740)
    }
    private func adjustment(_ title: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        VStack(spacing: 6) {
            HStack { Text(title).font(.system(size: 12, weight: .medium)); Spacer(); Text("\(Int(value.wrappedValue * 100))%").font(.system(size: 10, design: .monospaced)).foregroundStyle(ink.opacity(0.45)) }
            Slider(value: value, in: range).controlSize(.small)
        }
    }
}

private struct PillButton: ButtonStyle {
    var active: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 14).padding(.vertical, 10)
            .foregroundStyle(active ? Color.white : ink)
            .background(active ? sage : paper.opacity(configuration.isPressed ? 0.65 : 0.98), in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

final class PreviewAppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow?
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1380, height: 920), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "LingoLife · 原创生活小镇"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: OriginalPreviewView())
        window.center(); window.makeKeyAndOrderFront(nil)
        if let path = ProcessInfo.processInfo.environment["LINGOLIFE_NATIVE_WINDOW_ID_FILE"] {
            try? String(window.windowNumber).write(toFile: path, atomically: true, encoding: .utf8)
        }
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
        let main = NSMenu(); let item = NSMenuItem(); main.addItem(item)
        let appMenu = NSMenu(); appMenu.addItem(withTitle: "退出 LingoLife", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.submenu = appMenu; NSApp.mainMenu = main
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main
struct OriginalTownApp {
    static func main() {
        let application = NSApplication.shared
        let delegate = PreviewAppDelegate()
        application.delegate = delegate
        application.run()
        withExtendedLifetime(delegate) {}
    }
}
