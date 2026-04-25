/*
 * Toro Movers — Booking Calculator + Stripe Deposit Flow
 *
 * Flow: Package card click → Calculator modal → Estimate → Stripe Checkout
 *
 * Deposit logic:
 *   - Labor only (no truck): $50
 *   - Includes truck: $125
 */

(function () {
  var RATE = 75;
  var TRUCK_FEE = 275;
  var CHECKOUT_ENDPOINT = '/.netlify/functions/create-checkout';

  // Hour estimates by bedroom count
  var HOURS_BY_BR = { '1': 2, '2': 3, '3': 4, '4': 5 };

  // Mover defaults by package
  var PKG_DEFAULTS = {
    loading:  { movers: 2, truck: false, label: 'Loading Help' },
    intown:   { movers: 2, truck: true,  label: 'In-Town Move' },
    big:      { movers: 3, truck: true,  label: 'Big Move' },
    custom:   { movers: 2, truck: false, label: 'Custom Move' },
  };

  // ---- Build the modal HTML ----
  function createModal() {
    var overlay = document.createElement('div');
    overlay.id = 'bk-overlay';
    overlay.innerHTML = '\
<div id="bk-modal">\
  <button id="bk-close" aria-label="Close">&times;</button>\
  <div id="bk-progress"><span id="bk-step-label">Step 1 of 3</span><div id="bk-bar"><div id="bk-bar-fill"></div></div></div>\
\
  <!-- STEP 1: Move Details -->\
  <div class="bk-step" id="bk-step-1">\
    <h3 id="bk-pkg-title">Tell us about your move</h3>\
    <div class="bk-grid">\
      <div class="bk-field"><label>How many bedrooms?</label>\
        <div class="bk-pills" data-field="bedrooms">\
          <button class="bk-pill" data-val="1">1</button>\
          <button class="bk-pill active" data-val="2">2</button>\
          <button class="bk-pill" data-val="3">3</button>\
          <button class="bk-pill" data-val="4">4+</button>\
        </div></div>\
      <div class="bk-field"><label>Stairs involved?</label>\
        <div class="bk-pills" data-field="stairs">\
          <button class="bk-pill active" data-val="none">No stairs</button>\
          <button class="bk-pill" data-val="2nd">2nd floor</button>\
          <button class="bk-pill" data-val="3rd">3rd+</button>\
        </div></div>\
      <div class="bk-field"><label>Need packing help?</label>\
        <div class="bk-pills" data-field="packing">\
          <button class="bk-pill active" data-val="none">No</button>\
          <button class="bk-pill" data-val="fragile">Fragile only</button>\
          <button class="bk-pill" data-val="full">Full house</button>\
        </div></div>\
      <div class="bk-field"><label>Need us to bring a truck?</label>\
        <div class="bk-pills" data-field="truck">\
          <button class="bk-pill active" data-val="no" id="bk-truck-no">No</button>\
          <button class="bk-pill" data-val="yes" id="bk-truck-yes">Yes (+$275)</button>\
        </div></div>\
    </div>\
    <button class="bk-btn-next" id="bk-next-1">Next &rarr;</button>\
  </div>\
\
  <!-- STEP 2: Contact & Schedule -->\
  <div class="bk-step" id="bk-step-2" style="display:none">\
    <h3>When & where?</h3>\
    <div class="bk-grid">\
      <div class="bk-field"><label for="bk-date">Move date</label>\
        <input type="date" id="bk-date" class="bk-input" required></div>\
      <div class="bk-field"><label for="bk-zip-from">Pickup ZIP</label>\
        <input type="text" id="bk-zip-from" class="bk-input" placeholder="32801" maxlength="5" inputmode="numeric" required></div>\
      <div class="bk-field"><label for="bk-zip-to">Dropoff ZIP</label>\
        <input type="text" id="bk-zip-to" class="bk-input" placeholder="32746" maxlength="5" inputmode="numeric" required></div>\
      <div class="bk-field"><label>Special items? (check any)</label>\
        <div class="bk-checks">\
          <label class="bk-check"><input type="checkbox" value="Piano"> Piano</label>\
          <label class="bk-check"><input type="checkbox" value="Gun safe"> Gun safe</label>\
          <label class="bk-check"><input type="checkbox" value="Pool table"> Pool table</label>\
          <label class="bk-check"><input type="checkbox" value="Heavy appliance"> Heavy appliance</label>\
        </div></div>\
      <div class="bk-field"><label for="bk-name">Your name</label>\
        <input type="text" id="bk-name" class="bk-input" placeholder="Maria Sanchez" required></div>\
      <div class="bk-field"><label for="bk-phone">Phone</label>\
        <input type="tel" id="bk-phone" class="bk-input" placeholder="(321) 555-1234" inputmode="tel" required></div>\
      <div class="bk-field bk-full"><label for="bk-email">Email</label>\
        <input type="email" id="bk-email" class="bk-input" placeholder="maria@email.com"></div>\
    </div>\
    <div class="bk-btn-row">\
      <button class="bk-btn-back" id="bk-back-2">&larr; Back</button>\
      <button class="bk-btn-next" id="bk-next-2">See My Estimate &rarr;</button>\
    </div>\
  </div>\
\
  <!-- STEP 3: Estimate + Pay -->\
  <div class="bk-step" id="bk-step-3" style="display:none">\
    <h3>Your move estimate</h3>\
    <div id="bk-estimate-card">\
      <div id="bk-est-pkg" class="bk-est-row"></div>\
      <div class="bk-est-breakdown">\
        <div class="bk-est-row"><span>Crew</span><span id="bk-est-crew"></span></div>\
        <div class="bk-est-row"><span>Estimated hours</span><span id="bk-est-hours"></span></div>\
        <div class="bk-est-row"><span>Labor</span><span id="bk-est-labor"></span></div>\
        <div class="bk-est-row" id="bk-est-truck-row" style="display:none"><span>Truck</span><span id="bk-est-truck">+$275</span></div>\
        <div class="bk-est-row" id="bk-est-packing-row" style="display:none"><span>Packing</span><span id="bk-est-packing"></span></div>\
      </div>\
      <div class="bk-est-total"><span>Estimated total</span><span id="bk-est-total">$0</span></div>\
      <div class="bk-est-deposit"><span id="bk-deposit-label">Deposit to reserve</span><span id="bk-deposit-amount">$50</span></div>\
      <p class="bk-est-note">The deposit holds your date. Balance paid after the move by card, Cash App, or Zelle. 2-hour minimum applies, then billed by the hour.</p>\
    </div>\
    <div class="bk-btn-row">\
      <button class="bk-btn-back" id="bk-back-3">&larr; Back</button>\
      <button class="bk-btn-pay" id="bk-pay">Reserve This Move &rarr;</button>\
    </div>\
    <p class="bk-stripe-note">Secure payment via Stripe. You\'ll be redirected to complete the deposit.</p>\
  </div>\
</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  // ---- Calculator state ----
  var state = {
    pkg: 'intown',
    bedrooms: '2',
    stairs: 'none',
    packing: 'none',
    truck: 'no',
    date: '',
    zip_from: '',
    zip_to: '',
    special: [],
    name: '',
    phone: '',
    email: '',
  };

  var currentStep = 1;
  var overlay = null;

  // ---- Estimate calculation ----
  function calculate() {
    var defaults = PKG_DEFAULTS[state.pkg] || PKG_DEFAULTS.custom;
    var movers = defaults.movers;
    var hasTruck = state.truck === 'yes' || defaults.truck;
    var hours = HOURS_BY_BR[state.bedrooms] || 3;

    // Stairs add-on
    if (state.stairs === '2nd') hours += 0.5;
    else if (state.stairs === '3rd') hours += 1;

    // Packing add-on
    var packingHours = 0;
    if (state.packing === 'fragile') packingHours = 1;
    else if (state.packing === 'full') packingHours = 2;
    hours += packingHours;

    // Special items add-on
    hours += (state.special.length * 0.5);

    // Round up to nearest 0.5
    hours = Math.ceil(hours * 2) / 2;

    var labor = movers * hours * RATE;
    var truckFee = hasTruck ? TRUCK_FEE : 0;
    var total = labor + truckFee;
    var deposit = hasTruck ? 125 : 50;

    return {
      movers: movers,
      hours: hours,
      labor: labor,
      truckFee: truckFee,
      packingHours: packingHours,
      total: total,
      deposit: deposit,
      hasTruck: hasTruck,
    };
  }

  // ---- UI helpers ----
  function showStep(n) {
    currentStep = n;
    for (var i = 1; i <= 3; i++) {
      var el = document.getElementById('bk-step-' + i);
      if (el) el.style.display = i === n ? '' : 'none';
    }
    document.getElementById('bk-step-label').textContent = 'Step ' + n + ' of 3';
    document.getElementById('bk-bar-fill').style.width = (n / 3 * 100) + '%';
  }

  function renderEstimate() {
    var est = calculate();
    var defaults = PKG_DEFAULTS[state.pkg] || PKG_DEFAULTS.custom;

    document.getElementById('bk-est-pkg').textContent = defaults.label + ' — ' + state.bedrooms + ' bedroom' + (state.bedrooms !== '1' ? 's' : '');
    document.getElementById('bk-est-crew').textContent = est.movers + ' movers';
    document.getElementById('bk-est-hours').textContent = est.hours + ' hours';
    document.getElementById('bk-est-labor').textContent = '$' + est.labor.toLocaleString();

    var truckRow = document.getElementById('bk-est-truck-row');
    truckRow.style.display = est.hasTruck ? '' : 'none';

    var packRow = document.getElementById('bk-est-packing-row');
    if (est.packingHours > 0) {
      packRow.style.display = '';
      document.getElementById('bk-est-packing').textContent = '+' + est.packingHours + ' hr' + (est.packingHours > 1 ? 's' : '') + ' ($' + (est.packingHours * est.movers * RATE) + ')';
    } else {
      packRow.style.display = 'none';
    }

    document.getElementById('bk-est-total').textContent = '$' + est.total.toLocaleString();
    document.getElementById('bk-deposit-amount').textContent = '$' + est.deposit;
  }

  // ---- Open/close modal ----
  function openModal(pkg) {
    if (!overlay) overlay = createModal();
    state.pkg = pkg || 'custom';

    // Set truck default based on package
    var defaults = PKG_DEFAULTS[state.pkg];
    if (defaults && defaults.truck) {
      state.truck = 'yes';
      var yesBtn = document.getElementById('bk-truck-yes');
      var noBtn = document.getElementById('bk-truck-no');
      if (yesBtn) { yesBtn.classList.add('active'); }
      if (noBtn) { noBtn.classList.remove('active'); }
    } else {
      state.truck = 'no';
      var yesBtn2 = document.getElementById('bk-truck-yes');
      var noBtn2 = document.getElementById('bk-truck-no');
      if (yesBtn2) { yesBtn2.classList.remove('active'); }
      if (noBtn2) { noBtn2.classList.add('active'); }
    }

    var title = document.getElementById('bk-pkg-title');
    if (title) title.textContent = (defaults ? defaults.label : 'Custom Move') + ' — Tell us about your move';

    showStep(1);
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    wireEvents();
  }

  function closeModal() {
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ---- Wire events (once) ----
  var wired = false;
  function wireEvents() {
    if (wired) return;
    wired = true;

    // Close
    document.getElementById('bk-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });

    // Pill selections
    overlay.addEventListener('click', function (e) {
      var pill = e.target.closest('.bk-pill');
      if (!pill) return;
      var group = pill.parentElement;
      var field = group.dataset.field;
      group.querySelectorAll('.bk-pill').forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      state[field] = pill.dataset.val;
    });

    // Step navigation
    document.getElementById('bk-next-1').addEventListener('click', function () { showStep(2); });
    document.getElementById('bk-back-2').addEventListener('click', function () { showStep(1); });
    document.getElementById('bk-next-2').addEventListener('click', function () {
      // Collect form values
      state.date = document.getElementById('bk-date').value;
      state.zip_from = document.getElementById('bk-zip-from').value;
      state.zip_to = document.getElementById('bk-zip-to').value;
      state.name = document.getElementById('bk-name').value;
      state.phone = document.getElementById('bk-phone').value;
      state.email = document.getElementById('bk-email').value;

      // Collect special items
      state.special = [];
      overlay.querySelectorAll('.bk-checks input:checked').forEach(function (cb) {
        state.special.push(cb.value);
      });

      // Basic validation
      if (!state.name || !state.phone) {
        alert('Please enter your name and phone number.');
        return;
      }

      renderEstimate();
      showStep(3);
    });
    document.getElementById('bk-back-3').addEventListener('click', function () { showStep(2); });

    // PAY — Stripe checkout
    document.getElementById('bk-pay').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Redirecting to Stripe...';

      var est = calculate();

      fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package: state.pkg,
          deposit: est.deposit,
          estimate: est.total,
          movers: est.movers,
          hours: est.hours,
          truck: est.hasTruck,
          packing: state.packing,
          bedrooms: state.bedrooms,
          stairs: state.stairs,
          date: state.date,
          zip_from: state.zip_from,
          zip_to: state.zip_to,
          special: state.special.join(', '),
          name: state.name,
          phone: state.phone,
          email: state.email,
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.url) {
            window.location.href = data.url;
          } else {
            alert('Something went wrong. Please call (689) 600-2720 to book.');
            btn.disabled = false;
            btn.textContent = 'Reserve This Move →';
          }
        })
        .catch(function () {
          alert('Something went wrong. Please call (689) 600-2720 to book.');
          btn.disabled = false;
          btn.textContent = 'Reserve This Move →';
        });
    });
  }

  // ---- Expose globally for package card onclick ----
  window.openBooking = openModal;

  // ---- Also wire the existing selectPackage function to open booking ----
  var origSelectPackage = window.selectPackage;
  window.selectPackage = function (pkg) {
    openModal(pkg);
  };

})();
