// ============================================
// data-loader.js — Excel Parser & Data Processor
// Port dari analysis_fixed.py
// ============================================

/**
 * Parse uploaded Excel file using SheetJS.
 * @param {File} file
 * @returns {Promise<Object[]>} Processed data rows
 */
async function parseExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
                const headerIdx = detectHeaderRow(rawRows);
                const headers = rawRows[headerIdx].map(h => (h != null ? String(h).trim() : ''));
                const dataRows = rawRows.slice(headerIdx + 1);
                let rows = buildRows(headers, dataRows);
                broadcastValues(rows);
                rows = expandToDailyRows(rows);
                resolve(rows);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('Gagal membaca file'));
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Detect header row index (cari baris "Location" + "Campaign").
 */
function detectHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
        const vals = (rows[i] || [])
            .filter(v => v != null)
            .map(v => String(v).toLowerCase().trim());
        if (vals.includes('location') && (vals.includes('campaign') || vals.includes('campaign title'))) return i;
        if (vals.includes('week') && vals.includes('total budget')) return i;
    }
    return 0;
}

/**
 * Map header names to column indices.
 */
function mapColumns(headers) {
    const m = {};
    headers.forEach((h, i) => {
        const l = h.toLowerCase().trim();
        if (l === 'location') m.location = i;
        if (l === 'campaign' || l === 'campaign title') m.campaign = i;
        if (l === 'region') m.region = i;
        if (l === 'date' || l === 'week') m.date = i;
        if (l === 'actual spend (aft. tax)' || l === 'actual spend') m.spend = i;
        if (l === 'budget per-week (bef. tax)' || l === 'total budget') m.budget = i;
        if (['total views', 'views'].includes(l)) m.views = i;
        if (['total viewers', 'viewers'].includes(l)) m.viewers = i;
        if (['total link clicks', 'link clicks'].includes(l)) m.linkClicks = i;
        if (['jumlah ttk', 'jumlah ttk', 'total ttk'].includes(l)) m.ttk = i;
        if (['jumlah kg', 'total kg'].includes(l)) m.kg = i;
    });
    return m;
}

/**
 * Build row objects from raw data, with forward-fill and cleaning.
 */
function buildRows(headers, dataRows) {
    const col = mapColumns(headers);
    const rows = [];
    let lastLocation = 'All';
    let lastCampaign = 'All';
    let lastRegion = 'All';

    for (const raw of dataRows) {
        if (!raw || raw.length === 0) continue;

        // Date handling
        const dateStr = raw[col.date] != null ? String(raw[col.date]).trim() : '';
        const dateParts = dateStr.split('-').map(s => s.trim());
        const startStr = dateParts[0] || '';
        const endStr = dateParts[dateParts.length - 1] || '';

        if (!/^\d{2}\/\d{2}\/\d{2}$/.test(startStr)) continue;

        const dateStart = parseDateDMY(startStr);
        const dateEnd = parseDateDMY(endStr);
        if (!dateStart) continue;

        // Forward-fill
        const loc = cellStr(raw[col.location]);
        const cam = cellStr(raw[col.campaign]);
        const reg = col.region !== undefined ? cellStr(raw[col.region]) : null;

        if (loc) lastLocation = loc;
        if (cam) lastCampaign = cam;
        if (reg) lastRegion = reg;

        rows.push({
            date: dateStart,
            dateEnd: dateEnd || dateStart,
            dateStr,
            campaign: lastCampaign,
            location: lastLocation,
            region: lastRegion,
            actualSpend: cleanCurrency(raw[col.spend]),
            budget: col.budget !== undefined ? cleanCurrency(raw[col.budget]) : null,
            views: col.views !== undefined ? parseNumeric(raw[col.views]) : null,
            viewers: col.viewers !== undefined ? parseNumeric(raw[col.viewers]) : null,
            linkClicks: col.linkClicks !== undefined ? parseNumeric(raw[col.linkClicks]) : null,
            ttk: col.ttk !== undefined ? parseNumeric(raw[col.ttk]) : null,
            kg: col.kg !== undefined ? parseNumeric(raw[col.kg]) : null,
            isKargo: lastCampaign.toLowerCase().includes('kargo'),
            isActive: false, // set below
        });
    }

    return rows;
}

function cellStr(val) {
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    if (s === '' || s.toLowerCase() === 'nan') return null;
    return s;
}

/**
 * Broadcast aggregated values to sub-locations (bagi rata).
 * Port dari analysis_fixed.py FIX 4.
 */
function broadcastValues(rows) {
    const groups = {};
    rows.forEach(r => {
        const key = `${r.campaign}||${r.dateStr}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
    });

    const cols = ['actualSpend', 'budget', 'views', 'viewers', 'linkClicks'];
    for (const key in groups) {
        const group = groups[key];
        const count = group.length;
        if (count <= 1) continue;

        for (const c of cols) {
            const first = group.find(r => r[c] !== null);
            if (first) {
                const val = first[c] / count;
                group.forEach(r => { r[c] = val; });
            }
        }
    }

    // Set isActive AFTER broadcast
    rows.forEach(r => {
        r.isActive = r.actualSpend !== null && r.actualSpend > 0;
    });
}

/**
 * Expand period rows (e.g. weekly) into daily rows for finer granularity.
 */
function expandToDailyRows(rows) {
    const dailyRows = [];
    rows.forEach(r => {
        let actualStartDate = new Date(r.date);
        let days = 1;
        
        // H+1 Logic: Jika ada rentang tanggal (beda hari), mulai sebar data di H+1
        if (r.date && r.dateEnd && r.date.getTime() < r.dateEnd.getTime()) {
            actualStartDate = new Date(r.date.getTime() + 24 * 60 * 60 * 1000); // Tambah 1 hari
            days = Math.round((r.dateEnd - actualStartDate) / (1000 * 60 * 60 * 24)) + 1;
        }
        
        if (days < 1) days = 1;

        for (let i = 0; i < days; i++) {
            const newDate = new Date(actualStartDate.getTime() + i * 24 * 60 * 60 * 1000);
            dailyRows.push({
                ...r,
                date: newDate,
                dateEnd: newDate,
                dateStr: toLocalYYYYMMDD(newDate),
                actualSpend: r.actualSpend !== null ? r.actualSpend / days : null,
                budget: r.budget !== null ? r.budget / days : null,
                views: r.views !== null ? r.views / days : null,
                viewers: r.viewers !== null ? r.viewers / days : null,
                linkClicks: r.linkClicks !== null ? r.linkClicks / days : null,
                ttk: r.ttk !== null ? r.ttk / days : null,
                kg: r.kg !== null ? r.kg / days : null,
            });
        }
    });
    return dailyRows;
}

// ============================================
// METRICS CALCULATION
// ============================================

/**
 * Calculate all metrics from processed (and filtered) data.
 */
function calculateMetrics(data, period = 'weekly') {
    if (data.length === 0) return null;

    // Filter out rows completely without campaign/location, but KEEP inactive rows (spend=0) 
    // so we can display "Tidak pasang ads" in period charts.
    const activeDataForTotals = data.filter(r => r.isActive);
    const mainRows = data; 
    
    if (mainRows.length === 0) return null;

    // Use activeDataForTotals for totals so we don't accidentally count empty rows in averages
    const totalSpend = sumField(activeDataForTotals, 'actualSpend');
    const totalTTK = sumField(activeDataForTotals, 'ttk');
    const totalKG = sumField(activeDataForTotals, 'kg');
    const totalViews = sumField(activeDataForTotals, 'views');
    const totalClicks = sumField(activeDataForTotals, 'linkClicks');
    const avgCostPerTTK = safeDiv(totalSpend, totalTTK) || 0;
    const avgCostPerKG = safeDiv(totalSpend, totalKG) || 0;
    const ctr = safeDiv(totalClicks, totalViews) != null ? safeDiv(totalClicks, totalViews) * 100 : 0;
    const cvr = safeDiv(totalTTK, totalClicks) != null ? safeDiv(totalTTK, totalClicks) * 100 : 0;

    const periodData = aggregateByPeriod(mainRows, period);
    const locationData = aggregateByLocation(mainRows);
    const quadrant = analyzeQuadrant(locationData);
    const recommendations = generateRecommendations(locationData, avgCostPerTTK);

    return {
        totalSpend, totalTTK, totalKG, totalViews, totalClicks,
        avgCostPerTTK, avgCostPerKG, ctr, cvr,
        periodData, locationData, quadrant, recommendations,
        trendSpend: calcTrend(periodData.map(p => p.totalSpend)),
        trendTTK: calcTrend(periodData.map(p => p.totalTTK)),
        trendKG: calcTrend(periodData.map(p => p.totalKG)),
        trendCostPerTTK: calcTrend(periodData.filter(p => p.costPerTTK != null).map(p => p.costPerTTK)),
        trendCTR: calcTrend(periodData.filter(p => p.ctr != null).map(p => p.ctr)),
        dateMin: data.reduce((m, r) => (r.date < m ? r.date : m), data[0].date),
        dateMax: data.reduce((m, r) => (r.date > m ? r.date : m), data[0].date),
        totalWeeks: new Set(data.map(r => getMonday(r.date).getTime())).size,
    };
}

function aggregateByPeriod(data, period) {
    const groups = {};
    data.forEach(r => {
        let key;
        let groupDate = r.date;
        if (period === 'monthly') {
            key = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}`;
            groupDate = new Date(r.date.getFullYear(), r.date.getMonth(), 1);
        } else if (period === 'yearly') {
            key = String(r.date.getFullYear());
            groupDate = new Date(r.date.getFullYear(), 0, 1);
        } else if (period === 'daily') {
            key = toLocalYYYYMMDD(r.date);
        } else {
            // weekly - group by Monday of that week
            groupDate = getMonday(r.date);
            key = toLocalYYYYMMDD(groupDate);
        }
        if (!groups[key]) groups[key] = { key, date: groupDate, rows: [] };
        groups[key].rows.push(r);
    });

    return Object.values(groups)
        .sort((a, b) => a.date - b.date)
        .map(g => {
            const s = sumField(g.rows, 'actualSpend');
            const t = sumField(g.rows, 'ttk');
            const k = sumField(g.rows, 'kg');
            const v = sumField(g.rows, 'views');
            const c = sumField(g.rows, 'linkClicks');
            
            const locationBreakdown = {};
            g.rows.forEach(r => {
                if (!locationBreakdown[r.location]) {
                    locationBreakdown[r.location] = { ttk: 0, kg: 0 };
                }
                locationBreakdown[r.location].ttk += (r.ttk || 0);
                locationBreakdown[r.location].kg += (r.kg || 0);
            });

            const isActivePeriod = g.rows.some(r => r.isActive);

            return {
                label: periodLabel(g.key, period, g.rows),
                key: g.key,
                isActivePeriod,
                totalSpend: s, totalTTK: t, totalKG: k, totalViews: v, totalClicks: c,
                costPerTTK: isActivePeriod ? safeDiv(s, t) : null,
                costPerKG: isActivePeriod ? safeDiv(s, k) : null,
                ctr: isActivePeriod && safeDiv(c, v) != null ? safeDiv(c, v) * 100 : null,
                cvr: isActivePeriod && safeDiv(t, c) != null ? safeDiv(t, c) * 100 : null,
                locationBreakdown: locationBreakdown,
            };
        });
}

function periodLabel(key, period, rows) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];
    if (period === 'monthly') {
        const [y, m] = key.split('-');
        return `${months[parseInt(m, 10) - 1]} ${y}`;
    }
    if (period === 'yearly') return key;
    
    const d = parseLocalYYYYMMDD(key);
    if (period === 'daily') {
        return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
    }
    
    // weekly
    if (rows && rows.length > 0) {
        let minTime = rows[0].date.getTime();
        let maxTime = rows[0].date.getTime();
        for (const r of rows) {
            const t = r.date.getTime();
            if (t < minTime) minTime = t;
            if (t > maxTime) maxTime = t;
        }
        const minDate = new Date(minTime);
        const maxDate = new Date(maxTime);
        
        if (minTime !== maxTime) {
            return `${String(minDate.getDate()).padStart(2, '0')} ${months[minDate.getMonth()]} - ${String(maxDate.getDate()).padStart(2, '0')} ${months[maxDate.getMonth()]}`;
        } else {
            return `${String(minDate.getDate()).padStart(2, '0')} ${months[minDate.getMonth()]}`;
        }
    }

    // fallback
    const dEnd = new Date(d);
    dEnd.setDate(d.getDate() + 6);
    return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} - ${String(dEnd.getDate()).padStart(2, '0')} ${months[dEnd.getMonth()]}`;
}

function aggregateByLocation(data) {
    const groups = {};
    data.forEach(r => {
        if (!groups[r.location]) groups[r.location] = [];
        groups[r.location].push(r);
    });
    return Object.entries(groups).map(([loc, rows]) => {
        const s = sumField(rows, 'actualSpend');
        const t = sumField(rows, 'ttk');
        const k = sumField(rows, 'kg');
        const v = sumField(rows, 'views');
        const c = sumField(rows, 'linkClicks');
        // weekly trend for TTK
        const wk = {};
        rows.forEach(r => {
            const w = toLocalYYYYMMDD(r.date);
            wk[w] = (wk[w] || 0) + (r.ttk || 0);
        });
        return {
            location: loc,
            totalSpend: s, totalTTK: t, totalKG: k, totalViews: v, totalClicks: c,
            costPerTTK: safeDiv(s, t),
            costPerKG: safeDiv(s, k),
            ctr: safeDiv(c, v) != null ? safeDiv(c, v) * 100 : null,
            cvr: safeDiv(t, c) != null ? safeDiv(t, c) * 100 : null,
            trendTTK: calcTrend(Object.values(wk)),
        };
    });
}

function analyzeQuadrant(locationData) {
    const valid = locationData.filter(l => l.ctr != null && l.cvr != null && l.totalViews > 0);
    if (valid.length === 0) return { stars: [], leaky: [], poorContent: [], avgCTR: 0, avgCVR: 0 };

    const avgCTR = valid.reduce((a, l) => a + l.ctr, 0) / valid.length;
    const avgCVR = valid.reduce((a, l) => a + l.cvr, 0) / valid.length;

    return {
        stars: valid.filter(l => l.ctr >= avgCTR && l.cvr >= avgCVR).map(l => l.location),
        leaky: valid.filter(l => l.ctr >= avgCTR && l.cvr < avgCVR).map(l => l.location),
        poorContent: valid.filter(l => l.ctr < avgCTR && l.cvr >= avgCVR).map(l => l.location),
        avgCTR, avgCVR,
    };
}

function generateRecommendations(locationData, avgCost) {
    const recs = [];
    const sorted = [...locationData]
        .filter(l => l.totalSpend > 0)
        .sort((a, b) => (a.costPerTTK || Infinity) - (b.costPerTTK || Infinity));

    sorted.forEach(loc => {
        if (loc.costPerTTK === null && loc.totalSpend > 0) {
            recs.push({ type: 'danger', location: loc.location, text: `Matikan iklan (Spend ${formatRp(loc.totalSpend)} tanpa closing)` });
        } else if (loc.costPerTTK != null && loc.costPerTTK > avgCost * 1.5) {
            recs.push({ type: 'warning', location: loc.location, text: `Evaluasi/kurangi budget (Cost/TTK ${formatRpFull(loc.costPerTTK)} > rata-rata)` });
        } else if (loc.costPerTTK != null && loc.costPerTTK < avgCost * 0.8) {
            recs.push({ type: 'success', location: loc.location, text: `Naikkan budget (Sangat efisien, Cost/TTK: ${formatRpFull(loc.costPerTTK)})` });
        }
    });
    return recs;
}

// ---- Helpers ----
function toLocalYYYYMMDD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseLocalYYYYMMDD(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(date.setDate(diff));
}
