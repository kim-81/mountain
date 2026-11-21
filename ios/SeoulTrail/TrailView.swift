import SwiftUI
import WebKit
import CoreLocation
import UserNotifications
import Security

struct TrailView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(context.coordinator, name: "trail")
        let view = WKWebView(frame: .zero, configuration: config)
        context.coordinator.web = view
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0.97, green: 0.96, blue: 0.94, alpha: 1)
        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        return view
    }
    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, CLLocationManagerDelegate {
        weak var web: WKWebView?
        private let manager = CLLocationManager()
        private var pending = "locate"
        private var recording = false
        private var requested = false
        private var ready = false
        private var points: [[String: Any]] = []
        private var routeSegments: [[[String: Double]]] = []
        private var alertsEnabled = false
        private var resumeRequested = false
        private var outsideCount = 0
        private var lastAlertAt: TimeInterval = 0
        private let serverAPI = NativeServerAPI()
        override init() {
            super.init()
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyBest
            manager.distanceFilter = 3
            if let data = UserDefaults.standard.data(forKey: "pendingGPS"),
               let saved = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] { points = saved }
            NotificationCenter.default.addObserver(self, selector: #selector(resume), name: UIApplication.didBecomeActiveNotification, object: nil)
        }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
                  let string = message.body as? String, let data = string.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let action = object["action"] as? String else { return }
            switch action {
            case "api": serverAPI.request(object) { [weak self] result in
                guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
                DispatchQueue.main.async { self?.web?.evaluateJavaScript("window.onTrailAPI?.(\(json))", completionHandler: nil) }
            }
            case "export":
                guard let content = object["content"] as? String, content.utf8.count <= 16 * 1024 * 1024 else {
                    error("기록이 너무 큽니다. 이전 기록을 정리해 주세요."); return
                }
                let filename = (object["filename"] as? String ?? "sangil-ttara-records.json")
                guard filename.range(of: "^[a-zA-Z0-9._-]+\\.(json|gpx)$", options: .regularExpression) != nil else { return }
                do {
                    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    let file = directory.appendingPathComponent(filename)
                    try content.write(to: file, atomically: true, encoding: .utf8)
                    guard var presenter = web?.window?.rootViewController else { try? FileManager.default.removeItem(at: directory); return }
                    while let presented = presenter.presentedViewController { presenter = presented }
                    let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                    share.popoverPresentationController?.sourceView = web
                    share.popoverPresentationController?.sourceRect = web?.bounds ?? .zero
                    share.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: directory) }
                    presenter.present(share, animated: true)
                } catch { self.error("기록 파일을 준비하지 못했습니다.") }
            case "ready": ready = true; flush()
            case "replay-gps":
                guard let id = object["sessionId"] as? String,
                      let data = try? JSONSerialization.data(withJSONObject: [points, id]),
                      let json = String(data: data, encoding: .utf8) else { return }
                web?.evaluateJavaScript("window.onTrailRecovery?.(...\(json))", completionHandler: nil)
            case "start", "locate":
                requested = true
                pending = action
                if action == "start" {
                    resumeRequested = object["resume"] as? Bool ?? false
                    routeSegments = object["routeSegments"] as? [[[String: Double]]] ?? []
                    alertsEnabled = object["alertsEnabled"] as? Bool ?? false
                    outsideCount = 0
                    lastAlertAt = 0
                    if alertsEnabled { UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in } }
                }
                if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
                else { begin() }
            case "stop": manager.stopUpdatingLocation(); manager.allowsBackgroundLocationUpdates = false; recording = false
            default: break
            }
        }
        private func begin() {
            guard requested else { return }
            guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else {
                error("위치 권한이 필요합니다. 설정에서 산길따라의 위치 권한을 확인해 주세요."); return
            }
            if pending == "start" {
                if !resumeRequested {
                    points.removeAll()
                    UserDefaults.standard.removeObject(forKey: "pendingGPS")
                }
                recording = true
                pending = "running"
                manager.allowsBackgroundLocationUpdates = true
                manager.showsBackgroundLocationIndicator = true
                manager.pausesLocationUpdatesAutomatically = false
                manager.startUpdatingLocation()
                flush()
            } else if !recording { manager.requestLocation() }
        }
        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            if manager.authorizationStatus != .notDetermined { begin() }
        }
        func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
            let recent = locations.filter { $0.horizontalAccuracy >= 0 && abs($0.timestamp.timeIntervalSinceNow) < 60 }
            let updates: [[String: Any]] = recent.map { location in
                ["lat": location.coordinate.latitude, "lng": location.coordinate.longitude, "accuracy": location.horizontalAccuracy, "time": location.timestamp.timeIntervalSince1970 * 1000]
            }
            guard recording else { sendLocations(updates); return }
            points.append(contentsOf: updates)
            recent.forEach { checkDeviation($0) }
            // 웹 화면이 일시 정지되어도 원시 GPS 지점을 기기에 남깁니다.
            if let data = try? JSONSerialization.data(withJSONObject: points) { UserDefaults.standard.set(data, forKey: "pendingGPS") }
            flush()
        }
        private func flush() {
            sendLocations(points)
        }
        private func sendLocations(_ updates: [[String: Any]]) {
            guard ready, !updates.isEmpty, let data = try? JSONSerialization.data(withJSONObject: updates), let json = String(data: data, encoding: .utf8) else { return }
            web?.evaluateJavaScript("window.onTrailLocations?.(\(json))", completionHandler: nil)
        }
        @objc private func resume() { flush() }
        private func checkDeviation(_ fix: CLLocation) {
            guard alertsEnabled, fix.horizontalAccuracy <= 80 else { outsideCount = 0; return }
            let scale = Double.pi / 180 * 6371000
            let cosLat = cos(fix.coordinate.latitude * Double.pi / 180)
            var nearest = Double.infinity
            for segment in routeSegments where segment.count >= 2 {
                for index in 1..<segment.count {
                    guard let aLat = segment[index - 1]["lat"], let aLng = segment[index - 1]["lng"],
                          let bLat = segment[index]["lat"], let bLng = segment[index]["lng"] else { continue }
                    let ax = (aLng - fix.coordinate.longitude) * cosLat * scale
                    let ay = (aLat - fix.coordinate.latitude) * scale
                    let dx = (bLng - aLng) * cosLat * scale
                    let dy = (bLat - aLat) * scale
                    let length = dx * dx + dy * dy
                    let t = length > 0 ? max(0, min(1, -(ax * dx + ay * dy) / length)) : 0
                    nearest = min(nearest, hypot(ax + t * dx, ay + t * dy))
                }
            }
            guard nearest.isFinite else { return }
            if nearest > max(70, fix.horizontalAccuracy * 2) { outsideCount += 1 } else { outsideCount = 0 }
            let time = fix.timestamp.timeIntervalSince1970
            if outsideCount >= 3 && time - lastAlertAt >= 90 {
                lastAlertAt = time
                let content = UNMutableNotificationContent()
                content.title = "산길따라 · 경로 확인"
                content.body = "가져온 경로에서 벗어났을 수 있어요. 현재 위치와 주변을 확인해 주세요."
                content.sound = .default
                let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
                UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
            }
        }
        func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { self.error("GPS 신호를 받지 못했습니다. 권한과 위치 설정을 확인해 주세요.") }
        private func error(_ message: String) {
            guard let data = try? JSONSerialization.data(withJSONObject: [message]), let json = String(data: data, encoding: .utf8) else { return }
            web?.evaluateJavaScript("window.onTrailError?.((\(json))[0])", completionHandler: nil)
        }
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if url.isFileURL, url.standardizedFileURL.path.hasPrefix(Bundle.main.bundleURL.path + "/") { decisionHandler(.allow); return }
            if url.scheme == "https" { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
        }
        deinit { serverAPI.close(); manager.stopUpdatingLocation(); NotificationCenter.default.removeObserver(self) }
    }
}

// 토큰은 JavaScript에 전달하지 않고 Keychain에 보관합니다.
final class NativeServerAPI: NSObject, URLSessionTaskDelegate {
    private lazy var origin: String = {
        guard let url = Bundle.main.url(forResource: "server-config", withExtension: "json", subdirectory: "web"),
              let data = try? Data(contentsOf: url), let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        return config["apiOrigin"] as? String ?? ""
    }()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 7; config.timeoutIntervalForResource = 14
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private func tokenQuery() -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "kr.seoultrail.server-session", kSecAttrAccount as String: origin] }
    private func token() -> String? {
        var query = tokenQuery(); query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess, let data = value as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    private func saveToken(_ value: String) throws {
        let query = tokenQuery()
        if value == "clear" { let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw URLError(.cannotWriteToFile) }; return }
        guard value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw URLError(.cannotParseResponse) }
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if update == errSecItemNotFound {
            var insert = query; attributes.forEach { insert[$0.key] = $0.value }
            guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else { throw URLError(.cannotWriteToFile) }
        } else if update != errSecSuccess { throw URLError(.cannotWriteToFile) }
    }
    func request(_ message: [String: Any], completed: @escaping ([String: Any]) -> Void) {
        let requestId = message["requestId"] as? String ?? ""
        let failure = { completed(["requestId": requestId, "error": "공유 서버에 연결하지 못했습니다. 인터넷 연결과 저장 결과를 확인해 주세요."]) }
        // 고정된 공식 출처만 조회하며 계정 토큰·쿠키는 전달하지 않습니다.
        let publicSources = [
            "public-notices/knps": "https://www.knps.or.kr/front/portal/safe/acsCtrList.do?menuNo=8000340",
            "public-notices/seoultrail": "https://gil.seoul.go.kr/bbsctt/list.do?key=2304100032",
            "public-notices/citywall": "https://seoulcitywall.seoul.go.kr/board/B0001.do?bcaId=0&pageIndex=1"
        ]
        if let path = message["path"] as? String, let address = publicSources[path] {
            guard message["method"] as? String == "GET", let url = URL(string: address) else { failure(); return }
            var request = URLRequest(url: url); request.setValue("text/html", forHTTPHeaderField: "Accept")
            session.dataTask(with: request) { data, response, error in
                guard error == nil, let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode),
                      let data = data, data.count <= 2 * 1024 * 1024, let html = String(data: data, encoding: .utf8) else { failure(); return }
                completed(["requestId": requestId, "status": response.statusCode, "body": ["html": html, "fetchedAt": Date().timeIntervalSince1970 * 1000]])
            }.resume()
            return
        }
        guard let base = URLComponents(string: origin), base.scheme == "https", base.host != nil, base.user == nil, base.password == nil,
              base.path.isEmpty, base.query == nil, base.fragment == nil,
              let path = message["path"] as? String, path.range(of: "^[a-z0-9/-]{1,200}$", options: .regularExpression) != nil,
              let method = message["method"] as? String, ["GET", "POST", "DELETE"].contains(method), let url = URL(string: origin + "/api/" + path) else { failure(); return }
        var request = URLRequest(url: url); request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("1", forHTTPHeaderField: "X-Sangil-Request"); request.setValue("1", forHTTPHeaderField: "X-Sangil-Native")
        if let token = token() { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if method != "GET" {
            guard let data = try? JSONSerialization.data(withJSONObject: message["body"] as? [String: Any] ?? [:]), data.count <= 3 * 1024 * 1024 else { failure(); return }
            request.httpBody = data
        }
        session.dataTask(with: request) { [weak self] data, response, error in
            guard error == nil, let response = response as? HTTPURLResponse, !(300...399).contains(response.statusCode),
                  let data = data, data.count <= 8 * 1024 * 1024, let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { failure(); return }
            do {
                if (200...299).contains(response.statusCode), let token = response.value(forHTTPHeaderField: "X-Sangil-Token") { try self?.saveToken(token) }
                if response.statusCode == 401 && !["auth/login", "auth/register"].contains(path) { try self?.saveToken("clear") }
                completed(["requestId": requestId, "status": response.statusCode, "body": body])
            } catch { failure() }
        }.resume()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func close() { session.invalidateAndCancel() }
}
