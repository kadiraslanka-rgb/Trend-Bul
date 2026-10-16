// TRADINGLY 2 BYBİT — iOS native core.
// Port of the Android Kotlin/Java layer: SharedPreferences store, ForwardStore,
// Notices, MarketRead/MarketTransport and the background ScanRunner.
// This file intentionally does NOT import Capacitor (JavaScriptCore's JSValue
// would clash with Capacitor's JSValue protocol).

import Foundation
import UIKit
import UserNotifications
import JavaScriptCore
import BackgroundTasks

typealias J = [String: Any]

// MARK: - JSON helpers (org.json-like semantics)

enum TLErr: Error, CustomStringConvertible {
    case msg(String)
    var description: String { if case .msg(let m) = self { return m }; return "error" }
}

func jParseObject(_ s: String?) throws -> J {
    guard let s = s, let d = s.data(using: .utf8),
          let o = try JSONSerialization.jsonObject(with: d, options: [.fragmentsAllowed]) as? J else {
        throw TLErr.msg("Invalid JSON object")
    }
    return o
}
func jParseArray(_ s: String?) throws -> [J] {
    guard let s = s, let d = s.data(using: .utf8),
          let o = try JSONSerialization.jsonObject(with: d, options: [.fragmentsAllowed]) as? [Any] else {
        throw TLErr.msg("Invalid JSON array")
    }
    return o.compactMap { $0 as? J }
}
func jString(_ any: Any) -> String {
    if JSONSerialization.isValidJSONObject(any),
       let d = try? JSONSerialization.data(withJSONObject: any, options: []),
       let s = String(data: d, encoding: .utf8) { return s }
    if let s = any as? String,
       let d = try? JSONSerialization.data(withJSONObject: [s], options: []),
       let w = String(data: d, encoding: .utf8) { return String(w.dropFirst().dropLast()) }
    return "null"
}
func jStr(_ o: J, _ k: String, _ d: String = "") -> String {
    guard let v = o[k], !(v is NSNull) else { return d }
    if let s = v as? String { return s }
    if let n = v as? NSNumber { return n.stringValue }
    return d
}
func jLong(_ o: J, _ k: String, _ d: Int64 = 0) -> Int64 {
    if let n = o[k] as? NSNumber { return n.int64Value }
    if let s = o[k] as? String { if let v = Int64(s) { return v }; if let v = Double(s) { return Int64(v) } }
    return d
}
func jDouble(_ o: J, _ k: String, _ d: Double = .nan) -> Double {
    if let n = o[k] as? NSNumber { return n.doubleValue }
    if let s = o[k] as? String, let v = Double(s) { return v }
    return d
}
func jBool(_ o: J, _ k: String, _ d: Bool = false) -> Bool {
    if let n = o[k] as? NSNumber { return n.boolValue }
    if let s = o[k] as? String { if s.lowercased() == "true" { return true }; if s.lowercased() == "false" { return false } }
    return d
}
func jReqString(_ o: J, _ k: String) throws -> String {
    guard let v = o[k], !(v is NSNull) else { throw TLErr.msg("JSONObject[\"\(k)\"] not found.") }
    if let s = v as? String { return s }
    if let n = v as? NSNumber { return n.stringValue }
    throw TLErr.msg("JSONObject[\"\(k)\"] is not a string.")
}
func jReqLong(_ o: J, _ k: String) throws -> Int64 {
    guard let v = o[k], !(v is NSNull) else { throw TLErr.msg("JSONObject[\"\(k)\"] not found.") }
    if let n = v as? NSNumber { return n.int64Value }
    if let s = v as? String, let d = Double(s) { return Int64(d) }
    throw TLErr.msg("JSONObject[\"\(k)\"] is not a long.")
}
func jReqDouble(_ o: J, _ k: String) throws -> Double {
    guard let v = o[k], !(v is NSNull) else { throw TLErr.msg("JSONObject[\"\(k)\"] not found.") }
    if let n = v as? NSNumber { return n.doubleValue }
    if let s = v as? String, let d = Double(s) { return d }
    throw TLErr.msg("JSONObject[\"\(k)\"] is not a number.")
}
func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

// MARK: - Prefs (SharedPreferences equivalent, JSON file per name)

final class Prefs {
    private static var all = [String: Prefs]()
    private static let allLock = NSLock()
    static func named(_ name: String) -> Prefs {
        allLock.lock(); defer { allLock.unlock() }
        if let p = all[name] { return p }
        let p = Prefs(name); all[name] = p; return p
    }

    private let url: URL
    private var dict: [String: Any]
    private let lock = NSRecursiveLock()

    private init(_ name: String) {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("prefs", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        url = base.appendingPathComponent(name + ".json")
        if let d = try? Data(contentsOf: url),
           let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { dict = o } else { dict = [:] }
    }
    func string(_ k: String, _ d: String) -> String { lock.lock(); defer { lock.unlock() }; return dict[k] as? String ?? d }
    func long(_ k: String, _ d: Int64 = 0) -> Int64 { lock.lock(); defer { lock.unlock() }; return (dict[k] as? NSNumber)?.int64Value ?? d }
    func bool(_ k: String, _ d: Bool = false) -> Bool { lock.lock(); defer { lock.unlock() }; return (dict[k] as? NSNumber)?.boolValue ?? d }
    func contains(_ k: String) -> Bool { lock.lock(); defer { lock.unlock() }; return dict[k] != nil }
    /// Applies all values (NSNull removes) and writes atomically. Returns false on I/O failure.
    @discardableResult
    func put(_ values: [String: Any]) -> Bool {
        lock.lock(); defer { lock.unlock() }
        for (k, v) in values { if v is NSNull { dict.removeValue(forKey: k) } else { dict[k] = v } }
        do {
            let d = try JSONSerialization.data(withJSONObject: dict, options: [])
            try d.write(to: url, options: [.atomic])
            return true
        } catch { return false }
    }
}

// MARK: - Notices (Android Notices.java)

enum Notices {
    private static var cachedEnabled: Bool?
    private static var cachedAt = Date.distantPast
    private static let lock = NSLock()

    static func enabled() -> Bool {
        lock.lock()
        if let c = cachedEnabled, Date().timeIntervalSince(cachedAt) < 5 { lock.unlock(); return c }
        lock.unlock()
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        UNUserNotificationCenter.current().getNotificationSettings { s in
            switch s.authorizationStatus {
            case .authorized, .provisional, .ephemeral: ok = true
            default: ok = false
            }
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 2)
        lock.lock(); cachedEnabled = ok; cachedAt = Date(); lock.unlock()
        return ok
    }

    static func english() -> Bool {
        Prefs.named("live_scan").string("config", "{}").contains("\"en\"")
    }

    static func post(id: String, title: String, body: String) {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: c, trigger: nil))
    }

    private static let signalLock = NSLock()
    static func signal(_ row: J) throws {
        signalLock.lock(); defer { signalLock.unlock() }
        let key = try jReqString(row, "notificationKey")
        let notified = Prefs.named("live_notified")
        guard !notified.bool(key), enabled() else { return }
        let side = jStr(row, "side", "LONG")
        let symbol = try jReqString(row, "symbol")
        let en = english()
        let entry = try jReqDouble(row, "entry"), tp = try jReqDouble(row, "tp")
        let body = "\(side) · 4H · " + (en ? "Entry reference: " : "Giriş referansı: ") + "\(entry) · TP: \(tp) · " + (en ? "No SL · max 7 days" : "SL yok · en fazla 7 gün")
        post(id: key, title: (en ? "New signal: " : "Yeni sinyal: ") + symbol + " · " + side, body: body)
        if !notified.put([key: true]) { throw TLErr.msg("Could not save notification receipt") }
        Prefs.named("live_scan").put(["lastNotificationAt": nowMs(), "lastNotificationSymbol": symbol + " · " + side])
    }

    static func test() {
        post(id: "tradingly-test-\(nowMs())", title: "TRADINGLY 2 BYBİT · Test", body: "Bildirim bağlantısı çalışıyor / Notification test")
    }
}

// MARK: - ForwardStore (Android ForwardStore.java)

enum ForwardStore {
    static let MODEL = "tp5-no-sl-max168h-dual-period-x10-v14"
    static let LEGACY_MODEL = "tp5-no-sl-max168h-dual-period-110-105-range-v13"
    private static let lock = NSRecursiveLock()
    private static var prefs: Prefs { Prefs.named("forward_test") }

    static func tracked(_ s: String) -> Bool { s == MODEL || s == LEGACY_MODEL }

    static let priorJSON = #"[{"key":"user-confirmed-bybit-IOTXUSDT-1791806400000","strategyVersion":"manual-user-confirmed-v1","symbol":"IOTXUSDT","exchange":"bybit","side":"LONG","timeframe":"4H","signalAt":1791806400000,"registeredAt":1791822576000,"entry":0.003885,"tp":0.00407925,"status":"TP","targetAt":1791959040000,"lastPrice":0.004099,"lastCheckedAt":1791959694000,"priorCompleted":true,"userConfirmed":true,"portfolioAccepted":false,"portfolioPending":false,"deadline":null,"returnPct":null,"exitPrice":null,"error":""},{"key":"user-confirmed-bybit-METISUSDT-1791748800000","strategyVersion":"manual-user-confirmed-v1","symbol":"METISUSDT","exchange":"bybit","side":"LONG","timeframe":"4H","signalAt":1791748800000,"registeredAt":1791755050000,"entry":3.863,"tp":4.05615,"status":"TP","targetAt":1791774600000,"lastPrice":4.053,"lastCheckedAt":1791775001000,"priorCompleted":true,"userConfirmed":true,"portfolioAccepted":false,"portfolioPending":false,"deadline":null,"returnPct":null,"exitPrice":null,"error":""},{"key":"user-confirmed-gate-BERAUSDT-1792166400000","strategyVersion":"manual-user-confirmed-v1","symbol":"BERAUSDT","exchange":"gate","side":"SHORT","timeframe":"4H","signalAt":1792166400000,"registeredAt":1792178355000,"entry":0.1988,"tp":0.18886,"status":"TP","targetAt":null,"lastPrice":0.1869,"lastCheckedAt":1792178429000,"priorCompleted":true,"userConfirmed":true,"portfolioAccepted":false,"portfolioPending":false,"deadline":null,"returnPct":null,"exitPrice":null,"error":"Kullanıcı TP olarak teyit etti; kesin hedef saati belirtilmedi."}]"#

    private static func ensurePrior() throws {
        let p = prefs
        if !p.bool("user_confirmed_three_v1") {
            var rows = try jParseArray(p.string("rows", "[]"))
            for prior in try jParseArray(priorJSON) {
                if let i = rows.firstIndex(where: {
                    jStr(prior, "symbol") == jStr($0, "symbol") && jStr(prior, "exchange") == jStr($0, "exchange") &&
                    jStr(prior, "side") == jStr($0, "side") && jLong(prior, "signalAt") == jLong($0, "signalAt")
                }) {
                    for k in ["status", "targetAt", "lastPrice", "lastCheckedAt", "priorCompleted", "userConfirmed",
                              "portfolioAccepted", "portfolioPending", "deadline", "returnPct", "exitPrice", "error"] {
                        rows[i][k] = prior[k] ?? NSNull()
                    }
                } else { rows.append(prior) }
            }
            if !p.put(["rows": jString(rows), "user_confirmed_three_v1": true]) { throw TLErr.msg("Could not import user-confirmed history") }
        }
        if !p.bool("completed_details_v2") {
            var rows = try jParseArray(p.string("rows", "[]"))
            for i in rows.indices {
                let r = rows[i]
                if jLong(r, "signalAt") == 1792166400000 && jBool(r, "priorCompleted") && jStr(r, "symbol") == "BERAUSDT" &&
                    jStr(r, "exchange") == "gate" && (r["targetAt"] == nil || r["targetAt"] is NSNull) {
                    rows[i]["targetAt"] = 1792173360000 as Int64
                    rows[i]["targetKind"] = "minute"
                    rows[i]["targetTimePrecision"] = "1m"
                    rows[i]["error"] = ""
                }
            }
            if !p.put(["rows": jString(rows), "completed_details_v2": true]) { throw TLErr.msg("Could not save verified TP time") }
        }
    }

    static func history() -> String {
        lock.lock(); defer { lock.unlock() }
        try? ensurePrior()
        return prefs.string("rows", "[]")
    }
    private static func rows() throws -> [J] { try jParseArray(history()) }
    private static func save(_ rows: [J]) throws {
        if !prefs.put(["rows": jString(rows)]) { throw TLErr.msg("Could not save signals") }
    }

    static func validate(_ o: J) throws {
        let entry = try jReqDouble(o, "entry"), tp = try jReqDouble(o, "tp")
        let short = jStr(o, "side") == "SHORT"
        if jStr(o, "strategyVersion") == MODEL && jStr(o, "exchange") == "bybit" && jStr(o, "timeframe") == "4H" &&
            jStr(o, "symbol").hasSuffix("USDT") {
            let key = try jReqString(o, "key")
            if !key.isEmpty && entry.isFinite && entry > 0 && tp.isFinite && abs(tp / entry - (short ? 0.95 : 1.05)) <= 1e-8 {
                let deadline = try jReqLong(o, "deadline")
                let signalAt = try jReqLong(o, "signalAt")
                if deadline == signalAt + 604_800_000 { return }
            }
        }
        throw TLErr.msg("Invalid current strategy signal")
    }

    static func sameSignal(_ a: J, _ b: J) -> Bool {
        if jStr(a, "key") == jStr(b, "key") { return true }
        if !tracked(jStr(a, "strategyVersion")) { return false }
        let tk = jStr(b, "tradeKey")
        return !tk.isEmpty && tk == jStr(a, "tradeKey")
    }

    static func portfolioBusy(_ rows: [J], _ at: Int64) -> Bool {
        rows.contains { r in
            tracked(jStr(r, "strategyVersion")) && jBool(r, "portfolioAccepted", true) &&
                (jStr(r, "status") == "OPEN" || jLong(r, "freeAt") > at)
        }
    }

    static func observe(_ s: String?) throws {
        lock.lock(); defer { lock.unlock() }
        var o = try jParseObject(s)
        try validate(o)
        var rs = try rows()
        if rs.contains(where: { sameSignal($0, o) }) { return }
        let signalAt = try jReqLong(o, "signalAt")
        o["portfolioAccepted"] = !jBool(o, "portfolioPending") && !portfolioBusy(rs, signalAt)
        rs.append(o)
        try save(rs)
        retryNotifications()
    }

    static func mark(_ s: String?) throws {
        lock.lock(); defer { lock.unlock() }
        let o = try jParseObject(s)
        var rs = try rows()
        for i in rs.indices {
            let r = rs[i]
            guard jStr(r, "key") == jStr(o, "key"), tracked(jStr(r, "strategyVersion")) else { continue }
            guard jStr(r, "status") == "OPEN", jLong(o, "lastCheckedAt") >= jLong(r, "lastCheckedAt") else { continue }
            let st = jStr(o, "status", "OPEN")
            if !["OPEN", "TP", "TIMEOUT"].contains(st) { throw TLErr.msg("Invalid forward outcome") }
            let registeredAt = try jReqLong(r, "registeredAt")
            if st != "OPEN" && (jLong(o, "exitAt") < registeredAt || !(jDouble(o, "exitPrice") > 0)) {
                throw TLErr.msg("Invalid exit evidence")
            }
            for k in ["status", "lastCheckedAt", "lastPrice", "coverageGap", "targetAt", "targetKind", "exitAt", "freeAt", "exitPrice", "returnPct", "error"] {
                if let v = o[k] { rs[i][k] = v }
            }
            try save(rs)
        }
    }

    static func retryNotifications() {
        lock.lock(); defer { lock.unlock() }
        var err = ""
        do {
            for r in try rows() where tracked(jStr(r, "strategyVersion")) && jStr(r, "status") == "OPEN" {
                do { try Notices.signal(r) } catch { err = jStr(r, "symbol") + ": " + "\(error)" }
            }
        } catch { err = "\(error)" }
        Prefs.named("live_scan").put(["lastNotificationError": err])
    }

    static func pendingNotifications() -> Int {
        lock.lock(); defer { lock.unlock() }
        guard let rs = try? rows() else { return 0 }
        let n = Prefs.named("live_notified")
        return rs.filter { tracked(jStr($0, "strategyVersion")) && jStr($0, "status") == "OPEN" && !n.bool(jStr($0, "notificationKey")) }.count
    }

    static func commit(_ payload: String?) throws -> String {
        lock.lock(); defer { lock.unlock() }
        let p = try jParseObject(payload)
        guard let candsRaw = p["candidates"] as? [Any] else { throw TLErr.msg("JSONObject[\"candidates\"] not found.") }
        var cands = candsRaw.compactMap { $0 as? J }
        cands.sort { a, b in
            var c = jLong(a, "entryTime") == jLong(b, "entryTime") ? 0 : (jLong(a, "entryTime") < jLong(b, "entryTime") ? -1 : 1)
            if c == 0 {
                let ra = jDouble(a, "range20Pct", .infinity), rb = jDouble(b, "range20Pct", .infinity)
                c = ra == rb ? 0 : (ra < rb ? -1 : 1)
            }
            if c == 0 && a["priorityRank"] != nil && b["priorityRank"] != nil {
                let pa = jLong(a, "priorityRank"), pb = jLong(b, "priorityRank")
                c = pa == pb ? 0 : (pa < pb ? -1 : 1)
            }
            if c == 0 { let sa = jStr(a, "symbol"), sb = jStr(b, "symbol"); c = sa == sb ? 0 : (sa < sb ? -1 : 1) }
            if c == 0 { let sa = jStr(a, "side"), sb = jStr(b, "side"); c = sa == sb ? 0 : (sa < sb ? -1 : 1) }
            return c < 0
        }
        var rs = try rows()
        let checkpoint = Prefs.named("live_candidates_v13")
        var cpUpdates = [String: Any]()
        var accepted = [J](), recorded = [J](), skippedBusy = 0
        for cand in cands {
            let key = try jReqString(cand, "key")
            if let idx = rs.firstIndex(where: { jStr($0, "key") == key && jBool($0, "portfolioPending") }) {
                let pendingAt = try jReqLong(rs[idx], "signalAt")
                let busy = portfolioBusy(rs, pendingAt)
                rs[idx]["portfolioPending"] = false
                rs[idx]["portfolioAccepted"] = !busy
                if busy { skippedBusy += 1 } else { accepted.append(rs[idx]) }
                recorded.append(rs[idx])
                cpUpdates[key] = nowMs()
            } else if !checkpoint.contains(key) && cpUpdates[key] == nil {
                cpUpdates[key] = nowMs()
                let qualified = jBool(cand, "qualified")
                let candRow = cand["row"] as? J ?? [:]
                let exists = rs.contains { jStr($0, "key") == key || (qualified && sameSignal($0, candRow)) }
                if !exists && qualified {
                    guard var row = cand["row"] as? J else { throw TLErr.msg("JSONObject[\"row\"] not found.") }
                    try validate(row)
                    let rowAt = try jReqLong(row, "signalAt")
                    let busy = portfolioBusy(rs, rowAt)
                    row["portfolioAccepted"] = !busy
                    if busy { skippedBusy += 1 }
                    row["registeredAt"] = nowMs()
                    row["lastCheckedAt"] = nowMs()
                    row["status"] = "OPEN"
                    rs.append(row)
                    recorded.append(row)
                    if !busy { accepted.append(row) }
                }
            }
        }
        try save(rs)
        if !checkpoint.put(cpUpdates) { throw TLErr.msg("Could not save candidate checkpoint") }
        retryNotifications()
        let notifiedPrefs = Prefs.named("live_notified")
        let notified = recorded.filter { notifiedPrefs.bool(jStr($0, "notificationKey")) }.count
        let out: J = ["accepted": accepted, "recorded": recorded, "notified": notified,
                      "pendingNotifications": pendingNotifications(), "skippedBusy": skippedBusy, "strategyVersion": MODEL]
        return jString(out)
    }
}

// MARK: - Network (MarketTransport / MarketRead with Bybit mirror failover)

struct NetResult {
    var status: Int
    var body: String
    var ok: Bool
    var error: String
    var usedUrl: String
    var trace: String
}

enum Net {
    static let userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    static let bybitMirrors = ["https://api.bybit.tr", "https://api.bybit.com", "https://api.bytick.com"]
    private static var preferred = [String: String]()
    private static let lock = NSLock()

    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.urlCache = nil
        c.httpMaximumConnectionsPerHost = 8
        c.timeoutIntervalForRequest = 20
        c.timeoutIntervalForResource = 60
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }()

    static func isBybit(_ host: String) -> Bool {
        host.hasSuffix("bybit.com") || host.hasSuffix("bytick.com") || host.hasSuffix("bybit.tr")
    }

    static func replaceHost(_ url: String, _ base: String) -> String {
        guard var c = URLComponents(string: url), let b = URLComponents(string: base) else { return url }
        c.scheme = b.scheme; c.host = b.host; c.port = b.port
        return c.string ?? url
    }

    static func candidates(_ url: String) -> (host: String, list: [String]) {
        let u = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let host = URLComponents(string: u)?.host else { return ("", []) }
        var list = [u]
        if isBybit(host) {
            for m in bybitMirrors { let alt = replaceHost(u, m); if !list.contains(alt) { list.append(alt) } }
        }
        lock.lock(); let pref = preferred[host]; lock.unlock()
        if let pref = pref {
            let p = replaceHost(u, pref)
            if let i = list.firstIndex(of: p) { list.remove(at: i); list.insert(p, at: 0) }
        }
        return (host, list)
    }

    /// strictBybit: also requires `retCode == 0` (MarketRead behaviour for the background worker).
    static func fetch(_ url: String, method: String = "GET", body: String? = nil, headers: [String: String] = [:],
                      timeoutMs: Int = 15000, strictBybit: Bool = false, done: @escaping (NetResult) -> Void) {
        let (host, list) = candidates(url)
        guard !list.isEmpty else { done(NetResult(status: 0, body: "", ok: false, error: "Invalid URL: \(url)", usedUrl: url, trace: "")); return }
        var trace = "Requested: \(url) | Candidates: \(list.count)\n"
        var last: NetResult?

        func attempt(_ i: Int) {
            if i >= list.count {
                var r = last ?? NetResult(status: 0, body: "", ok: false, error: "All connection attempts failed", usedUrl: url, trace: "")
                r.trace = trace
                done(r); return
            }
            let target = list[i]
            guard let u = URL(string: target) else { attempt(i + 1); return }
            var req = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: Double(max(timeoutMs, 1000)) / 1000)
            req.httpMethod = method.uppercased()
            req.setValue(userAgent, forHTTPHeaderField: "User-Agent")
            req.setValue("application/json, text/plain, */*", forHTTPHeaderField: "Accept")
            req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
            for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
            if let body = body, req.httpMethod == "POST" { req.httpBody = body.data(using: .utf8) }
            trace += "[\(i + 1)/\(list.count)] \(target) -> "
            session.dataTask(with: req) { data, resp, err in
                if let err = err {
                    trace += "EXCEPTION: \(err.localizedDescription)\n"
                    last = NetResult(status: 0, body: "", ok: false, error: err.localizedDescription, usedUrl: target, trace: "")
                    attempt(i + 1); return
                }
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
                var ok = (200..<300).contains(status)
                var error = ok ? "" : "HTTP \(status)"
                if ok && strictBybit && isBybit(u.host ?? "") {
                    if let o = try? jParseObject(text) {
                        let code = jLong(o, "retCode", -1)
                        if code != 0 { ok = false; error = jStr(o, "retMsg", "Bybit error") }
                        else if let result = o["result"] as? J {
                            let path = u.path
                            let needsList = path.hasSuffix("tickers") || (path.hasSuffix("instruments-info") && !target.contains("cursor="))
                                || (path.hasSuffix("kline") && !target.contains("start="))
                            if needsList && ((result["list"] as? [Any])?.isEmpty ?? true) { ok = false; error = "Empty public market list" }
                        }
                    } else { ok = false; error = "Invalid JSON" }
                }
                if ok {
                    if let h = u.host, let s = u.scheme { lock.lock(); preferred[host] = "\(s)://\(h)"; lock.unlock() }
                    trace += "SUCCESS (HTTP \(status))\n"
                    done(NetResult(status: status, body: text, ok: true, error: "", usedUrl: target, trace: trace)); return
                }
                trace += "FAIL HTTP \(status): \(error)\n"
                last = NetResult(status: status, body: text, ok: false, error: error, usedUrl: target, trace: "")
                if !strictBybit && status >= 400 && status < 500 && status != 403 && status != 429 {
                    var r = last!; r.trace = trace; done(r); return
                }
                attempt(i + 1)
            }.resume()
        }
        attempt(0)
    }
}

// MARK: - ScanRunner (background scan in JavaScriptCore; Android ScanRunner.java)

final class ScanRunner {
    private static var active: ScanRunner?
    private static let lock = NSLock()

    static func running() -> Bool { lock.lock(); defer { lock.unlock() }; return active != nil }

    @discardableResult
    static func run(done: @escaping () -> Void) -> Bool {
        lock.lock()
        if active != nil { lock.unlock(); return false }
        let r = ScanRunner(done: done)
        active = r
        lock.unlock()
        r.begin()
        return true
    }

    static func cancel(_ reason: String = "Stopped") {
        lock.lock(); let a = active; lock.unlock()
        a?.queue.async { a?.finish(error: reason, summary: nil) }
    }

    private let queue = DispatchQueue(label: "tradingly.livescan.js", qos: .utility)
    private var context: JSContext?
    private var finished = false
    private var timers = [Int: DispatchWorkItem]()
    private var timerSeq = 0
    private let done: () -> Void
    private var bgTask: UIBackgroundTaskIdentifier = .invalid

    private init(done: @escaping () -> Void) { self.done = done }

    private var prefs: Prefs { Prefs.named("live_scan") }

    private func begin() {
        DispatchQueue.main.async {
            self.bgTask = UIApplication.shared.beginBackgroundTask(withName: "tradingly-live-scan") {
                ScanRunner.cancel("iOS arka plan süresi doldu / iOS background time expired")
            }
        }
        queue.async { self.start() }
        queue.asyncAfter(deadline: .now() + 480) { [weak self] in
            self?.finish(error: "Scan exceeded 8 minutes; retry scheduled", summary: nil)
        }
    }

    private func start() {
        ForwardStore.retryNotifications()
        prefs.put(["lastStartedAt": nowMs(), "heartbeat": nowMs()])
        let made: JSContext? = JSContext()
        guard let ctx = made else { finish(error: "JavaScriptCore unavailable", summary: nil); return }
        context = ctx
        ctx.name = "TRADINGLY live scan"
        ctx.exceptionHandler = { _, exc in NSLog("[TRADINGLY JS] %@", exc?.toString() ?? "?") }

        let log: @convention(block) () -> Void = {
            let args = JSContext.currentArguments() as? [JSValue] ?? []
            NSLog("[TRADINGLY JS] %@", args.map { $0.toString() ?? "" }.joined(separator: " "))
        }
        ctx.evaluateScript("var console={};var window=globalThis;var self=globalThis;")
        let console = ctx.objectForKeyedSubscript("console")!
        for n in ["log", "info", "warn", "error", "debug"] { console.setObject(log, forKeyedSubscript: n as NSString) }

        let setTimeoutFn: @convention(block) (JSValue, JSValue) -> Int = { [weak self] cb, ms in
            guard let self = self else { return 0 }
            self.timerSeq += 1
            let id = self.timerSeq
            let delay = ms.isNumber ? max(0, ms.toDouble()) : 0
            let item = DispatchWorkItem { [weak self] in
                guard let self = self, !self.finished, self.timers.removeValue(forKey: id) != nil else { return }
                cb.call(withArguments: [])
            }
            self.timers[id] = item
            self.queue.asyncAfter(deadline: .now() + (delay.isFinite ? delay : 0) / 1000, execute: item)
            return id
        }
        let clearTimeoutFn: @convention(block) (JSValue) -> Void = { [weak self] id in
            guard let self = self, id.isNumber else { return }
            self.timers.removeValue(forKey: Int(id.toInt32()))?.cancel()
        }
        ctx.setObject(setTimeoutFn, forKeyedSubscript: "setTimeout" as NSString)
        ctx.setObject(clearTimeoutFn, forKeyedSubscript: "clearTimeout" as NSString)

        ctx.evaluateScript("var LiveNative={};")
        let native = ctx.objectForKeyedSubscript("LiveNative")!
        let config: @convention(block) () -> String = { Prefs.named("live_scan").string("config", "{}") }
        let history: @convention(block) () -> String = { ForwardStore.history() }
        let batch: @convention(block) (String) -> String = { s in
            do { return try ForwardStore.commit(s) } catch { return jString(["error": "\(error)"]) }
        }
        let observe: @convention(block) (String) -> Void = { [weak self] s in
            do { try ForwardStore.observe(s) } catch { self?.finish(error: "\(error)", summary: nil) }
        }
        let mark: @convention(block) (String) -> Void = { [weak self] s in
            do { try ForwardStore.mark(s) } catch { self?.finish(error: "\(error)", summary: nil) }
        }
        let progress: @convention(block) (String) -> Void = { s in
            Prefs.named("live_scan").put(["heartbeat": nowMs(), "progress": s])
        }
        let doneFn: @convention(block) (String) -> Void = { [weak self] s in
            if let o = try? jParseObject(s) { self?.finish(error: nil, summary: o) } else { self?.finish(error: "Invalid scan summary", summary: nil) }
        }
        let request: @convention(block) (String, Int) -> Void = { [weak self] url, id in
            guard let self = self, !self.finished else { return }
            Net.fetch(url, timeoutMs: 15000, strictBybit: true) { r in
                let payload: J = r.ok ? ["ok": true, "status": r.status, "text": r.body, "usedUrl": r.usedUrl]
                                      : ["ok": false, "status": r.status, "error": r.error]
                let json = jString(payload)
                self.queue.async {
                    guard !self.finished, let ctx = self.context else { return }
                    let v = ctx.objectForKeyedSubscript("JSON").invokeMethod("parse", withArguments: [json])
                    ctx.objectForKeyedSubscript("liveReply").call(withArguments: [id, v as Any])
                }
            }
        }
        native.setObject(config, forKeyedSubscript: "config" as NSString)
        native.setObject(history, forKeyedSubscript: "history" as NSString)
        native.setObject(batch, forKeyedSubscript: "batch" as NSString)
        native.setObject(observe, forKeyedSubscript: "observe" as NSString)
        native.setObject(mark, forKeyedSubscript: "mark" as NSString)
        native.setObject(progress, forKeyedSubscript: "progress" as NSString)
        native.setObject(doneFn, forKeyedSubscript: "done" as NSString)
        native.setObject(request, forKeyedSubscript: "request" as NSString)

        guard let url = Bundle.main.url(forResource: "live-worker-ios", withExtension: "js", subdirectory: "public"),
              let src = try? String(contentsOf: url, encoding: .utf8) else {
            finish(error: "Worker load failed: live-worker-ios.js missing", summary: nil); return
        }
        ctx.evaluateScript(src, withSourceURL: url)
        guard let run = ctx.objectForKeyedSubscript("TRADINGLY_RUN"), !run.isUndefined else {
            finish(error: "Worker load failed", summary: nil); return
        }
        run.call(withArguments: [])
    }

    /// Must be called on `queue`.
    private func finish(error: String?, summary: J?) {
        if finished { return }
        finished = true
        for (_, t) in timers { t.cancel() }
        timers.removeAll()
        var s = summary ?? [:]
        if let e = error { s["errors"] = [e] }
        let errs = s["errors"] as? [Any] ?? []
        let lastError = error ?? (errs.first.map { "\($0)" } ?? "")
        prefs.put(["lastScanAt": nowMs(), "lastSummary": jString(s), "lastError": lastError])
        // Release the JSContext only after the current JS call (if any) has unwound.
        let keep = context
        context = nil
        queue.async { _ = keep }
        ScanRunner.lock.lock(); ScanRunner.active = nil; ScanRunner.lock.unlock()
        let task = bgTask
        DispatchQueue.main.async {
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        }
        done()
    }
}

// MARK: - Background scheduling (Android JobScheduler equivalent)

enum BackgroundScan {
    static let refreshId = "com.tradingly.two.refresh"
    static let processingId = "com.tradingly.two.scan"

    static var enabled: Bool { Prefs.named("live_scan").bool("enabled") }

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshId, using: nil) { handle($0) }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: processingId, using: nil) { handle($0) }
        NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            schedule()
        }
    }

    static func schedule() {
        guard enabled else { return }
        let r = BGAppRefreshTaskRequest(identifier: refreshId)
        r.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do { try BGTaskScheduler.shared.submit(r) } catch { Prefs.named("live_scan").put(["lastError": "BG refresh: \(error.localizedDescription)"]) }
        let p = BGProcessingTaskRequest(identifier: processingId)
        p.requiresNetworkConnectivity = true
        p.requiresExternalPower = false
        p.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(p)
    }

    static func cancel() {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: refreshId)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: processingId)
    }

    private static func handle(_ task: BGTask) {
        schedule()
        guard enabled else { task.setTaskCompleted(success: true); return }
        let once = NSLock(); var completed = false
        func complete(_ ok: Bool) {
            once.lock(); defer { once.unlock() }
            if completed { return }
            completed = true
            task.setTaskCompleted(success: ok)
        }
        task.expirationHandler = {
            ScanRunner.cancel("iOS arka plan süresi doldu / iOS background time expired")
            complete(false)
        }
        if !ScanRunner.run(done: { complete(true) }) { complete(true) }
    }
}

// MARK: - Zip writer (stored entries) for BacktestExport

final class ZipBuilder {
    private struct Entry { let name: String; let file: URL; var crc: UInt32 = 0; var size: UInt64 = 0 }
    private var entries = [Entry]()
    private var handle: FileHandle?
    private let dir: URL

    private static let table: [UInt32] = (0..<256).map { i -> UInt32 in
        var c = UInt32(i)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB88320 ^ (c >> 1) : c >> 1 }
        return c
    }

    init() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("tl-export-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    func nextEntry(_ name: String) throws {
        try handle?.close()
        let f = dir.appendingPathComponent("\(entries.count).part")
        FileManager.default.createFile(atPath: f.path, contents: nil)
        handle = try FileHandle(forWritingTo: f)
        entries.append(Entry(name: name, file: f))
    }

    func append(_ s: String) throws {
        guard let h = handle, !entries.isEmpty else { throw TLErr.msg("Export session expired") }
        let d = Data(s.utf8)
        var c = ~entries[entries.count - 1].crc
        d.withUnsafeBytes { (p: UnsafeRawBufferPointer) in
            for b in p { c = ZipBuilder.table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
        }
        entries[entries.count - 1].crc = ~c
        entries[entries.count - 1].size += UInt64(d.count)
        h.write(d)
    }

    func write(to out: URL) throws {
        try handle?.close(); handle = nil
        FileManager.default.createFile(atPath: out.path, contents: nil)
        let o = try FileHandle(forWritingTo: out)
        defer { try? o.close() }
        var central = Data()
        var offset: UInt64 = 0
        func le16(_ v: UInt16) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
        func le32(_ v: UInt32) -> Data { withUnsafeBytes(of: v.littleEndian) { Data($0) } }
        for e in entries {
            let name = Data(e.name.utf8)
            var h = Data()
            h += le32(0x04034b50); h += le16(20); h += le16(0x0800); h += le16(0); h += le16(0); h += le16(0x21)
            h += le32(e.crc); h += le32(UInt32(e.size)); h += le32(UInt32(e.size)); h += le16(UInt16(name.count)); h += le16(0); h += name
            o.write(h)
            let r = try FileHandle(forReadingFrom: e.file)
            while true { let chunk = r.readData(ofLength: 1 << 20); if chunk.isEmpty { break }; o.write(chunk) }
            try r.close()
            var c = Data()
            c += le32(0x02014b50); c += le16(20); c += le16(20); c += le16(0x0800); c += le16(0); c += le16(0); c += le16(0x21)
            c += le32(e.crc); c += le32(UInt32(e.size)); c += le32(UInt32(e.size)); c += le16(UInt16(name.count))
            c += le16(0); c += le16(0); c += le16(0); c += le16(0); c += le32(0); c += le32(UInt32(offset)); c += name
            central += c
            offset += UInt64(h.count) + e.size
        }
        o.write(central)
        var end = Data()
        end += le32(0x06054b50); end += le16(0); end += le16(0); end += le16(UInt16(entries.count)); end += le16(UInt16(entries.count))
        end += le32(UInt32(central.count)); end += le32(UInt32(offset)); end += le16(0)
        o.write(end)
        discard()
    }

    func discard() {
        try? handle?.close(); handle = nil
        try? FileManager.default.removeItem(at: dir)
    }
}
