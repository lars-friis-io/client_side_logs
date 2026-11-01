(function () {
  window.startDataLayerLogger = function (settings) {
    if (!settings || !settings.customer || !settings.token) {
      console.error('datalayer log: "customer" or "token" is missing');
      return;
    }

    if (window.dataLayerLoggerStarted === true) return;
    window.dataLayerLoggerStarted = true;

    const endpoint = "https://browser-intake-datadoghq.eu/api/v2/logs";
    const token = settings.token;

    /* ---------------- BOT FILTERING ---------------- */

    const ua = navigator.userAgent || "";
    const namedBotRe = /(CookieInformationScanner|Morningscore|Googlebot|AdsBot-Google|Mediapartners-Google|APIs-Google|Google-InspectionTool|Storebot-Google|AhrefsBot|AhrefsSiteAudit)/i;
    const automationRe = /(HeadlessChrome|phantomjs|selenium|webdriver|playwright|puppeteer|chromedriver)/i;

    if (namedBotRe.test(ua) || automationRe.test(ua) || navigator.webdriver === true) return;

    /* ---------------- HELPERS ---------------- */

    function getDeviceType() {
      return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "mobile" : "desktop";
    }

    function readAllCookies() {
      const cookies = {
        cookie_values: {},
        cookie_names: []
      };

      document.cookie.split("; ").forEach(c => {
        const idx = c.indexOf("=");

        if (idx > -1) {
          const key = c.substring(0, idx);
          cookies.cookie_values[key] = c.substring(idx + 1);
          cookies.cookie_names.push(key);
        }
      });

      return cookies;
    }

    function attachMissingDataLayers() {
      if (!Array.isArray(window.dataLayerlog) || !Array.isArray(window.dataLayer)) return;

      for (let i = 0; i < window.dataLayerlog.length; i++) {
        const queuedEvent = window.dataLayerlog[i];

        if (!queuedEvent.needs_datalayer_lookup) continue;

        const uniqueEventId = queuedEvent.uniqueEventId;
        if (!uniqueEventId) continue;

        for (let j = 0; j < window.dataLayer.length; j++) {
          const dlItem = window.dataLayer[j];
          let candidate = null;

          if (typeof dlItem.getUntrustedMessageValue === "function") {
            try {
              candidate = dlItem.getUntrustedMessageValue();
            } catch (e) {
              continue;
            }
          }

          if (candidate && candidate["gtm.uniqueEventId"] === uniqueEventId) {
            queuedEvent.datalayer = candidate;
            delete queuedEvent.needs_datalayer_lookup;
            break;
          }
        }
      }
    }

    /* ---------------- CONSENT ---------------- */

    function getConsentStatus() {
      const consent = {
        analytics_storage: "not set",
        ad_storage: "not set",
        usedDefault: undefined,
        usedUpdate: undefined,
        waitPeriodTimedOut: undefined
      };

      const ics = window.google_tag_data?.ics;

      if (!ics) return consent;

      consent.usedDefault = ics.usedDefault;
      consent.usedUpdate = ics.usedUpdate;
      consent.waitPeriodTimedOut = ics.waitPeriodTimedOut;

      ["analytics_storage", "ad_storage"].forEach(type => {
        const entry = ics.entries?.[type];

        if (entry) {
          if (typeof entry.update === "boolean") {
            consent[type] = entry.update ? 1 : 0;
          } else if (typeof entry.default === "boolean") {
            consent[type] = entry.default ? 1 : 0;
          }
        }
      });

      return consent;
    }

    /* ---------------- FLUSH ---------------- */

    function flush(isPageExit = false) {
      const consent = getConsentStatus();

      const consentAccepted =
        consent.analytics_storage === 1 &&
        consent.ad_storage === 1;

      const events = [];

      // DataLayer events: Require consent
      if (
        consentAccepted &&
        Array.isArray(window.dataLayerlog) &&
        window.dataLayerlog.length
      ) {
        attachMissingDataLayers();

        window.dataLayerlog.forEach(event => {
          event.user_agent = navigator.userAgent;
          event.device_type = getDeviceType();

          if (event.key_event === 1 || event.key_event === true) {
            event.full_datalayer = window.dataLayer;
            event.referrer = document.referrer || null;
            event.cookies = readAllCookies();
          }

          events.push(event);
        });

        window.dataLayerlog.length = 0;
      }

      // Traffic events: Send on page exit regardless of consent
      if (
        isPageExit &&
        Array.isArray(window.trafficLog) &&
        window.trafficLog.length
      ) {
        window.trafficLog.forEach(event => {
          event.user_agent = navigator.userAgent;
          event.device_type = getDeviceType();
          event.consent = consent;

          events.push(event);
        });

        window.trafficLog.length = 0;
      }

      if (!events.length) return;

      const payload = events
        .map(event => JSON.stringify(event))
        .join("\n");

      navigator.sendBeacon(endpoint + "?dd-api-key=" + token, payload);
    }

    /* ---------------- LIFECYCLE ---------------- */

    setInterval(flush, 5000);

    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush(true);
    });

    addEventListener("pagehide", () => flush(true));
    addEventListener("beforeunload", () => flush(true));
    addEventListener("popstate", () => flush(true));
  };
})();
