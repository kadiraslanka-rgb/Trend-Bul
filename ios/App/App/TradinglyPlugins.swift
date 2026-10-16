// TRADINGLY 2 BYBİT — iOS versions of the app's custom Android Capacitor plugins:
// MarketConnection, NotificationSettings, LiveScan, BacktestBackground, BacktestExport.

import Foundation
import UIKit
import WebKit
import Capacitor

private func jsObj(_ d: [String: Any]) -> JSObject { JSTypes.coerceDictionaryToJSObject(d) ?? [:] }

class TradinglyBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MarketConnectionPlugin())
        bridge?.registerPluginInstance(NotificationSettingsPlugin())
        bridge?.registerPluginInstance(LiveScanPlugin())
        bridge?.registerPluginInstance(BacktestBackgroundPlugin())
        bridge?.registerPluginInstance(BacktestExportPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let bg = UIColor(red: 2 / 255, green: 6 / 255, blue: 23 / 255, alpha: 1)
        view.backgroundColor = bg
        webView?.isOpaque = false
        webView?.backgroundColor = bg
        webView?.scrollView.backgroundColor = bg
    }
}

// MARK: - MarketConnection

@objc(MarketConnectionPlugin)
public class MarketConnectionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MarketConnectionPlugin"
    public let jsName = "MarketConnection"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "runDiagnostic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    @objc func request(_ call: CAPPluginCall) { handle(call) }
    @objc func fetch(_ call: CAPPluginCall) { handle(call) }

    private func handle(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), !url.trimmingCharacters(in: .whitespaces).isEmpty else {
            call.reject("URL parameter is required"); return
        }
        var headers = [String: String]()
        if let h = call.getObject("headers") { for (k, v) in h { headers[k] = "\(v)" } }
        let timeout = call.getInt("timeout") ?? 15000
        Net.fetch(url, method: call.getString("method") ?? "GET", body: call.getString("body"),
                  headers: headers, timeoutMs: timeout) { r in
            var out: [String: Any] = ["status": r.status, "data": r.body, "ok": r.ok, "usedUrl": r.usedUrl, "trace": r.trace]
            if !r.ok { out["error"] = r.error }
            call.resolve(jsObj(out))
        }
    }

    @objc func checkConnection(_ call: CAPPluginCall) {
        let group = DispatchGroup()
        var out = [String: Any]()
        let lock = NSLock()
        let targets = [("bybit", "https://api.bybit.com/v5/market/time"),
                       ("binance", "https://fapi.binance.com/fapi/v1/time"),
                       ("okx", "https://www.okx.com/api/v5/public/time")]
        for (name, url) in targets {
            group.enter()
            Net.fetch(url, timeoutMs: 8000) { r in
                lock.lock()
                out["\(name)Ok"] = r.ok; out["\(name)Url"] = r.usedUrl
                out["\(name)Error"] = r.error; out["\(name)Trace"] = r.trace
                lock.unlock()
                group.leave()
            }
        }
        group.notify(queue: .global()) { call.resolve(jsObj(out)) }
    }

    @objc func runDiagnostic(_ call: CAPPluginCall) {
        var report = "=== TRADINGLY iOS NETWORK DIAGNOSTIC REPORT ===\n\n"
        let group = DispatchGroup()
        let lock = NSLock()
        for host in ["api.bybit.tr", "api.bytick.com", "api.bybit.com", "fapi.binance.com", "www.okx.com"] {
            group.enter()
            let started = Date()
            var req = URLRequest(url: URL(string: "https://\(host)/")!, timeoutInterval: 8)
            req.httpMethod = "HEAD"
            Net.session.dataTask(with: req) { _, resp, err in
                let ms = Int(Date().timeIntervalSince(started) * 1000)
                lock.lock()
                if let err = err { report += "[\(host)] ERROR: \(err.localizedDescription) (\(ms) ms)\n" }
                else { report += "[\(host)] OK HTTP \((resp as? HTTPURLResponse)?.statusCode ?? 0) (\(ms) ms)\n" }
                lock.unlock()
                group.leave()
            }.resume()
        }
        group.notify(queue: .global()) { call.resolve(jsObj(["report": report, "hasInternetPermission": true])) }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve(jsObj(["pluginLoaded": true, "trialUnlocked": true, "statusDescription": "Aktif / Sınırsız Tarama"]))
    }
}

// MARK: - NotificationSettings

@objc(NotificationSettingsPlugin)
public class NotificationSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NotificationSettingsPlugin"
    public let jsName = "NotificationSettings"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)]

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var s = UIApplication.openSettingsURLString
            if #available(iOS 16.0, *) { s = UIApplication.openNotificationSettingsURLString }
            if let u = URL(string: s) { UIApplication.shared.open(u) }
            call.resolve()
        }
    }
}

// MARK: - LiveScan

@objc(LiveScanPlugin)
public class LiveScanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveScanPlugin"
    public let jsName = "LiveScan"
    public let pluginMethods: [CAPPluginMethod] = [
        "start", "stop", "status", "history", "observe", "mark", "commit", "seen", "record", "testNotification"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private var prefs: Prefs { Prefs.named("live_scan") }

    @objc func start(_ call: CAPPluginCall) {
        do {
            var cfg = try jParseObject(call.getString("config") ?? "{}")
            cfg["exchanges"] = ["bybit"]
            cfg["strategyVersion"] = ForwardStore.MODEL
            prefs.put(["config": jString(cfg), "enabled": true])
            ForwardStore.retryNotifications()
            BackgroundScan.schedule()
            call.resolve(jsObj(["scheduled": true, "notificationsEnabled": Notices.enabled()]))
        } catch {
            prefs.put(["lastError": "\(error)"])
            call.reject("\(error)")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        prefs.put(["enabled": false])
        BackgroundScan.cancel()
        ScanRunner.cancel("Stopped")
        call.resolve()
    }

    @objc func status(_ call: CAPPluginCall) {
        let p = prefs
        let summary = (try? jParseObject(p.string("lastSummary", "{}"))) ?? [:]
        let progress = (try? jParseObject(p.string("progress", "{}"))) ?? [:]
        call.resolve(jsObj([
            "enabled": p.bool("enabled"),
            "foregroundService": false,
            "running": ScanRunner.running(),
            "lastScanAt": p.long("lastScanAt"),
            "lastScan": p.long("lastScanAt"),
            "lastResult": p.string("lastSummary", "{}"),
            "lastStartedAt": p.long("lastStartedAt"),
            "heartbeat": p.long("heartbeat"),
            "summary": summary,
            "progress": progress,
            "lastError": p.string("lastError", ""),
            "notificationsEnabled": Notices.enabled(),
            "pendingNotifications": ForwardStore.pendingNotifications(),
            "lastNotificationAt": p.long("lastNotificationAt"),
            "lastNotificationSymbol": p.string("lastNotificationSymbol", ""),
            "lastNotificationError": p.string("lastNotificationError", ""),
            "strategyVersion": ForwardStore.MODEL,
            "platform": "ios"
        ]))
    }

    @objc func history(_ call: CAPPluginCall) { call.resolve(["rows": ForwardStore.history()]) }

    @objc func observe(_ call: CAPPluginCall) {
        do { try ForwardStore.observe(call.getString("row")); call.resolve() } catch { call.reject("\(error)") }
    }

    @objc func mark(_ call: CAPPluginCall) {
        do { try ForwardStore.mark(call.getString("row")); call.resolve() } catch { call.reject("\(error)") }
    }

    @objc func commit(_ call: CAPPluginCall) {
        do { call.resolve(["result": try ForwardStore.commit(call.getString("payload"))]) } catch { call.reject("\(error)") }
    }

    @objc func seen(_ call: CAPPluginCall) {
        call.resolve(["notified": Prefs.named("live_notified").bool(call.getString("key") ?? "")])
    }

    @objc func record(_ call: CAPPluginCall) {
        if let k = call.getString("key") { Prefs.named("live_notified").put([k: true]) }
        call.resolve()
    }

    @objc func testNotification(_ call: CAPPluginCall) {
        guard Notices.enabled() else { call.reject("Notifications disabled in iOS settings"); return }
        Notices.test()
        call.resolve()
    }
}

// MARK: - BacktestBackground

@objc(BacktestBackgroundPlugin)
public class BacktestBackgroundPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BacktestBackgroundPlugin"
    public let jsName = "BacktestBackground"
    public let pluginMethods: [CAPPluginMethod] = [
        "begin", "update", "status", "stop", "batteryStatus", "batterySettings"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private static var state = "idle"
    private static var task: UIBackgroundTaskIdentifier = .invalid

    private var unrestricted: Bool { !ProcessInfo.processInfo.isLowPowerModeEnabled }

    @objc func begin(_ call: CAPPluginCall) {
        BacktestBackgroundPlugin.state = "running"
        DispatchQueue.main.async {
            // iOS suspends apps in the background, so keep the screen awake while a backtest runs.
            UIApplication.shared.isIdleTimerDisabled = true
            self.beginTask()
        }
        call.resolve(jsObj(["state": "running", "batteryUnrestricted": unrestricted]))
    }

    private func beginTask() {
        if BacktestBackgroundPlugin.task != .invalid { return }
        BacktestBackgroundPlugin.task = UIApplication.shared.beginBackgroundTask(withName: "tradingly-backtest") {
            UIApplication.shared.endBackgroundTask(BacktestBackgroundPlugin.task)
            BacktestBackgroundPlugin.task = .invalid
        }
    }

    @objc func update(_ call: CAPPluginCall) { call.resolve() }

    @objc func status(_ call: CAPPluginCall) { call.resolve(["state": BacktestBackgroundPlugin.state]) }

    @objc func stop(_ call: CAPPluginCall) {
        BacktestBackgroundPlugin.state = "finished"
        let message = call.getString("message")
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = false
            if BacktestBackgroundPlugin.task != .invalid {
                UIApplication.shared.endBackgroundTask(BacktestBackgroundPlugin.task)
                BacktestBackgroundPlugin.task = .invalid
            }
            if let m = message, UIApplication.shared.applicationState != .active {
                Notices.post(id: "tradingly-backtest-done", title: "TRADINGLY · Backtest", body: m)
            }
        }
        call.resolve()
    }

    @objc func batteryStatus(_ call: CAPPluginCall) { call.resolve(["unrestricted": unrestricted]) }

    @objc func batterySettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
            call.resolve(["unrestricted": self.unrestricted])
        }
    }
}

// MARK: - BacktestExport (zip saved to Files › On My iPhone › TRADINGLY 2 › TRADINGLY)

@objc(BacktestExportPlugin)
public class BacktestExportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BacktestExportPlugin"
    public let jsName = "BacktestExport"
    public let pluginMethods: [CAPPluginMethod] = [
        "begin", "append", "nextEntry", "finish", "abort"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private let lock = NSLock()
    private var zip: ZipBuilder?
    private var token: String?
    private var filename = ""

    private func discard() { zip?.discard(); zip = nil; token = nil }

    private func check(_ call: CAPPluginCall) throws -> ZipBuilder {
        guard let z = zip, let t = token, t == call.getString("token") else { throw TLErr.msg("Export session expired") }
        return z
    }

    @objc func begin(_ call: CAPPluginCall) {
        lock.lock(); defer { lock.unlock() }
        discard()
        guard let name = call.getString("filename"),
              name.range(of: "^[A-Za-z0-9_-]{1,100}\\.zip$", options: .regularExpression) != nil else {
            call.reject("Invalid export filename"); return
        }
        do {
            let z = try ZipBuilder()
            try z.nextEntry("analysis.json")
            zip = z; filename = name
            let t = UUID().uuidString; token = t
            call.resolve(["token": t, "filename": name])
        } catch { discard(); call.reject("\(error)") }
    }

    @objc func append(_ call: CAPPluginCall) {
        lock.lock(); defer { lock.unlock() }
        do {
            let z = try check(call)
            guard let data = call.getString("data"), data.count <= 262_144 else { throw TLErr.msg("Invalid export chunk") }
            try z.append(data)
            call.resolve()
        } catch { discard(); call.reject("\(error)") }
    }

    @objc func nextEntry(_ call: CAPPluginCall) {
        lock.lock(); defer { lock.unlock() }
        do {
            let z = try check(call)
            let name = call.getString("name") ?? ""
            guard name == "trades.csv" || name == "README.txt" else { throw TLErr.msg("Invalid archive entry") }
            try z.nextEntry(name)
            call.resolve()
        } catch { discard(); call.reject("\(error)") }
    }

    @objc func finish(_ call: CAPPluginCall) {
        lock.lock(); defer { lock.unlock() }
        do {
            let z = try check(call)
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("TRADINGLY", isDirectory: true)
            try FileManager.default.createDirectory(at: docs, withIntermediateDirectories: true)
            let out = docs.appendingPathComponent(filename)
            try? FileManager.default.removeItem(at: out)
            try z.write(to: out)
            zip = nil; token = nil
            call.resolve(["filename": filename, "uri": out.absoluteString,
                          "path": "Dosyalar › iPhone'umda › TRADINGLY 2 › TRADINGLY › " + filename])
        } catch { discard(); call.reject("\(error)") }
    }

    @objc func abort(_ call: CAPPluginCall) {
        lock.lock(); defer { lock.unlock() }
        discard()
        call.resolve()
    }
}
