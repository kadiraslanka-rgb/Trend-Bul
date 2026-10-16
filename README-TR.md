# TRADINGLY 2 BYBİT — iOS (v1.80)

Android APK'daki uygulamanın birebir iOS sürümü (Capacitor 8). Arayüz, strateji,
backtest, Sinyaller/forward kayıtları ve bildirimler APK'daki web kodunun aynısıdır;
Android'e özel yerel (Kotlin/Java) parçalar Swift'e taşındı:

| Android parçası | iOS karşılığı |
|---|---|
| MarketConnection (Bybit ayna sunucuları: api.bybit.tr → api.bybit.com → api.bytick.com) | `TradinglyPlugins.swift` · `Net.fetch` |
| LiveScan + ForwardStore (sinyal geçmişi, tek pozisyon kuralı, TP/zaman aşımı işaretleme) | `TradinglyCore.swift` — aynı mantık, aynı model sürümü |
| Arka plan tarama servisi (JobScheduler, 15 dk) | iOS BGTaskScheduler + JavaScriptCore içinde aynı tarama kodu |
| BacktestExport (Downloads/TRADINGLY/*.zip) | Dosyalar › iPhone'umda › TRADINGLY 2 › TRADINGLY |
| BacktestBackground (pil kısıtlaması) | Backtest sürerken ekran açık tutulur |

## iOS farkları (Apple kısıtları)
- iOS, uygulamaların Android'deki gibi her 15 dakikada bir arka planda çalışmasına izin vermez.
  Arka plan taraması iOS'un uygun gördüğü zamanlarda yapılır (genelde birkaç saatte bir,
  şarjdayken daha sık). En güvenilir sinyal için uygulamayı açık tutun.
- Backtest yalnızca uygulama ekrandayken çalışır; bu yüzden backtest boyunca ekran kapanmaz.

## IPA nasıl üretilir
Bilgisayarda Mac yoksa: bu klasörü bir GitHub deposuna yükleyin. `.github/workflows/ios.yml`
macOS sunucusunda imzasız `TRADINGLY-2-BYBIT-iOS-v1.80-unsigned.ipa` üretir
(Actions › en son çalışma › Artifacts).

Mac varsa:
```
npm ci
npm run sync
open ios/App/App.xcodeproj   # Signing & Capabilities'te Apple ID'nizi seçip iPhone'a çalıştırın
```

## iPhone'a kurulum (imzasız IPA)
1. Windows/Mac'e **Sideloadly** kurun, iPhone'u kabloyla bağlayın.
2. IPA'yı sürükleyin, Apple ID'nizle giriş yapıp **Start**'a basın.
3. iPhone: Ayarlar › Genel › VPN ve Cihaz Yönetimi › Apple ID'nize güvenin.
   iOS 16+ için Ayarlar › Gizlilik ve Güvenlik › **Geliştirici Modu** açık olmalı.
4. Ücretsiz Apple ID ile kurulum 7 gün geçerlidir; Sideloadly ile yeniden imzalanır.
   Ücretli Apple Developer hesabıyla (yıllık 99 $) 1 yıl geçerli olur / TestFlight kullanılabilir.
