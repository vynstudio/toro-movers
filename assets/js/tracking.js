/*
 * Toro Movers — tracking module (lazy-loaded for PageSpeed)
 *
 * Meta Pixel + GA4 + Meta Conversions API (CAPI) with event_id
 * deduplication between browser pixel and server CAPI.
 *
 * PERFORMANCE: Third-party scripts (fbevents.js ~60KB, gtag.js
 * ~70KB) are NOT loaded on page load. They load on first user
 * interaction (scroll, click, or touch) — typically within 1-2
 * seconds of landing. This defers ~130KB of JS from the critical
 * rendering path, improving LCP by 1-2 seconds on mobile.
 *
 * TRACKING ACCURACY: PageView fires on first interaction instead
 * of on load (~1-2s delay). Lead, Contact, ViewContent events
 * are unaffected because they always happen after interaction.
 * CAPI server-side events fire normally for deduplication.
 *
 * Public API:
 *   window.ToroTrack.lead(formData)
 *   window.ToroTrack.contact(method)
 *   window.ToroTrack.viewContent(name)
 */

(function () {
  var PIXEL_ID = '1637703184084307';
  var GA4_ID = 'G-1L9NR2HTRT';
  var CAPI_ENDPOINT = '/.netlify/functions/capi';

  var _loaded = false;
  var _queue = []; // events queued before scripts load

  // ---------- helpers (available immediately) ----------
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getCookie(name) {
    var m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return m ? m.pop() : undefined;
  }

  function sendCapi(eventName, eventId, userData, customData) {
    try {
      var payload = JSON.stringify({
        event_name: eventName,
        event_id: eventId,
        event_source_url: location.href,
        user_data: Object.assign(
          { fbp: getCookie('_fbp'), fbc: getCookie('_fbc') },
          userData || {}
        ),
        custom_data: customData || {},
      });
      navigator.sendBeacon
        ? navigator.sendBeacon(CAPI_ENDPOINT, new Blob([payload], { type: 'application/json' }))
        : fetch(CAPI_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true });
    } catch (e) { /* swallow */ }
  }

  // ---------- track function ----------
  function track(eventName, gaParams, customData, userData) {
    var eventId = uuid();

    if (!_loaded) {
      // Scripts not loaded yet — queue for replay + send CAPI immediately (server-side doesn't need browser scripts)
      _queue.push([eventName, gaParams, customData, userData, eventId]);
      sendCapi(eventName, eventId, userData, customData);
      return;
    }

    // Pixel (browser)
    try { fbq('track', eventName, customData || {}, { eventID: eventId }); } catch (e) {}
    // GA4
    try { gtag('event', eventName, Object.assign({}, gaParams || {})); } catch (e) {}
    // CAPI (server)
    sendCapi(eventName, eventId, userData, customData);
  }

  // ---------- lazy-load scripts on first interaction ----------
  function loadScripts() {
    if (_loaded) return;
    _loaded = true;

    // Remove interaction listeners
    ['scroll', 'click', 'touchstart', 'mouseover'].forEach(function (evt) {
      document.removeEventListener(evt, loadScripts, { capture: true, passive: true });
    });

    // Load Meta Pixel
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n;
      n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v;
      s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', PIXEL_ID);

    // Load GA4
    var gaScript = document.createElement('script');
    gaScript.async = true;
    gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
    document.head.appendChild(gaScript);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA4_ID, { send_page_view: false });

    // Replay queued events (PageView etc.) once scripts initialize
    // Give fbevents.js a moment to initialize before replaying
    setTimeout(function () {
      _queue.forEach(function (q) {
        var eventName = q[0], gaParams = q[1], customData = q[2], eventId = q[4];
        try { fbq('track', eventName, customData || {}, { eventID: eventId }); } catch (e) {}
        try { gtag('event', eventName, Object.assign({}, gaParams || {})); } catch (e) {}
        // CAPI already sent — don't resend
      });
      _queue = [];
    }, 500);
  }

  // Register interaction listeners (passive, capture for earliest possible trigger)
  ['scroll', 'click', 'touchstart', 'mouseover'].forEach(function (evt) {
    document.addEventListener(evt, loadScripts, { capture: true, passive: true, once: true });
  });

  // Fallback: if no interaction within 5 seconds, load anyway
  // (catches bots, lighthouse, users who just stare)
  setTimeout(loadScripts, 5000);

  // ---------- public API (available immediately, queues if needed) ----------
  window.ToroTrack = {
    lead: function (formData) {
      track(
        'Lead',
        { event_category: 'form', event_label: (formData && formData.package) || 'booking', value: 1, currency: 'USD' },
        { content_name: 'booking_form', value: 1, currency: 'USD' },
        formData
          ? { email: formData.email, phone: formData.phone, first_name: (formData.name || '').split(' ')[0], last_name: (formData.name || '').split(' ').slice(1).join(' '), zip: formData.zip }
          : {}
      );
    },
    contact: function (method) {
      track('Contact', { event_category: 'contact', event_label: method || 'phone' }, { contact_method: method || 'phone' });
    },
    viewContent: function (name) {
      track('ViewContent', { event_category: 'engagement', event_label: name || 'packages' }, { content_name: name || 'packages' });
    },
  };

  // ---------- auto-wire on DOM ready ----------
  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  onReady(function () {
    // PageView — fires immediately but queued until scripts load
    track('PageView', { page_location: location.href, page_title: document.title });

    // tel: / mailto: clicks → Contact
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('tel:') === 0) window.ToroTrack.contact('phone');
      else if (href.indexOf('mailto:') === 0) window.ToroTrack.contact('email');
    });

    // ViewContent on #packages (fires once when 50% visible)
    var pkg = document.getElementById('packages');
    if (pkg && 'IntersectionObserver' in window) {
      var fired = false;
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!fired && entry.isIntersecting) {
              fired = true;
              window.ToroTrack.viewContent('packages');
              io.disconnect();
            }
          });
        },
        { threshold: 0.5 }
      );
      io.observe(pkg);
    }
  });
})();
