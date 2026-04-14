/*
 * Toro Movers — tracking module
 * Wires Meta Pixel + GA4 + Meta Conversions API (CAPI) with
 * event_id deduplication between browser pixel and server CAPI.
 *
 * Public API:
 *   window.ToroTrack.lead(formData)      — fires Lead
 *   window.ToroTrack.contact(method)     — fires Contact ("phone" | "email")
 *   window.ToroTrack.viewContent(name)   — fires ViewContent
 *
 * Auto-wired on DOMContentLoaded:
 *   - PageView (pixel + GA4 + CAPI)
 *   - Click on any <a href="tel:..."> → Contact
 *   - Click on any <a href="mailto:..."> → Contact
 *   - IntersectionObserver on #packages → ViewContent (once)
 */

(function () {
  var PIXEL_ID = '1637703184084307';           // legacy pixel (historical data)
  var PIXEL_ID_LP = '985575491098437';         // new pixel owned by ad account, for campaign optimization
  var GA4_ID = 'G-1L9NR2HTRT';
  var CAPI_ENDPOINT = '/.netlify/functions/capi';

  // ---------- Meta Pixel base (dual-init) ----------
  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = !0;
    n.version = '2.0';
    n.queue = [];
    t = b.createElement(e);
    t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', PIXEL_ID);
  fbq('init', PIXEL_ID_LP);

  // ---------- GA4 base ----------
  var gaScript = document.createElement('script');
  gaScript.async = true;
  gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
  document.head.appendChild(gaScript);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', GA4_ID, { send_page_view: false }); // we fire manually below

  // ---------- helpers ----------
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
      navigator.sendBeacon
        ? navigator.sendBeacon(
            CAPI_ENDPOINT,
            new Blob(
              [
                JSON.stringify({
                  event_name: eventName,
                  event_id: eventId,
                  event_source_url: location.href,
                  user_data: Object.assign(
                    {
                      fbp: getCookie('_fbp'),
                      fbc: getCookie('_fbc'),
                    },
                    userData || {}
                  ),
                  custom_data: customData || {},
                }),
              ],
              { type: 'application/json' }
            )
          )
        : fetch(CAPI_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event_name: eventName,
              event_id: eventId,
              event_source_url: location.href,
              user_data: Object.assign(
                { fbp: getCookie('_fbp'), fbc: getCookie('_fbc') },
                userData || {}
              ),
              custom_data: customData || {},
            }),
            keepalive: true,
          });
    } catch (e) {
      /* swallow — tracking must never break UX */
    }
  }

  function track(eventName, gaParams, customData, userData) {
    var eventId = uuid();
    // Pixel (browser)
    try { fbq('track', eventName, customData || {}, { eventID: eventId }); } catch (e) {}
    // GA4
    try { gtag('event', eventName, Object.assign({}, gaParams || {})); } catch (e) {}
    // CAPI (server)
    sendCapi(eventName, eventId, userData, customData);
  }

  // ---------- public API ----------
  window.ToroTrack = {
    lead: function (formData) {
      track(
        'Lead',
        {
          event_category: 'form',
          event_label: (formData && formData.package) || 'booking',
          value: 1,
          currency: 'USD',
        },
        { content_name: 'booking_form', value: 1, currency: 'USD' },
        formData
          ? {
              email: formData.email,
              phone: formData.phone,
              first_name: (formData.name || '').split(' ')[0],
              last_name: (formData.name || '').split(' ').slice(1).join(' '),
              zip: formData.zip,
            }
          : {}
      );
    },
    contact: function (method) {
      track(
        'Contact',
        { event_category: 'contact', event_label: method || 'phone' },
        { contact_method: method || 'phone' }
      );
    },
    viewContent: function (name) {
      track(
        'ViewContent',
        { event_category: 'engagement', event_label: name || 'packages' },
        { content_name: name || 'packages' }
      );
    },
  };

  // ---------- auto-wire on DOM ready ----------
  function onReady(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  onReady(function () {
    // Initial PageView (fire manually so pixel and GA4 share intent)
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
