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
    if (titleInput) titleInput.hidden = type === 'monthly' || type === 'impact';
}

function generateReport() {
    if (!APP.filterState || !APP.rawData.length) {
        alert('Upload dan proses data dashboard terlebih dahulu.');
        return;
    }

    const type = document.getElementById('report-type')?.value || 'location';
    const titleInput = document.getElementById('report-custom-title');
    const customTitle = titleInput?.value.trim() || '';
    if (type !== 'monthly' && type !== 'impact' && !customTitle) {
        alert('Masukkan judul report terlebih dahulu.');
        titleInput?.focus();
        return;
    }
    if (titleInput) titleInput.hidden = type === 'monthly' || type === 'impact';

    const selected = APP.filterState.selected;
    if (type === 'impact') {
        const rows = selectReportRows(APP.rawData, selected, null, null);
        const impact = calculateAdsImpactReport(rows);
        if (impact.error) {
            alert(impact.error);
            return;
        }

        const reportTitle = 'Analisis Dampak Ads';
        const report = document.getElementById('report-page');
        report.innerHTML = renderAdsImpactReport(reportTitle, impact);
        document.getElementById('view-upload').style.display = 'none';
        document.getElementById('view-dashboard').style.display = 'none';
        document.getElementById('view-report').style.display = 'block';
        document.title = `${reportTitle} | Meta Ads`;
        window.scrollTo(0, 0);
        return;
    }

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

function calculateAdsImpactReport(rows) {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const weekKeyFor = row => startOfDay(getMonday(row.date)).getTime();
    const shiftWeeks = (weekKey, count) => {
        const shifted = new Date(weekKey);
        shifted.setDate(shifted.getDate() + count * 7);
        return startOfDay(shifted).getTime();
    };
    const activeWeekKeys = [...new Set(
        rows.filter(row => row.isActive).map(weekKeyFor)
    )].sort((a, b) => a - b);

    if (!activeWeekKeys.length) {
        return { error: 'Tidak ditemukan minggu dengan Actual Spend lebih dari 0 untuk filter yang dipilih.' };
    }

    const adStart = activeWeekKeys[0];
    const adEnd = activeWeekKeys[activeWeekKeys.length - 1];
    const comparisonWeeks = Math.round((adEnd - adStart) / weekMs) + 1;
    const beforeStart = shiftWeeks(adStart, -comparisonWeeks);
    const afterEnd = shiftWeeks(adStart, comparisonWeeks);
    const observedWeekBounds = rows.reduce((bounds, row) => {
        const weekKey = weekKeyFor(row);
        return {
            min: Math.min(bounds.min, weekKey),
            max: Math.max(bounds.max, weekKey),
        };
    }, { min: Infinity, max: -Infinity });

    if (observedWeekBounds.min > beforeStart ||
        observedWeekBounds.max < shiftWeeks(afterEnd, -1)) {
        return {
            error: `Data harus mencakup ${comparisonWeeks} minggu sebelum dan ${comparisonWeeks} minggu mulai dari awal iklan.`,
        };
    }

    const weeklyTotals = new Map();
    const locationTotalsByName = new Map();
    rows.forEach(row => {
        const weekKey = weekKeyFor(row);
        if (weekKey < beforeStart || weekKey >= afterEnd) return;

        if (!weeklyTotals.has(weekKey)) {
            weeklyTotals.set(weekKey, { spend: 0, ttk: 0, kg: 0 });
        }
        const totals = weeklyTotals.get(weekKey);
        totals.spend += Number(row.actualSpend) || 0;
        totals.ttk += Number(row.ttk) || 0;
        totals.kg += Number(row.kg) || 0;

        const location = row.location || 'Tidak diketahui';
        if (!locationTotalsByName.has(location)) {
            locationTotalsByName.set(location, {
                beforeTTK: 0,
                beforeKG: 0,
                afterTTK: 0,
                afterKG: 0,
            });
        }
        const locationTotals = locationTotalsByName.get(location);
        const period = weekKey < adStart ? 'before' : 'after';
        locationTotals[`${period}TTK`] += Number(row.ttk) || 0;
        locationTotals[`${period}KG`] += Number(row.kg) || 0;
    });

    const getWeekTotals = weekKey => weeklyTotals.get(weekKey) || { spend: 0, ttk: 0, kg: 0 };
    const beforeWeeks = [];
    const afterWeeks = [];
    for (let index = 0; index < comparisonWeeks; index++) {
        const beforeKey = shiftWeeks(beforeStart, index);
        const afterKey = shiftWeeks(adStart, index);
        beforeWeeks.push({ weekStart: new Date(beforeKey), ...getWeekTotals(beforeKey) });
        afterWeeks.push({ weekStart: new Date(afterKey), ...getWeekTotals(afterKey) });
    }

    const beforeEnd = new Date(adStart - 1);
    const afterLastDay = new Date(afterEnd);
    afterLastDay.setDate(afterLastDay.getDate() - 1);
    afterLastDay.setHours(23, 59, 59, 999);
    const locationTotals = [...locationTotalsByName].map(([location, totals]) => {
        const { beforeTTK, beforeKG, afterTTK, afterKG } = totals;
        const ttkChange = percentChange(afterTTK, beforeTTK);
        const kgChange = percentChange(afterKG, beforeKG);

        return {
            location,
            beforeTTK,
            beforeKG,
            afterTTK,
            afterKG,
            ttkChange,
            kgChange,
            improved: ttkChange !== null && ttkChange > 0 ? 1 : 0,
        };
    }).sort((a, b) => b.improved - a.improved || b.afterTTK - a.afterTTK || a.location.localeCompare(b.location));

    const beforeTTK = beforeWeeks.reduce((total, week) => total + week.ttk, 0);
    const beforeKG = beforeWeeks.reduce((total, week) => total + week.kg, 0);
    const afterTTK = afterWeeks.reduce((total, week) => total + week.ttk, 0);
    const afterKG = afterWeeks.reduce((total, week) => total + week.kg, 0);
    const totalSpend = afterWeeks.reduce((total, week) => total + week.spend, 0);

    return {
        comparisonWeeks,
        beforeStart: new Date(beforeStart),
        beforeEnd,
        adStart: new Date(adStart),
        afterLastDay,
        beforeWeeks,
        afterWeeks,
        locations: locationTotals,
        improvedLocations: locationTotals.reduce((total, item) => total + item.improved, 0),
        beforeTTK,
        beforeKG,
        afterTTK,
        afterKG,
        totalSpend,
        ttkChange: percentChange(afterTTK, beforeTTK),
        kgChange: percentChange(afterKG, beforeKG),
    };
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
            viewers: sum(groupRows, 'viewers'),
            clicks: sum(groupRows, 'linkClicks'),
            ctr: sum(groupRows, 'views') > 0 ? sum(groupRows, 'linkClicks') / sum(groupRows, 'views') * 100 : null,
            cvr: sum(groupRows, 'linkClicks') > 0 ? ttk / sum(groupRows, 'linkClicks') * 100 : null,
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

function renderAdsImpactReport(title, impact) {
    const ttkChange = formatImpactChange(impact.ttkChange);
    const kgChange = formatImpactChange(impact.kgChange);
    const headline = impact.improvedLocations > impact.locations.length / 2
        ? 'Performa TTK Meningkat Setelah Pemasangan Ads'
        : impact.improvedLocations > 0
            ? 'Performa TTK Meningkat di Sejumlah Lokasi'
            : 'Performa TTK Belum Meningkat Setelah Pemasangan Ads';
    const description = `${impact.improvedLocations} dari ${impact.locations.length} lokasi mengalami pertumbuhan TTK, dengan perubahan total sebesar ${ttkChange} dan KG sebesar ${kgChange}.`;
    const costPerTTK = impact.afterTTK > 0 ? impact.totalSpend / impact.afterTTK : null;
    const spendPerWeek = impact.totalSpend / Math.max(1, impact.comparisonWeeks);
    const periodStart = impact.beforeStart;
    const periodEnd = impact.afterLastDay;
    const insights = buildImpactInsights(impact);

    return `
        <div class="report-heading">
            <div>
                <div class="report-eyebrow">Campaign Report</div>
                <h1>${escapeReportHtml(title)}</h1>
            </div>
            <div class="report-meta">Complete · hasil ${formatReportDate(periodStart)} – ${formatReportDate(periodEnd)}<br>Data ${impact.comparisonWeeks * 2} minggu</div>
        </div>
        <section class="report-highlight">
            <span class="report-highlight-badge">COMPLETE</span>
            <div>
                <h2>${escapeReportHtml(headline)}</h2>
                <p>${escapeReportHtml(description)}</p>
            </div>
        </section>
        <div class="report-kpis">
            ${renderReportKpi('Total Pengeluaran', formatReportCurrency(impact.totalSpend), `${formatReportCurrency(spendPerWeek)} per minggu`)}
            ${renderReportKpi('Jumlah Periode Ads', `${impact.comparisonWeeks}`, 'Minggu')}
            ${renderReportKpi('Lokasi Meningkat', `${impact.improvedLocations}/${impact.locations.length}`, 'Lokasi dengan kenaikan TTK')}
            ${renderReportKpi('Biaya per TTK', formatReportCurrency(costPerTTK), '')}
        </div>
        <div class="report-metrics-strip report-impact-strip">
            ${renderImpactMetric(formatReportCount(impact.beforeTTK), 'TTK Sebelum Ads')}
            ${renderImpactMetric(formatReportCount(impact.beforeKG), 'KG Sebelum Ads', true)}
            ${renderImpactMetric(formatReportCount(impact.afterTTK), 'TTK Setelah Ads')}
            ${renderImpactMetric(formatReportCount(impact.afterKG), 'KG Setelah Ads', true)}
            ${renderImpactMetric(ttkChange, 'Pertumbuhan TTK')}
        </div>
        <section class="report-impact-trend">
            <h3>Perbandingan Sebelum dan Setelah Memasang Ads</h3>
            <p>Tren TTK selama ${impact.comparisonWeeks} minggu sebelum dan ${impact.comparisonWeeks} minggu setelah pemasangan ads.</p>
            ${renderImpactTrendChart(impact)}
        </section>
        <section class="report-impact-growth">
            <h3>Pertumbuhan TTK</h3>
            <div>${getImpactGrowthHighlights(impact.locations).map(item => {
                const tone = item.ttkChange === null ? 'unknown' : item.ttkChange > 0 ? 'positive' : 'negative';
                return `<span class="report-impact-growth-item report-impact-growth-${tone}">${escapeReportHtml(item.location)} ${item.ttkChange === null ? 'N/A' : formatImpactChange(item.ttkChange)}</span>`;
            }).join('')}</div>
        </section>
        <section class="report-bottom report-impact-bottom">
            <section>
                <h3>RINGKASAN</h3>
                ${insights.summary.map(renderReportPoint).join('')}
            </section>
            <section class="report-actions">
                <h3>REKOMENDASI</h3>
                ${insights.recommendations.map(renderReportPoint).join('')}
            </section>
        </section>
        <div class="report-impact-footer-rule" aria-hidden="true"></div>`;
}

function getImpactGrowthHighlights(locations) {
    const top = locations
        .filter(item => item.ttkChange !== null && item.ttkChange > 0)
        .sort((a, b) => b.ttkChange - a.ttkChange)
        .slice(0, 3);
    const bottom = locations
        .filter(item => item.ttkChange !== null && item.ttkChange < 0)
        .sort((a, b) => a.ttkChange - b.ttkChange)
        .slice(0, 3);
    return [...top, ...bottom];
}

function renderImpactMetric(value, label, highlighted = false) {
    return `<div class="${highlighted ? 'report-impact-metric-highlight' : ''}">
        <div class="report-metric-value">${escapeReportHtml(value)}</div>
        <div class="report-metric-label">${escapeReportHtml(label)}</div>
    </div>`;
}

function renderImpactTrendChart(impact) {
    const allWeeks = [...impact.beforeWeeks, ...impact.afterWeeks];
    if (!allWeeks.length) return '<div class="report-empty">Tidak ada data mingguan untuk ditampilkan.</div>';

    const width = 660;
    const height = 300;
    const left = 42;
    const right = 12;
    const top = 20;
    const bottom = 55;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maximum = Math.max(0, ...allWeeks.map(week => week.ttk));
    const magnitude = Math.pow(10, Math.floor(Math.log10(maximum || 1)));
    const yMaximum = Math.max(magnitude, Math.ceil(maximum / magnitude) * magnitude);
    const xFor = index => left + (allWeeks.length === 1 ? plotWidth / 2 : index * plotWidth / (allWeeks.length - 1));
    const yFor = value => top + plotHeight - (value / yMaximum) * plotHeight;
    const makePath = (weeks, offset) => weeks.map((week, index) =>
        `${index === 0 ? 'M' : 'L'} ${xFor(offset + index).toFixed(1)} ${yFor(week.ttk).toFixed(1)}`
    ).join(' ');
    const grid = Array.from({ length: 5 }, (_, index) => {
        const value = yMaximum * index / 4;
        const y = yFor(value);
        return `<g class="report-impact-grid">
            <line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}"></line>
            <text x="${left - 7}" y="${(y + 3).toFixed(1)}" text-anchor="end">${formatReportCount(value)}</text>
        </g>`;
    }).join('');
    const showEvery = Math.max(1, Math.ceil(allWeeks.length / 30));
    const labels = allWeeks.map((week, index) => {
        if (index % showEvery !== 0 && index !== allWeeks.length - 1) return '';
        const labelX = xFor(index) - 4;
        const labelY = top + plotHeight + 12;
        return `<text class="report-impact-week-label" x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="start" transform="rotate(45 ${labelX.toFixed(1)} ${labelY.toFixed(1)})">Week ${index + 1}</text>`;
    }).join('');
    const points = allWeeks.map((week, index) => {
        if (allWeeks.length > 32 && index % Math.ceil(allWeeks.length / 32) !== 0) return '';
        const x = xFor(index);
        const y = yFor(week.ttk);
        const labelY = Math.max(top + 10, y - 8);
        const anchor = index === 0 ? 'start' : index === allWeeks.length - 1 ? 'end' : 'middle';
        const color = index < impact.beforeWeeks.length ? '#f44336' : '#4385f5';
        return `<g fill="${color}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2"></circle><text class="report-impact-value-label" x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${anchor}">${formatReportCount(week.ttk)}</text></g>`;
    }).join('');
    const dividerX = xFor(impact.beforeWeeks.length - 0.5);
    const dividerLabel = `<text class="report-impact-divider-label" x="${dividerX.toFixed(1)}" y="${top - 8}" text-anchor="middle">Mulai Ads</text>`;

    return `<div class="report-impact-chart-wrap">
        <svg class="report-impact-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafik TTK mingguan sebelum dan setelah pemasangan ads">
            ${dividerLabel}
            ${grid}
            <line class="report-impact-axis" x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}"></line>
            <line class="report-impact-divider" x1="${dividerX.toFixed(1)}" y1="${top}" x2="${dividerX.toFixed(1)}" y2="${top + plotHeight}"></line>
            <path class="report-impact-line report-impact-line-before" d="${makePath(impact.beforeWeeks, 0)}"></path>
            <path class="report-impact-line report-impact-line-after" d="${makePath(impact.afterWeeks, impact.beforeWeeks.length)}"></path>
            ${points}
            ${labels}
        </svg>
        <div class="report-impact-legend"><span><i class="report-impact-legend-before"></i>Sebelum</span><span><i class="report-impact-legend-after"></i>Setelah</span></div>
    </div>`;
}

function buildImpactInsights(impact) {
    const improved = impact.locations
        .filter(item => item.ttkChange !== null && item.ttkChange > 0)
        .sort((a, b) => b.ttkChange - a.ttkChange);
    const declined = impact.locations
        .filter(item => item.ttkChange !== null && item.ttkChange < 0)
        .sort((a, b) => a.ttkChange - b.ttkChange);
    const volumeLeader = impact.locations
        .map(item => ({ ...item, ttkDelta: item.afterTTK - item.beforeTTK }))
        .sort((a, b) => b.ttkDelta - a.ttkDelta)[0];
    const weightChanges = impact.locations
        .filter(item => item.beforeTTK > 0 && item.afterTTK > 0)
        .map(item => {
            const beforeAverage = item.beforeKG / item.beforeTTK;
            const afterAverage = item.afterKG / item.afterTTK;
            return {
                ...item,
                beforeAverage,
                afterAverage,
                change: percentChange(afterAverage, beforeAverage),
            };
        })
        .filter(item => item.change !== null)
        .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const ttkVerb = impact.ttkChange == null ? 'belum dapat dibandingkan' :
        `${impact.ttkChange >= 0 ? 'naik' : 'turun'} ${formatReportPercentValue(Math.abs(impact.ttkChange))}%`;
    const kgVerb = impact.kgChange == null ? 'belum dapat dibandingkan' :
        `${impact.kgChange >= 0 ? 'meningkat' : 'menurun'} ${formatReportPercentValue(Math.abs(impact.kgChange))}%`;
    const improvedNames = improved.slice(0, 3).map(item => escapeReportHtml(item.location)).join(', ');
    const declinedNames = declined.slice(0, 4).map(item => escapeReportHtml(item.location)).join(', ');
    const summary = [
        `<strong>Mayoritas lokasi ${impact.improvedLocations > impact.locations.length / 2 ? 'tumbuh' : 'belum tumbuh'}.</strong> ${impact.improvedLocations} dari ${impact.locations.length} lokasi mencatat kenaikan TTK setelah pemasangan ads.`,
        `<strong>TTK dan KG ${impact.ttkChange > 0 && impact.kgChange > 0 ? 'meningkat' : 'berubah'}.</strong> Total TTK ${ttkVerb}, sementara KG ${kgVerb}.`,
        volumeLeader && volumeLeader.ttkDelta > 0
            ? `<strong>${escapeReportHtml(volumeLeader.location)} unggul secara volume.</strong> TTK bertambah ${formatReportCount(volumeLeader.ttkDelta)}, dari ${formatReportCount(volumeLeader.beforeTTK)} menjadi ${formatReportCount(volumeLeader.afterTTK)}.`
            : '<strong>Belum ada lokasi dengan kenaikan volume TTK.</strong> Tinjau kembali hasil per lokasi dan periode pengukuran.',
    ];
    const recommendations = [
        improved.length
            ? `<strong>Optimalkan lokasi unggulan.</strong> Pertahankan performa ${improvedNames}.`
            : '<strong>Evaluasi strategi ads.</strong> Belum ada lokasi yang menunjukkan kenaikan TTK dibanding periode sebelum ads.',
        declined.length
            ? `<strong>Evaluasi lokasi menurun.</strong> Tinjau strategi ads di ${declinedNames}.`
            : '<strong>Pantau konsistensi.</strong> Tidak ada lokasi dengan penurunan TTK pada periode pembanding.',
        weightChanges.length
            ? (() => {
                const item = weightChanges[0];
                const direction = item.change > 0 ? 'naik' : item.change < 0 ? 'turun' : 'tidak berubah';
                return `<strong>Tinjau berat rata-rata per resi.</strong> Di ${escapeReportHtml(item.location)}, nilainya ${direction} ${formatReportPercentValue(Math.abs(item.change))}% (${formatReportNumber(item.beforeAverage)} menjadi ${formatReportNumber(item.afterAverage)} KG per TTK).`;
            })()
            : '<strong>Lengkapi data pembanding.</strong> Pastikan TTK sebelum dan sesudah ads tersedia agar perubahan berat rata-rata per resi bisa dinilai.',
    ];

    return { summary, recommendations };
}

function formatImpactChange(value) {
    return value == null ? '—' : `${value > 0 ? '+' : ''}${formatReportPercentValue(value)}%`;
}

function renderReport(type, title, period, metrics, previousMetrics) {
    const monthly = type === 'monthly';
    const dimensionLabel = type === 'campaign' ? 'Konten (interval 2 minggu)' : 'Kota Asal';
    const heading = monthly ? title.replace('Report Bulanan — ', '') :
        title;
    const summary = buildReportSummary(type, metrics, previousMetrics);
    const actions = buildReportActions(type, metrics, previousMetrics);
    const monthlySpendDelta = monthly ? getMonthlyDelta(metrics.totalSpend, previousMetrics?.totalSpend, 'spend') : null;
    const monthlyTTKDelta = monthly ? getMonthlyDelta(metrics.totalTTK, previousMetrics?.totalTTK, 'volume') : null;
    const monthlyCostPerTTKDelta = monthly ? getMonthlyDelta(metrics.avgCostPerTTK, previousMetrics?.avgCostPerTTK, 'spend') : null;
    const monthlyKGDelta = monthly ? getMonthlyDelta(metrics.totalKG, previousMetrics?.totalKG, 'volume') : null;
    const averageKGPerTTK = metrics.totalTTK > 0 ? metrics.totalKG / metrics.totalTTK : null;
    const previousAverageKGPerTTK = previousMetrics?.totalTTK > 0
        ? previousMetrics.totalKG / previousMetrics.totalTTK
        : null;
    const monthlyAverageKGPerTTKDelta = monthly
        ? getMonthlyDelta(averageKGPerTTK, previousAverageKGPerTTK, 'volume')
        : null;
    const benchmarkLabel = metrics.avgCostPerTTK == null ? 'Belum ada TTK untuk menghitung rata-rata' :
        `${type === 'campaign' ? 'Setiap konten mewakili 14 hari berurutan dari awal rentang terpilih. ' : 'Skala logaritmik agar semua bar terbaca. '}Garis putus = rata-rata (${formatReportCurrency(metrics.avgCostPerTTK)}). Hijau: di bawah rata-rata · Kuning: sampai 2× · Merah: lebih dari 2×`;

    return `
        <div class="report-heading">
            <div>
                <div class="report-eyebrow">${monthly ? 'Monthly Report' : type === 'campaign' ? 'Ads Report' : 'Campaign Report'}</div>
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
        <div class="report-kpis${monthly ? ' report-kpis-monthly' : ''}">
            ${renderReportKpi('Total Pengeluaran', formatReportCurrency(metrics.totalSpend), monthly ? monthlySpendDelta.text : `${formatReportCurrency(metrics.totalSpend / Math.max(1, metrics.weeks))} rata-rata per minggu`, monthlySpendDelta?.tone)}
            ${renderReportKpi('Total TTK', formatReportNumber(metrics.totalTTK), monthly ? monthlyTTKDelta.text : `Biaya per TTK ${formatReportCurrency(metrics.avgCostPerTTK)}`, monthlyTTKDelta?.tone)}
            ${monthly ? renderReportKpi('Biaya per TTK', formatReportCurrency(metrics.avgCostPerTTK), monthlyCostPerTTKDelta.text, monthlyCostPerTTKDelta.tone) : ''}
            ${renderReportKpi('Total KG', formatReportNumber(metrics.totalKG), monthly ? monthlyKGDelta.text : `Biaya per KG ${formatReportCurrency(metrics.totalKG ? metrics.totalSpend / metrics.totalKG : null)}`, monthlyKGDelta?.tone)}
            ${renderReportKpi('Rata-rata KG per TTK', formatReportNumber(averageKGPerTTK), monthly
                ? monthlyAverageKGPerTTKDelta.text
                : 'Total KG ÷ Total TTK', monthlyAverageKGPerTTKDelta?.tone)}
        </div>
        <div class="report-metrics-strip">
            ${renderReportMetric(formatReportCount(metrics.totalViews), 'Views')}
            ${renderReportMetric(metrics.ctr == null ? '—' : formatReportPercent(metrics.ctr), 'CTR (Daya Tarik)', true)}
            ${renderReportMetric(formatReportCount(metrics.totalClicks), 'Link Clicks')}
            ${renderReportMetric(metrics.cvr == null ? '—' : formatReportPercent(metrics.cvr), 'CVR (Closing)', true)}
            ${renderReportMetric(formatReportCount(metrics.totalViewers), 'Viewers')}
        </div>
        <section class="report-chart">
            <h3>Biaya per TTK per ${escapeReportHtml(dimensionLabel)}: lebih rendah lebih baik</h3>
            <p class="report-chart-caption">${escapeReportHtml(benchmarkLabel)}</p>
            ${renderReportChart(metrics)}
        </section>
        ${type === 'campaign' ? renderEngagementTable(metrics) : ''}
        <div class="report-bottom">
            <section>
                <h3>RINGKASAN</h3>
                ${summary.points.map(renderReportPoint).join('')}
            </section>
            <section class="report-actions">
                <h3>REKOMENDASI</h3>
                ${actions.map(renderReportPoint).join('')}
            </section>
        </div>`;
}

function renderEngagementTable(metrics) {
    const rankedByCvr = metrics.items
        .filter(item => item.cvr != null)
        .slice()
        .sort((a, b) => b.cvr - a.cvr || a.intervalIndex - b.intervalIndex);
    const highlightCount = rankedByCvr.length >= 3
        ? Math.max(1, Math.floor(rankedByCvr.length * 0.3))
        : 0;
    const topCount = highlightCount;
    const bottomCount = highlightCount;
    const topItems = new Set(rankedByCvr.slice(0, topCount));
    const bottomItems = new Set(bottomCount ? rankedByCvr.slice(-bottomCount) : []);
    const rows = metrics.items.map(item => {
        const highlightClass = topItems.has(item) ? ' report-engagement-top' :
            bottomItems.has(item) ? ' report-engagement-bottom' : '';
        return `<tr class="report-engagement-row${highlightClass}">
        <td><strong>${escapeReportHtml(item.label)}</strong><span class="report-engagement-date">${escapeReportHtml(item.dateLabel)}</span></td>
        <td>${formatReportCount(item.views)}</td>
        <td>${formatReportCount(item.viewers)}</td>
        <td>${formatReportCount(item.clicks)}</td>
        <td>${item.ctr == null ? '—' : formatReportPercent(item.ctr)}</td>
        <td>${formatReportCount(item.ttk)}</td>
        <td>${item.cvr == null ? '—' : formatReportPercent(item.cvr)}</td>
    </tr>`;
    }).join('');
    const rankingLabels = [
        topCount ? `<span><span class="report-engagement-swatch report-engagement-swatch-top" aria-hidden="true"></span>${topCount} CVR Tertinggi</span>` : '',
        bottomCount ? `<span><span class="report-engagement-swatch report-engagement-swatch-bottom" aria-hidden="true"></span>${bottomCount} CVR Terendah</span>` : '',
    ].filter(Boolean).join('');

    return `<section class="report-engagement">
        <h3>RINCIAN ENGAGEMENT PER KONTEN</h3>
        <div class="report-engagement-wrap"><table class="report-engagement-table">
            <thead><tr><th>Konten</th><th>Views</th><th>Viewers</th><th>Link Clicks</th><th>CTR</th><th>TTK</th><th>CVR</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
        ${rankingLabels ? `<div class="report-engagement-legend">${rankingLabels}</div>` : ''}
    </section>`;
}

function renderReportKpi(label, value, note, noteTone = '') {
    return `<div class="report-kpi">
        <div class="report-kpi-label">${escapeReportHtml(label)}</div>
        <div class="report-kpi-value">${escapeReportHtml(value)}</div>
        ${note ? `<div class="report-kpi-note${noteTone ? ` report-kpi-note-${noteTone}` : ''}">${escapeReportHtml(note)}</div>` : ''}
    </div>`;
}

function renderReportMetric(value, label, highlighted = false) {
    return `<div${highlighted ? ' class="report-metric-highlight"' : ''}><div class="report-metric-value">${escapeReportHtml(value)}</div><div class="report-metric-label">${escapeReportHtml(label)}</div></div>`;
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
    return getMonthlyDelta(current, previous, type).text;
}

function getMonthlyDelta(current, previous, type) {
    if (current == null || previous == null) {
        return {
            text: 'Data pembanding tidak tersedia',
            tone: '',
        };
    }
    const change = percentChange(current, previous);
    if (change == null) return {
        text: 'Tidak dapat dibandingkan (nilai dasar 0)',
        tone: '',
    };
    if (change === 0) {
        return {
            text: '• 0,00% vs pembanding',
            tone: 'neutral',
        };
    }

    const improved = type === 'volume' ? change > 0 : change < 0;
    return {
        text: `${improved ? '▲' : '▼'} ${formatReportPercentValue(Math.abs(change))}% vs pembanding`,
        tone: improved ? 'positive' : 'negative',
    };
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

function formatReportCount(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
    return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Number(value));
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
