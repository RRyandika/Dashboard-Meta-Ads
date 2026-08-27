// ============================================
// utils.js — Utility Functions
// Meta Ads Dashboard - Wahana Express
// ============================================

/**
 * Clean currency string (Rp format) to float.
 * Port dari Python clean_currency()
 */
function cleanCurrency(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return isNaN(val) ? null : val;

    const raw = String(val).trim();
    if (raw === '' || raw.toLowerCase() === 'nan') return null;

    let s = raw
        .replace(/Rp/gi, '')
        .replace(/\s/g, '')
        .replace(/\u00a0/g, '');

    if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        if ((s.match(/,/g) || []).length > 1) {
            s = s.replace(/,/g, '');
        } else {
            const parts = s.split(',');
            if (parts[1] && parts[1].length === 3) {
                s = s.replace(',', '');
            } else {
                s = s.replace(',', '.');
            }
        }
    }

    const num = parseFloat(s);
    return isNaN(num) ? null : num;
}

/**
 * Parse numeric value from cell (remove commas/spaces).
 */
function parseNumeric(val) {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return isNaN(val) ? null : val;
    const s = String(val).replace(/,/g, '').replace(/\s/g, '').trim();
    const num = parseFloat(s);
    return isNaN(num) ? null : num;
}

/**
 * Parse date string dd/mm/yy to Date object.
 */
function parseDateDMY(str) {
    if (!str) return null;
    const parts = str.split('/');
    if (parts.length !== 3) return null;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    let year = parseInt(parts[2], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Calculate linear trend from array of numbers.
 * Port dari Python calc_trend()
 */
function calcTrend(values) {
    const valid = values.filter(v => v !== null && v !== undefined && !isNaN(v));
    if (valid.length < 3) {
        return { slope: 0, direction: 'Tidak cukup data', pctChange: 0 };
    }
    const n = valid.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = valid;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((a, xi, i) => a + xi * y[i], 0);
    const sumX2 = x.reduce((a, xi) => a + xi * xi, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return { slope: 0, direction: '[STABIL]', pctChange: 0 };

    const slope = (n * sumXY - sumX * sumY) / denom;
    if (isNaN(slope) || !isFinite(slope)) {
        return { slope: 0, direction: '[STABIL]', pctChange: 0 };
    }

    const firstVal = y[0] || 0;
    const safeFirstVal = y[0] !== 0 ? Math.abs(y[0]) : 1;
    const totalChange = slope * n;
    const pctChange = (totalChange / safeFirstVal) * 100;

    let direction;
    if (Math.abs(pctChange) < 5) direction = '[STABIL]';
    else if (pctChange > 0) direction = '[NAIK]';
    else direction = '[TURUN]';

    return { slope, direction, pctChange, n, firstVal, totalChange };
}

// ---- Formatting ----

function formatRp(num) {
    if (num === null || num === undefined || isNaN(num)) return 'Rp -';
    const abs = Math.abs(num);
    if (abs >= 1e9) return `Rp ${(num / 1e9).toFixed(1)} M`;
    if (abs >= 1e6) return `Rp ${(num / 1e6).toFixed(1)} Jt`;
    if (abs >= 1e3) return `Rp ${(num / 1e3).toFixed(1)} Rb`;
    return `Rp ${Math.round(num).toLocaleString('id-ID')}`;
}

function formatRpFull(num) {
    if (num === null || num === undefined || isNaN(num)) return 'Rp -';
    return `Rp ${Math.round(num).toLocaleString('id-ID')}`;
}

function formatNum(num) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    return Math.round(num).toLocaleString('id-ID');
}

function formatPct(num, decimals = 2) {
    if (num === null || num === undefined || isNaN(num)) return '-';
    return `${num.toFixed(decimals)}%`;
}

// ---- Colors ----

const COLORS = {
    blue: '#3b82f6',
    green: '#10b981',
    orange: '#f59e0b',
    purple: '#8b5cf6',
    red: '#ef4444',
    pink: '#ec4899',
    cyan: '#06b6d4',
    teal: '#14b8a6',
    indigo: '#6366f1',
    lime: '#84cc16',
    palette: [
        '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
        '#ec4899', '#06b6d4', '#14b8a6', '#6366f1', '#f97316',
        '#84cc16', '#a855f7', '#f43f5e', '#0ea5e9', '#22c55e',
        '#eab308', '#d946ef', '#64748b',
    ],
};

const PALETTES = {
    // Sky Blue: Bersih, profesional, sangat standar untuk data
    blue: ['#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1'],
    
    // Teal / Tosca: Pengganti oranye yang sangat populer di dashboard modern (premium & fresh)
    teal: ['#5eead4', '#2dd4bf', '#14b8a6', '#0f766e', '#115e59'],
    
    // True Orange: Oranye terang ke merah (Coral), menghindari warna coklat kotor
    orange: ['#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c'],
    
    // Emerald Green: Hijau segar yang elegan
    green: ['#6ee7b7', '#34d399', '#10b981', '#059669', '#047857'],
    
    // Rose / Soft Red: Merah elegan yang tidak terlalu mencolok seperti warna error
    red: ['#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c'],
    
    // Violet / Deep Purple: Ungu korporat yang mewah
    purple: ['#c4b5fd', '#a78bfa', '#8b5cf6', '#6d28d9', '#4c1d95'],
    
    // Indigo: Biru keunguan
    indigo: ['#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca']
};

function getPaletteColor(paletteName, value, minVal, maxVal) {
    const palette = PALETTES[paletteName];
    if (!palette) return COLORS[paletteName] || '#333';
    if (maxVal === minVal) return palette[Math.floor(palette.length / 2)];
    const ratio = Math.max(0, Math.min(1, (value - minVal) / (maxVal - minVal)));
    let index = Math.floor(ratio * palette.length);
    if (index >= palette.length) index = palette.length - 1;
    return palette[index];
}

function getColor(index) {
    return COLORS.palette[index % COLORS.palette.length];
}

// ---- Trend Arrow ----

function trendHTML(trend) {
    let tooltipText = "Kalkulasi Tren (Regresi Linear):\nTotal Perubahan = Kemiringan Tren × Jumlah Periode\nPersentase = (Total Perubahan ÷ Nilai Awal) × 100%\n\n*Catatan: Persentase bisa tampak ekstrem jika nilai awal sangat kecil.";
    
    if (trend && trend.n !== undefined && trend.direction !== 'Tidak cukup data') {
        const fSlope = Number(trend.slope.toFixed(2)).toLocaleString('id-ID');
        const fTotal = Number(trend.totalChange.toFixed(1)).toLocaleString('id-ID');
        const fFirst = formatNum(trend.firstVal);
        const pct = trend.pctChange.toFixed(1);
        
        tooltipText = `Kalkulasi Tren (Regresi Linear):\n` +
                      `1. Rata-rata perubahan (Kemiringan): ${fSlope}\n` +
                      `2. Jumlah Periode: ${trend.n}\n` +
                      `3. Total Perubahan: ${fSlope} × ${trend.n} ≈ ${fTotal}\n` +
                      `4. Nilai Awal: ${fFirst}\n` +
                      `5. Persentase: (${fTotal} ÷ ${fFirst}) × 100% ≈ ${pct}%\n\n` +
                      `*Catatan: Persentase bisa ekstrem jika nilai awal mendekati nol.`;
    }

    let innerHTML = '';
    if (!trend || trend.direction === 'Tidak cukup data') {
        innerHTML = '<span class="trend trend-stable">—</span>';
    } else {
        const pct = Math.abs(trend.pctChange).toFixed(1);
        if (trend.direction === '[NAIK]') innerHTML = `<span class="trend trend-up">▲ ${pct}%</span>`;
        else if (trend.direction === '[TURUN]') innerHTML = `<span class="trend trend-down">▼ ${pct}%</span>`;
        else innerHTML = `<span class="trend trend-stable">→ ${pct}%</span>`;
    }

    return `<span style="display:inline-flex; align-items:center;">${innerHTML} <span class="kpi-info" data-tooltip="${tooltipText}">?</span></span>`;
}

// ---- Helpers ----

function sumField(arr, field) {
    return arr.reduce((acc, r) => acc + (r[field] || 0), 0);
}

function safeDiv(a, b) {
    if (!b || b === 0) return null;
    const r = a / b;
    return isFinite(r) ? r : null;
}
