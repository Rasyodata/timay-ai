import { useState, type ReactNode } from 'react';
import { Card, Field, PageHeader, Tabs, formatDate, today } from './ui';

/*
 * Avukatın günlük hesapları. Hesaplar bu bilgisayarda yapılır; oranlar ve tavanlar değiştiğinde
 * kullanıcı kutudaki değeri güncelleyebilir.
 */

const DAY = 86_400_000;

function num(text: string) {
  const clean = text.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

function tl(n: number) {
  return n.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function days(from: string, to: string) {
  if (!from || !to) return 0;
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY));
}

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`calc-row ${strong ? 'strong' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function CalculatorsView() {
  const [tab, setTab] = useState<'faiz' | 'kidem' | 'mesai' | 'smm'>('faiz');
  return (
    <div className="page">
      <PageHeader title="Hesaplayıcılar" subtitle="Faiz, kıdem ve ihbar tazminatı, fazla mesai ve serbest meslek makbuzu" />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          ['faiz', 'Faiz'],
          ['kidem', 'Kıdem ve ihbar'],
          ['mesai', 'Fazla mesai'],
          ['smm', 'Serbest meslek makbuzu'],
        ]}
      />
      {tab === 'faiz' && <InterestCalc />}
      {tab === 'kidem' && <SeveranceCalc />}
      {tab === 'mesai' && <OvertimeCalc />}
      {tab === 'smm' && <ReceiptCalc />}
    </div>
  );
}

/** Yasal faiz dönemleri (3095 sayılı Kanun m.1; 1.6.2024'ten itibaren Cumhurbaşkanı Kararıyla %24). */
const LEGAL_RATES: { from: string; rate: number }[] = [
  { from: '2006-01-01', rate: 9 },
  { from: '2024-06-01', rate: 24 },
];

function InterestCalc() {
  const [principal, setPrincipal] = useState('100.000');
  const [start, setStart] = useState('2024-01-01');
  const [end, setEnd] = useState(today());
  const [mode, setMode] = useState<'yasal' | 'ozel'>('yasal');
  const [rate, setRate] = useState('24');

  const p = num(principal);
  const periods: { from: string; to: string; rate: number; days: number; interest: number }[] = [];
  if (start && end && start < end) {
    if (mode === 'ozel') {
      const d = days(start, end);
      periods.push({ from: start, to: end, rate: num(rate), days: d, interest: (p * num(rate) * d) / 36500 });
    } else {
      LEGAL_RATES.forEach((r, i) => {
        const next = LEGAL_RATES[i + 1]?.from ?? '9999-12-31';
        const from = start > r.from ? start : r.from;
        const to = end < next ? end : next;
        const d = days(from, to);
        if (d > 0) periods.push({ from, to, rate: r.rate, days: d, interest: (p * r.rate * d) / 36500 });
      });
    }
  }
  const interest = periods.reduce((s, x) => s + x.interest, 0);

  return (
    <div className="grid-main-side">
      <Card title="Faiz hesapla">
        <div className="form-grid">
          <Field label="Anapara (TL)">
            <input value={principal} onChange={(e) => setPrincipal(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Faiz türü">
            <select value={mode} onChange={(e) => setMode(e.target.value as 'yasal')}>
              <option value="yasal">Yasal faiz (dönemlere göre)</option>
              <option value="ozel">Sabit oran (ticari, temerrüt, sözleşme)</option>
            </select>
          </Field>
          <Field label="Başlangıç (temerrüt) tarihi">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Bitiş tarihi">
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          {mode === 'ozel' && (
            <Field label="Yıllık oran (%)">
              <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
            </Field>
          )}
        </div>
        <p className="muted small">
          Basit faiz, yıl 365 gün. Yasal faiz 1.6.2024'e kadar %9, sonrasında %24 uygulanır. Ticari işlerde avans faizi oranını “Sabit oran” ile girin.
        </p>
      </Card>
      <Card title="Sonuç" className="sticky">
        <div className="calc-table">
          {periods.map((x) => (
            <Row
              key={x.from}
              label={
                <>
                  {formatDate(x.from)} – {formatDate(x.to)} <span className="muted">· {x.days} gün · %{x.rate}</span>
                </>
              }
              value={tl(x.interest)}
            />
          ))}
          <Row label="Anapara" value={tl(p)} />
          <Row label="Faiz" value={tl(interest)} strong />
          <Row label="Toplam alacak" value={tl(p + interest)} strong />
        </div>
      </Card>
    </div>
  );
}

const STAMP = 0.00759;

/** 4857 s. Kanun m.17 bildirim süreleri. */
function noticeWeeks(totalDays: number) {
  const months = totalDays / 30;
  if (months < 6) return 2;
  if (months < 18) return 4;
  if (months < 36) return 6;
  return 8;
}

function SeveranceCalc() {
  const [startDate, setStartDate] = useState('2019-03-01');
  const [endDate, setEndDate] = useState(today());
  const [wage, setWage] = useState('45.000');
  const [ceiling, setCeiling] = useState('53.919,68');
  const [taxRate, setTaxRate] = useState('15');

  const total = days(startDate, endDate) + (startDate && endDate ? 1 : 0);
  const years = Math.floor(total / 365);
  const restDays = total - years * 365;
  const w = num(wage);
  const base = Math.min(w, num(ceiling));
  const severanceGross = total >= 365 ? (base * total) / 365 : 0;
  const severanceStamp = severanceGross * STAMP;
  const weeks = noticeWeeks(total);
  const noticeGross = (w / 30) * weeks * 7;
  const noticeTax = (noticeGross * num(taxRate)) / 100;
  const noticeStamp = noticeGross * STAMP;

  return (
    <div className="grid-main-side">
      <Card title="Kıdem ve ihbar tazminatı">
        <div className="form-grid">
          <Field label="İşe giriş tarihi">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="İşten çıkış tarihi">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Field label="Giydirilmiş brüt aylık ücret (TL)">
            <input value={wage} onChange={(e) => setWage(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Çıkış tarihindeki kıdem tavanı (TL)">
            <input value={ceiling} onChange={(e) => setCeiling(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="İhbar için gelir vergisi dilimi (%)">
            <input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
        <p className="muted small">
          Kutudaki tavan 1.7.2025–31.12.2025 dönemine aittir; çıkış tarihindeki güncel tavanı girin. Giydirilmiş ücrete yol, yemek, ikramiye gibi süreklilik
          arz eden ödemeleri ekleyin. Kıdem tazminatından yalnızca damga vergisi kesilir.
        </p>
      </Card>
      <Card title="Sonuç" className="sticky">
        <div className="calc-table">
          <Row label="Çalışma süresi" value={`${years} yıl ${restDays} gün`} />
          <div className="calc-head">Kıdem tazminatı</div>
          {total < 365 ? (
            <p className="warning small">Bir yıldan az çalışmada kıdem tazminatı doğmaz.</p>
          ) : (
            <>
              <Row label={`Esas ücret${w > num(ceiling) ? ' (tavanla sınırlı)' : ''}`} value={tl(base)} />
              <Row label="Brüt kıdem" value={tl(severanceGross)} />
              <Row label="Damga vergisi (‰7,59)" value={`− ${tl(severanceStamp)}`} />
              <Row label="Net kıdem" value={tl(severanceGross - severanceStamp)} strong />
            </>
          )}
          <div className="calc-head">İhbar tazminatı · {weeks} hafta</div>
          <Row label="Brüt ihbar" value={tl(noticeGross)} />
          <Row label={`Gelir vergisi (%${num(taxRate)})`} value={`− ${tl(noticeTax)}`} />
          <Row label="Damga vergisi" value={`− ${tl(noticeStamp)}`} />
          <Row label="Net ihbar" value={tl(noticeGross - noticeTax - noticeStamp)} strong />
        </div>
      </Card>
    </div>
  );
}

function OvertimeCalc() {
  const [wage, setWage] = useState('40.000');
  const [hours, setHours] = useState('10');
  const [weeks, setWeeks] = useState('52');
  const [premium, setPremium] = useState('50');

  const hourly = num(wage) / 225;
  const overtimeHourly = hourly * (1 + num(premium) / 100);
  const totalHours = num(hours) * num(weeks);
  const gross = overtimeHourly * totalHours;

  return (
    <div className="grid-main-side">
      <Card title="Fazla mesai alacağı">
        <div className="form-grid">
          <Field label="Brüt aylık ücret (TL)">
            <input value={wage} onChange={(e) => setWage(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Haftalık fazla mesai (saat)">
            <input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Fazla mesai yapılan hafta sayısı">
            <input value={weeks} onChange={(e) => setWeeks(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Zam oranı (%)">
            <input value={premium} onChange={(e) => setPremium(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
        <p className="muted small">
          Saatlik ücret aylık brüt ücretin 225’e bölünmesiyle bulunur (4857 s. Kanun m.41: haftalık 45 saati aşan çalışma %50 zamlı ödenir). Yıllık izin,
          rapor ve tatil haftalarını hafta sayısından düşün.
        </p>
      </Card>
      <Card title="Sonuç" className="sticky">
        <div className="calc-table">
          <Row label="Saatlik brüt ücret" value={tl(hourly)} />
          <Row label="Fazla mesai saat ücreti" value={tl(overtimeHourly)} />
          <Row label="Toplam fazla mesai" value={`${totalHours.toLocaleString('tr-TR')} saat`} />
          <Row label="Brüt fazla mesai alacağı" value={tl(gross)} strong />
        </div>
      </Card>
    </div>
  );
}

function ReceiptCalc() {
  const [amount, setAmount] = useState('10.000');
  const [mode, setMode] = useState<'brut' | 'net'>('brut');
  const [company, setCompany] = useState(true);
  const [vat, setVat] = useState('20');
  const [withholding, setWithholding] = useState('20');

  const w = company ? num(withholding) / 100 : 0;
  const gross = mode === 'brut' ? num(amount) : num(amount) / (1 - w);
  const stopaj = gross * w;
  const kdv = (gross * num(vat)) / 100;

  return (
    <div className="grid-main-side">
      <Card title="Serbest meslek makbuzu">
        <div className="form-grid">
          <Field label="Tutar (TL)">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Girilen tutar">
            <select value={mode} onChange={(e) => setMode(e.target.value as 'brut')}>
              <option value="brut">Brüt ücret</option>
              <option value="net">Elime geçecek net ücret</option>
            </select>
          </Field>
          <Field label="KDV (%)">
            <input value={vat} onChange={(e) => setVat(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Gelir vergisi stopajı (%)">
            <input value={withholding} onChange={(e) => setWithholding(e.target.value)} inputMode="decimal" disabled={!company} />
          </Field>
          <label className="switch-row wide">
            <input type="checkbox" checked={company} onChange={(e) => setCompany(e.target.checked)} />
            Müvekkil şirket ya da vergi kesintisi yapmakla yükümlü (stopaj kesilir)
          </label>
        </div>
      </Card>
      <Card title="Makbuz" className="sticky">
        <div className="calc-table">
          <Row label="Brüt ücret" value={tl(gross)} />
          <Row label={`Gelir vergisi stopajı (%${company ? num(withholding) : 0})`} value={`− ${tl(stopaj)}`} />
          <Row label="Net ücret" value={tl(gross - stopaj)} strong />
          <Row label={`KDV (%${num(vat)})`} value={`+ ${tl(kdv)}`} />
          <Row label="Müvekkilden tahsil edilecek" value={tl(gross - stopaj + kdv)} strong />
        </div>
        {company && <p className="muted small">Stopajı müvekkil vergi dairesine yatırır; makbuzda “tahsil edilen” tutar net ücret + KDV’dir.</p>}
      </Card>
    </div>
  );
}
