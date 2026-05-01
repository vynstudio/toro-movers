// Toro Movers — Branded quote PDF renderer.
//
// Pure function: takes (lead, customer, quote) → Promise<Buffer>.
// No side effects, no env access. Easy to unit-test.
//
// Brand source of truth: brand-identity.md
//   Toro Red #C8102E · Charcoal #1C1C1E · Sand #FBF6E9
//   Rate $75/mover/hr · Truck +$275 · Deposits $50 (labor) / $125 (truck)
//
// Bilingual: picks EN or ES off customer.language_preference.

// Use the standalone build: single file with AFM fonts inlined as base64.
// The default `require('pdfkit')` entry reads Helvetica.afm via fs at
// runtime, which esbuild doesn't bundle — breaks on Netlify Functions.
const PDFDocument = require('pdfkit/js/pdfkit.standalone.js');

const TORO_RED = '#C8102E';
const CHARCOAL = '#1C1C1E';
const CHARCOAL_SOFT = '#3A3A3D';
const GRAY_500 = '#6B7280';
const GRAY_200 = '#E5E7EB';
const SAND = '#FBF6E9';
const RED_SOFT_HEADER_TINT = '#FFE8EC';

const COPY = {
  en: {
    title: 'Moving Quote',
    quoteNum: 'Quote',
    quoteFor: 'Quote for',
    moveDate: 'Move date',
    from: 'From',
    to: 'To',
    size: 'Home size',
    summary: 'Summary',
    crew: 'Crew',
    hours: 'Estimated hours',
    rate: 'Hourly rate',
    truck: 'Truck (26-ft)',
    deposit: 'Deposit to book',
    total: 'Estimated total',
    fineprint: [
      'The price you book is the price you pay. No hidden fees, no fuel surcharges.',
      '2-hour minimum, then billed by the hour for actual time worked.',
      'Valid for 30 days. Insured in Florida.',
    ],
    tagline: 'Moving People Forward',
    cta: 'To book: reply to this email or call (689) 600-2720.',
    perMoverHr: '/ mover / hr',
    notIncluded: 'Not included',
  },
  es: {
    title: 'Cotizacion de Mudanza',
    quoteNum: 'Cotizacion',
    quoteFor: 'Cotizacion para',
    moveDate: 'Fecha de mudanza',
    from: 'Desde',
    to: 'Hasta',
    size: 'Tamano',
    summary: 'Resumen',
    crew: 'Cuadrilla',
    hours: 'Horas estimadas',
    rate: 'Tarifa por hora',
    truck: 'Camion (26 pies)',
    deposit: 'Deposito para reservar',
    total: 'Total estimado',
    fineprint: [
      'El precio que reservas es el precio que pagas. Sin tarifas ocultas.',
      'Minimo 2 horas, luego se cobra por hora de trabajo real.',
      'Valida por 30 dias. Con licencia y seguro en Florida.',
    ],
    tagline: 'Mudanzas honestas. Manos fuertes.',
    cta: 'Para reservar: responde a este correo o llama al (689) 600-2720.',
    perMoverHr: '/ mov. / h',
    notIncluded: 'No incluido',
  },
};

const ZONE_LABELS = {
  orlando_area: 'Orlando',
  kissimmee_st_cloud: 'Kissimmee / St. Cloud',
  sanford_lake_mary: 'Sanford / Lake Mary',
  winter_park_springs_oviedo: 'Winter Park / Oviedo',
  apopka_ocoee_winter_garden: 'Apopka / Ocoee / WG',
  clermont_davenport_haines: 'Clermont / Davenport',
  lake_nona_hunters_creek: 'Lake Nona',
  the_villages_ocala: 'The Villages / Ocala',
  long_distance: 'Long distance',
  other: 'Other',
};

const SIZE_LABELS = {
  few_items: 'A few items',
  studio: 'Studio',
  '1br': '1 BR',
  '2br': '2 BR',
  '3br': '3 BR',
  '4br_plus': '4 BR+',
};

function fmtMoney(n) {
  const v = Number(n || 0);
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch { return String(iso); }
}

function renderQuotePdf({ lead, customer, quote }) {
  const lang = (customer && customer.language_preference === 'es') ? 'es' : 'en';
  const L = COPY[lang];

  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageW = doc.page.width;
  const innerW = pageW - 108;

  // ===== Header bar =====
  doc.rect(0, 0, pageW, 90).fill(TORO_RED);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(26).text('TORO MOVERS', 54, 28);
  doc.font('Helvetica').fontSize(11).fillColor(RED_SOFT_HEADER_TINT).text(L.tagline, 54, 60);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11)
    .text('(689) 600-2720', 54, 30, { align: 'right', width: innerW });
  doc.font('Helvetica').fontSize(9).fillColor(RED_SOFT_HEADER_TINT)
    .text('Insured · FL', 54, 46, { align: 'right', width: innerW })
    .text('toromovers.net', 54, 60, { align: 'right', width: innerW });

  // ===== Title =====
  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(22).text(L.title, 54, 118);
  const qNum = String(lead.id || '').replace(/-/g, '').slice(0, 8).toUpperCase() || '—';
  doc.fillColor(GRAY_500).font('Helvetica').fontSize(10)
    .text(`${L.quoteNum} #${qNum}  ·  ${fmtDate(new Date().toISOString())}`, 54, 148);

  // ===== Customer / move date block =====
  let y = 186;
  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(11).text(L.quoteFor, 54, y);
  doc.font('Helvetica').fontSize(13).fillColor(CHARCOAL)
    .text((customer && customer.full_name) || '—', 54, y + 15);
  if (customer && customer.email) {
    doc.fillColor(CHARCOAL_SOFT).fontSize(10).text(customer.email, 54, y + 34);
  }
  if (customer && customer.phone) {
    doc.fillColor(CHARCOAL_SOFT).fontSize(10).text(customer.phone, 54, y + 48);
  }

  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(11).text(L.moveDate, 310, y);
  doc.font('Helvetica').fontSize(13).text(fmtDate(lead.move_date), 310, y + 15);

  // Divider
  y = 258;
  doc.strokeColor(GRAY_200).lineWidth(1).moveTo(54, y).lineTo(pageW - 54, y).stroke();

  // ===== Route row =====
  y += 18;
  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(10).text(L.from, 54, y);
  doc.font('Helvetica').fontSize(11).text(ZONE_LABELS[lead.from_zone] || lead.from_zone || '—', 54, y + 14);

  doc.font('Helvetica-Bold').fontSize(10).text(L.to, 240, y);
  doc.font('Helvetica').fontSize(11).text(ZONE_LABELS[lead.to_zone] || lead.to_zone || '—', 240, y + 14);

  doc.font('Helvetica-Bold').fontSize(10).text(L.size, 420, y);
  doc.font('Helvetica').fontSize(11).text(SIZE_LABELS[lead.size] || lead.size || '—', 420, y + 14);

  // ===== Summary box =====
  y += 46;
  const boxY = y;
  const boxH = 210;
  doc.rect(54, boxY, innerW, boxH).fill(SAND);

  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(14).text(L.summary, 70, boxY + 14);

  const movers = Number(quote.crew_size || 2);
  const hours = Number(quote.estimated_hours || 0);
  const rate = Number(quote.hourly_rate || 75);
  const truckIncluded = !!quote.truck_included;
  const truckFee = truckIncluded ? Number(quote.truck_fee || 275) : 0;
  const deposit = Number(quote.deposit_amount || (truckIncluded ? 125 : 50));
  const total = Number(quote.total || 0);

  let rowY = boxY + 46;
  function row(label, value) {
    doc.fillColor(CHARCOAL_SOFT).font('Helvetica').fontSize(11).text(label, 70, rowY);
    doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(11)
      .text(value, 70, rowY, { width: innerW - 32, align: 'right' });
    rowY += 22;
  }
  row(L.crew, `${movers}`);
  row(L.hours, `${hours} h`);
  row(L.rate, `${fmtMoney(rate)} ${L.perMoverHr}`);
  row(L.truck, truckIncluded ? `+ ${fmtMoney(truckFee)}` : L.notIncluded);
  row(L.deposit, fmtMoney(deposit));

  // Divider inside box
  rowY += 6;
  doc.strokeColor(GRAY_200).lineWidth(1).moveTo(70, rowY).lineTo(pageW - 70, rowY).stroke();
  rowY += 14;

  doc.fillColor(CHARCOAL).font('Helvetica-Bold').fontSize(14).text(L.total, 70, rowY);
  doc.fillColor(TORO_RED).font('Helvetica-Bold').fontSize(22)
    .text(fmtMoney(total), 70, rowY - 4, { width: innerW - 32, align: 'right' });

  // ===== Fine print =====
  y = boxY + boxH + 22;
  doc.fillColor(CHARCOAL_SOFT).font('Helvetica').fontSize(10);
  for (const p of L.fineprint) {
    doc.text('• ' + p, 54, y, { width: innerW });
    y = doc.y + 4;
  }

  // ===== CTA =====
  y += 10;
  doc.fillColor(TORO_RED).font('Helvetica-Bold').fontSize(12)
    .text(L.cta, 54, y, { width: innerW });

  // ===== Footer =====
  const footerY = doc.page.height - 46;
  doc.fillColor(GRAY_500).font('Helvetica').fontSize(9)
    .text('TORO MOVERS · Orlando, FL · (689) 600-2720 · toromovers.net', 54, footerY, {
      width: innerW, align: 'center',
    });

  doc.end();
  return done;
}

module.exports = { renderQuotePdf };
