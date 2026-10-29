// ============================================
// report.js — Printable PDF reports
// ============================================

document.addEventListener('DOMContentLoaded', setupReportGenerator);

function setupReportGenerator() {
    const button = document.getElementById('btn-generate-report');
    const backButton = document.getElementById('btn-report-back');
    const printButton = document.getElementById('btn-report-print');
    const typeSelect = document.getElementById('report-type');

    button?.addEventListener('click', generateReport);
    backButton?.addEventListener('click', closeReport);
    printButton?.addEventListener('click', () => window.print());
    typeSelect?.addEventListener('change', updateReportTitleControl);
    updateReportTitleControl();
}

function updateReportTitleControl() {
    const titleInput = document.getElementById('report-custom-title');
    const type = document.getElementById('report-type')?.value;
    if (titleInput) titleInput.hidden = type === 'monthly';
}

function generateReport() {
    if (!APP.filterState || !APP.rawData.length) {
        alert('Upload dan proses data dashboard terlebih dahulu.');
        return;
    }

    const type = document.getElementById('report-type')?.value || 'location';
    const titleInput = document.getElementById('report-custom-title');
    const customTitle = titleInput?.value.trim() || '';
    if (type !== 'monthly' && !customTitle) {
        alert('Masukkan judul report terlebih dahulu.');
        titleInput?.focus();
        return;
    }
    if (titleInput) titleInput.hidden = type === 'monthly';

    const selected = APP.filterState.selected;
    let rows;
    let previousRows = [];
    let reportTitle;
    let periodLabel;
    let reportStart;
    let reportEnd;

    if (type === 'monthly') {
        rows = selectReportRows(APP.rawData, selected, selected.dateStart, selected.dateEnd);
        const activeRows = rows.filter(row => row.isActive);
        if (!activeRows.length) {
            alert('Tidak ada data aktif pada rentang tanggal yang dipilih untuk report bulanan.');
            return;
        }
        reportStart = selected.dateStart || getDateBoundary(activeRows, 'start');
        reportEnd = selected.dateEnd || getDateBoundary(activeRows, 'end');
        const previousStart = shiftDateByMonths(reportStart, -1);
        const previousEnd = shiftDateByMonths(reportEnd, -1);
        previousRows = selectReportRows(APP.rawData, selected, previousStart, previousEnd);
        reportTitle = `Report Bulanan — ${formatReportPeriodTitle(reportStart, reportEnd)}`;
        periodLabel = `Periode ${formatReportDate(reportStart)} – ${formatReportDate(reportEnd)} · Pembanding ${formatReportDate(previousStart)} – ${formatReportDate(previousEnd)}`;
    } else {
        rows = selectReportRows(APP.rawData, selected, selected.dateStart, selected.dateEnd);
        reportStart = selected.dateStart || getDateBoundary(rows, 'start');
        reportEnd = selected.dateEnd || getDateBoundary(rows, 'end');
        periodLabel = `${formatReportDate(reportStart)} – ${formatReportDate(reportEnd)}`;
        reportTitle = customTitle;
    }

    const metrics = type === 'campaign'
        ? calculateReportMetrics(rows, 'contentPeriod', { startDate: reportStart, endDate: reportEnd })
        : calculateReportMetrics(rows, 'location');
    if (!metrics || metrics.totalActiveRows === 0) {
        alert('Tidak ada data aktif untuk dibuatkan report pada pilihan ini.');
        return;
    }

    const previousMetrics = type === 'monthly' ? calculateReportMetrics(previousRows, 'location') : null;
    const report = document.getElementById('report-page');
    report.innerHTML = renderReport(type, reportTitle, periodLabel, metrics, previousMetrics);

    document.getElementById('view-upload').style.display = 'none';
    document.getElementById('view-dashboard').style.display = 'none';
    document.getElementById('view-report').style.display = 'block';
    document.title = `${reportTitle} | Meta Ads`;
    window.scrollTo(0, 0);
}

function closeReport() {
    document.getElementById('view-report').style.display = 'none';
    document.getElementById('view-dashboard').style.display = 'block';
    document.title = 'Meta Ads Analytics Dashboard — Wahana Express';
}

function selectReportRows(data, selected, dateStart, dateEnd) {
    const start = dateStart ? startOfDay(dateStart).getTime() : -Infinity;
    const end = dateEnd ? endOfDay(dateEnd).getTime() : Infinity;

    return data.filter(row => {
        const time = row.date.getTime();
        if (time < start || time > end) return false;
        if (selected.campaigns.length && !selected.campaigns.includes(row.campaign)) return false;
        if (selected.locations.length && !selected.locations.includes(row.location)) return false;
        return true;
    });
}

function calculateReportMetrics(rows, dimension, options = {}) {
    if (!rows.length) return null;

    const active = rows.filter(row => row.isActive);
    const sum = (items, key) => items.reduce((total, row) => total + (Number(row[key]) || 0), 0);
    const totalSpend = sum(active, 'actualSpend');
    const totalTTK = sum(active, 'ttk');
    const totalKG = sum(active, 'kg');
    const totalViews = sum(active, 'views');
    const totalViewers = sum(active, 'viewers');
    const totalClicks = sum(active, 'linkClicks');
    const groups = new Map();
    const weeks = new Set(active.map(row => {
        const date = new Date(row.date);
        const dayOffset = (date.getDay() + 6) % 7;
        date.setDate(date.getDate() - dayOffset);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    })).size;

    if (dimension === 'contentPeriod') {
        const intervals = createContentIntervals(options.startDate, options.endDate);
        intervals.forEach(interval => groups.set(interval.label, { rows: [], interval }));
        active.forEach(row => {
            const interval = intervals.find(candidate =>
                row.date >= candidate.startDate && row.date <= candidate.endDate
            );
            if (interval) groups.get(interval.label).rows.push(row);
        });
    } else {
        active.forEach(row => {
            const label = row[dimension] || 'Tidak diketahui';
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(row);
        });
    }

    const items = [...groups.entries()]
    .filter(([, group]) => dimension !== 'contentPeriod' || group.rows.length > 0)
    .map(([label, group], index) => {
        const groupRows = dimension === 'contentPeriod' ? group.rows : group;
        const spend = sum(groupRows, 'actualSpend');
        const ttk = sum(groupRows, 'ttk');
        return {
            label: dimension === 'contentPeriod' ? `Konten ${index + 1}` : label,
            dateLabel: dimension === 'contentPeriod'
                ? `${formatReportDate(group.interval.startDate)} – ${formatReportDate(group.interval.endDate)}`
                : null,
            intervalIndex: dimension === 'contentPeriod' ? group.interval.index : null,
            spend,
            ttk,
            kg: sum(groupRows, 'kg'),
            views: sum(groupRows, 'views'),
            clicks: sum(groupRows, 'linkClicks'),
            costPerTTK: ttk > 0 ? spend / ttk : null,
        };
    }).sort((a, b) => {
        if (dimension === 'contentPeriod') return a.intervalIndex - b.intervalIndex;
        if (a.costPerTTK == null) return 1;
        if (b.costPerTTK == null) return -1;
        return a.costPerTTK - b.costPerTTK;
        });

    return {
        totalSpend,
        totalTTK,
        totalKG,
        totalViews,
        totalViewers,
        totalClicks,
        ctr: totalViews > 0 ? totalClicks / totalViews * 100 : null,
        cvr: totalClicks > 0 ? totalTTK / totalClicks * 100 : null,
        avgCostPerTTK: totalTTK > 0 ? totalSpend / totalTTK : null,
        weeks,
        items,
        totalActiveRows: active.length,
    };
}

function renderReport(type, title, period, metrics, previousMetrics) {
    const monthly = type === 'monthly';
    const dimensionLabel = type === 'campaign' ? 'Konten (interval 2 minggu)' : 'Kota Asal';
    const heading = monthly ? title.replace('Report Bulanan — ', '') :
        title;
    const summary = buildReportSummary(type, metrics, previousMetrics);
    const actions = buildReportActions(type, metrics, previousMetrics);
    const benchmarkLabel = metrics.avgCostPerTTK == null ? 'Belum ada TTK untuk menghitung rata-rata' :
        `${type === 'campaign' ? 'Setiap konten mewakili 14 hari berurutan dari awal rentang terpilih. ' : 'Skala logaritmik agar semua bar terbaca. '}Garis putus = rata-rata (${formatReportCurrency(metrics.avgCostPerTTK)}). Hijau: di bawah rata-rata · Kuning: sampai 2× · Merah: lebih dari 2×`;

    return `
        <div class="report-heading">
            <div>
                <div class="report-eyebrow">${monthly ? 'Monthly Report' : type === 'campaign' ? 'Content Report' : 'Campaign Report'}</div>
                <h1>${escapeReportHtml(heading)}</h1>
            </div>
            <div class="report-meta">${escapeReportHtml(period)}<br>Data ${formatReportNumber(metrics.items.length)} ${type === 'campaign' ? 'periode konten' : 'lokasi'}</div>
        </div>
        <section class="report-highlight">
            <span class="report-highlight-badge">${monthly ? 'RINGKASAN BULANAN' : 'COMPLETE'}</span>
            <div>
                <h2>${escapeReportHtml(summary.headline)}</h2>
                <p>${escapeReportHtml(summary.description)}</p>
            </div>
        </section>
        <div class="report-kpis">
            ${renderReportKpi('Total Pengeluaran', formatReportCurrency(metrics.totalSpend), monthly ? monthlyDelta(metrics.totalSpend, previousMetrics?.totalSpend, 'spend') : `${formatReportCurrency(metrics.totalSpend / Math.max(1, metrics.weeks))} rata-rata per minggu`)}
            ${renderReportKpi('Total TTK', formatReportNumber(metrics.totalTTK), monthly ? monthlyDelta(metrics.totalTTK, previousMetrics?.totalTTK, 'volume') : `${formatReportNumber(metrics.totalTTK / Math.max(1, metrics.weeks))} rata-rata per minggu`)}
            ${renderReportKpi('Biaya per TTK', formatReportCurrency(metrics.avgCostPerTTK), monthly ? monthlyDelta(metrics.avgCostPerTTK, previousMetrics?.avgCostPerTTK, 'spend') : 'Semakin rendah semakin efisien')}
            ${renderReportKpi('Total KG', formatReportNumber(metrics.totalKG), monthly ? monthlyDelta(metrics.totalKG, previousMetrics?.totalKG, 'volume') : `Biaya per KG ${formatReportCurrency(metrics.totalKG ? metrics.totalSpend / metrics.totalKG : null)}`)}
        </div>
        <div class="report-metrics-strip">
            ${renderReportMetric(formatReportNumber(metrics.totalViews), 'Views')}
            ${renderReportMetric(metrics.ctr == null ? '—' : formatReportPercent(metrics.ctr), 'CTR (Daya Tarik)')}
            ${renderReportMetric(formatReportNumber(metrics.totalClicks), 'Link Clicks')}
            ${renderReportMetric(metrics.cvr == null ? '—' : formatReportPercent(metrics.cvr), 'CVR (Closing)')}
            ${renderReportMetric(formatReportNumber(metrics.totalViewers), 'Viewers')}
        </div>
        <section class="report-chart">
            <h3>Biaya per TTK per ${escapeReportHtml(dimensionLabel)}: lebih rendah lebih baik</h3>
            <p class="report-chart-caption">${escapeReportHtml(benchmarkLabel)}</p>
            ${renderReportChart(metrics)}
        </section>
        <div class="report-bottom">
            <section>
                <h3>RINGKASAN</h3>
                ${summary.points.map(renderReportPoint).join('')}
            </section>
            <section class="report-actions">
                <h3>YANG PERLU DILAKUKAN</h3>
                ${actions.map(renderReportPoint).join('')}
            </section>
        </div>`;
}

function renderReportKpi(label, value, note) {
    return `<div class="report-kpi">
        <div class="report-kpi-label">${escapeReportHtml(label)}</div>
        <div class="report-kpi-value">${escapeReportHtml(value)}</div>
        <div class="report-kpi-note">${escapeReportHtml(note)}</div>
    </div>`;
}

function renderReportMetric(value, label) {
    return `<div><div class="report-metric-value">${escapeReportHtml(value)}</div><div class="report-metric-label">${escapeReportHtml(label)}</div></div>`;
}

function renderReportChart(metrics) {
    const items = metrics.items;
    if (!items.length) return '<div class="report-empty">Tidak ada data untuk ditampilkan.</div>';
    const validCosts = items.map(item => item.costPerTTK).filter(cost => cost != null && cost > 0);
    const minCost = validCosts.length ? Math.min(...validCosts) : 0;
    const maxCost = validCosts.length ? Math.max(...validCosts) : 0;
    const maxSpend = metrics.totalSpend || 1;
    const maxTTK = metrics.totalTTK || 1;
    const avg = metrics.avgCostPerTTK || 0;
    const logPosition = value => {
        if (!(value > 0) || !validCosts.length) return 0;
        if (maxCost === minCost) return 100;
        const range = Math.log(maxCost / minCost);
        return range > 0 ? Math.max(0, Math.min(100, Math.log(value / minCost) / range * 100)) : 100;
    };
    const rows = items.map(item => {
        const cost = item.costPerTTK;
        const ratio = cost == null || avg === 0 ? 0 : cost / avg;
        const color = cost == null ? '#94a3b8' : ratio <= 1 ? '#168342' : ratio <= 2 ? '#f2b900' : '#e55353';
        const width = logPosition(cost);
        const averagePosition = avg > 0 ? logPosition(avg) : null;
        return `<div class="report-row">
            <div class="report-row-label" title="${escapeReportHtml(item.label)}">${escapeReportHtml(item.label)}${item.dateLabel ? `<span class="report-row-date">${escapeReportHtml(item.dateLabel)}</span>` : ''}</div>
            <div class="report-bar-track${averagePosition == null ? ' no-average' : ''}"${averagePosition == null ? '' : ` style="--average-position:${averagePosition.toFixed(1)}%"`}><div class="report-bar" style="width:${width.toFixed(1)}%;background:${color}"></div></div>
            <div class="report-row-cost">${cost == null ? '—' : escapeReportHtml(formatReportCurrency(cost))}</div>
            <div class="report-row-share">${formatReportPercent(item.spend / maxSpend * 100)} biaya → ${formatReportPercent(item.ttk / maxTTK * 100)} TTK</div>
        </div>`;
    }).join('');

    return `<div class="report-chart-header"><div>${escapeReportHtml(items.length ? 'Nama' : '')}</div><div>Biaya per TTK</div><div></div><div>Porsi Biaya → TTK</div></div>${rows}`;
}

function buildReportSummary(type, metrics, previous) {
    const eligible = metrics.items
        .filter(item => item.costPerTTK != null && item.ttk > 0)
        .sort((a, b) => a.costPerTTK - b.costPerTTK);
    const best = eligible[0];
    const worst = eligible[eligible.length - 1];
    const label = type === 'campaign' ? 'Campaign' : 'wilayah';
    const headline = type === 'monthly' ? monthlyHeadline(metrics, previous) :
        best ? `${best.label} paling efisien: ${formatReportCurrency(best.costPerTTK)} per TTK` : 'Data belum cukup untuk menentukan efisiensi';
    const description = type === 'monthly'
        ? `Pengeluaran ${formatReportCurrency(metrics.totalSpend)} menghasilkan ${formatReportNumber(metrics.totalTTK)} TTK${previous && previous.totalActiveRows ? `, dibandingkan ${formatReportNumber(previous.totalTTK)} TTK pada periode pembanding.` : '. Data pembanding periode sebelumnya tidak tersedia.'}`
        : `Dari ${formatReportCurrency(metrics.totalSpend)} pengeluaran, tercatat ${formatReportNumber(metrics.totalTTK)} TTK dan ${formatReportNumber(metrics.totalKG)} KG.`;

    const points = [];
    if (best) points.push(`<strong>${escapeReportHtml(best.label)} paling efisien.</strong> Biaya per TTK ${escapeReportHtml(formatReportCurrency(best.costPerTTK))}, dengan kontribusi ${share(best.ttk, metrics.totalTTK)} dari total TTK.`);
    if (worst && worst !== best) points.push(`<strong>${escapeReportHtml(worst.label)} perlu dievaluasi.</strong> Biaya per TTK ${escapeReportHtml(formatReportCurrency(worst.costPerTTK))}, ${safeRatio(worst.costPerTTK, metrics.avgCostPerTTK)}.`);
    if (metrics.ctr != null && metrics.cvr != null) points.push(`<strong>Alur interaksi.</strong> CTR ${formatReportPercent(metrics.ctr)} dan CVR ${formatReportPercent(metrics.cvr)} dari ${formatReportNumber(metrics.totalClicks)} klik.`);
    if (type === 'monthly') {
        points.unshift(previous && previous.totalActiveRows
            ? `<strong>Perubahan periode.</strong> TTK ${monthlyDelta(metrics.totalTTK, previous.totalTTK, 'volume')}; biaya per TTK ${monthlyDelta(metrics.avgCostPerTTK, previous.avgCostPerTTK, 'spend')}.`
            : '<strong>Belum ada pembanding.</strong> Data periode sebelumnya tidak ditemukan untuk filter yang dipilih.');
    }
    if (!points.length) points.push(`Data ${escapeReportHtml(label)} belum cukup untuk menghasilkan perbandingan performa.`);
    return { headline, description, points: points.slice(0, 3) };
}

function buildReportActions(type, metrics, previous) {
    const eligible = metrics.items
        .filter(item => item.costPerTTK != null && item.ttk > 0)
        .sort((a, b) => a.costPerTTK - b.costPerTTK);
    const best = eligible[0];
    const worst = eligible[eligible.length - 1];
    const actions = [];
    if (type === 'monthly' && (!previous || !previous.totalActiveRows)) {
        actions.push('Unggah data bulan sebelumnya agar perubahan performa bulanan dapat dibandingkan.');
    } else if (type === 'monthly') {
        actions.push('Tinjau perubahan TTK dan biaya per TTK sebelum mengubah alokasi budget.');
    }
    if (best) actions.push(`Jadikan ${best.label} sebagai acuan efisiensi dan pelajari faktor performanya.`);
    if (worst && worst !== best) actions.push(`Evaluasi ${worst.label} sebelum menambah budget karena biaya per TTK berada di sisi tertinggi.`);
    if (type === 'campaign') actions.push('Gunakan interval dua minggu ini untuk membandingkan performa dan menguji variasi konten berikutnya.');
    else actions.push('Pantau CTR, CVR, dan biaya per TTK pada periode berikutnya sebelum mengubah strategi.');
    return actions.slice(0, 3).map(escapeReportHtml);
}

function renderReportPoint(text, index) {
    return `<div class="report-point"><span class="report-point-number">${index + 1}</span><div>${text}</div></div>`;
}

function monthlyHeadline(current, previous) {
    if (!previous || !previous.totalActiveRows) return 'Data periode terpilih siap ditinjau';
    const ttkChange = percentChange(current.totalTTK, previous.totalTTK);
    if (ttkChange == null || Math.abs(ttkChange) < 1) return 'Hasil relatif stabil dibanding periode pembanding';
    return ttkChange > 0 ? `TTK meningkat ${formatReportPercentValue(Math.abs(ttkChange))}% dibanding periode pembanding` :
        `TTK turun ${formatReportPercentValue(Math.abs(ttkChange))}% dibanding periode pembanding`;
}

function monthlyDelta(current, previous, type) {
    if (current == null || previous == null) return 'Data pembanding tidak tersedia';
    const change = percentChange(current, previous);
    if (change == null) return 'Tidak dapat dibandingkan (nilai dasar 0)';
    const better = type === 'volume' ? change >= 0 : change <= 0;
    const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '•';
    return `${arrow} ${formatReportPercentValue(Math.abs(change))}% vs periode pembanding · ${better ? 'membaik' : 'memburuk'}`;
}

function percentChange(current, previous) {
    if (current == null || previous == null || previous === 0) return null;
    return (current - previous) / Math.abs(previous) * 100;
}

function share(value, total) {
    return `${formatReportPercentValue(total ? value / total * 100 : 0)}%`;
}

function safeRatio(value, average) {
    if (!average) return 'belum bisa dibandingkan dengan rata-rata';
    return `${formatReportNumber(value / average)}× dari rata-rata`;
}

function formatReportNumber(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number(value)).replace(/,00$/, '');
}

function formatReportCurrency(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value))
        ? 'Rp -'
        : `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(Number(value)))}`;
}

function formatReportPercent(value) {
    return `${formatReportPercentValue(value)}%`;
}

function formatReportPercentValue(value) {
    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number(value));
}

function formatReportDate(date) {
    return date ? date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

function formatReportPeriodTitle(startDate, endDate) {
    if (startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth()) {
        return startDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    }
    return `${formatReportDate(startDate)} – ${formatReportDate(endDate)}`;
}

function shiftDateByMonths(date, amount) {
    const shifted = new Date(date);
    const day = shifted.getDate();
    shifted.setDate(1);
    shifted.setMonth(shifted.getMonth() + amount);
    const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
    shifted.setDate(Math.min(day, lastDay));
    return shifted;
}

function getDateBoundary(rows, boundary) {
    if (!rows.length) return null;
    return rows.reduce((result, row) => {
        if (!result) return row.date;
        return boundary === 'start'
            ? (row.date < result ? row.date : result)
            : (row.date > result ? row.date : result);
    }, null);
}

function createContentIntervals(startDate, endDate) {
    if (!startDate || !endDate || startDate > endDate) return [];

    const intervals = [];
    const start = startOfDay(startDate);
    const end = endOfDay(endDate);
    const cursor = new Date(start);

    while (cursor <= end) {
        const intervalStart = new Date(cursor);
        const intervalEnd = new Date(cursor);
        intervalEnd.setDate(intervalEnd.getDate() + 13);
        intervalEnd.setHours(23, 59, 59, 999);
        if (intervalEnd > end) intervalEnd.setTime(end.getTime());

        intervals.push({
            index: intervals.length + 1,
            label: `Konten ${intervals.length + 1}`,
            startDate: intervalStart,
            endDate: intervalEnd,
        });

        cursor.setDate(cursor.getDate() + 14);
        cursor.setHours(0, 0, 0, 0);
    }

    return intervals;
}

function startOfDay(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

function endOfDay(date) {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
}

function escapeReportHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}
