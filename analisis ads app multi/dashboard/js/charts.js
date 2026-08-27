// ============================================
// charts.js — 10 Interactive Charts
// Chart.js v4 + Annotation Plugin
// ============================================

const chartInstances = {};

// Default Chart.js options for light mode
function setChartDefaults() {
    Chart.defaults.color = '#475569';
    Chart.defaults.borderColor = 'rgba(0,0,0,0.06)';
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.padding = 16;
    Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(255,255,255,0.95)';
    Chart.defaults.plugins.tooltip.titleColor = '#0f172a';
    Chart.defaults.plugins.tooltip.bodyColor = '#475569';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(0,0,0,0.1)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.titleFont = { size: 13, weight: '600' };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
    Chart.defaults.animation.duration = 800;
    Chart.defaults.animation.easing = 'easeOutQuart';
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
}

function destroyAllCharts() {
    Object.keys(chartInstances).forEach(k => {
        if (chartInstances[k]) { chartInstances[k].destroy(); delete chartInstances[k]; }
    });
}

function getOrCreateCanvas(id) {
    const el = document.getElementById(id);
    return el ? el.getContext('2d') : null;
}

// ---- 1. TTK per Period (Bar) ----
function renderTTKPerPeriod(metrics) {
    const ctx = getOrCreateCanvas('chart-ttk-period');
    if (!ctx || !metrics) return;
    if (chartInstances['ttk-period']) chartInstances['ttk-period'].destroy();

    const pd = metrics.periodData;
    const dataVals = pd.map(p => p.totalTTK);
    const maxVal = Math.max(...dataVals, 1);
    const minVal = Math.min(...dataVals);
    const diff = maxVal - minVal;

    chartInstances['ttk-period'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: pd.map(p => p.label),
            datasets: [{
                label: 'Total TTK (Resi)',
                data: dataVals,
                backgroundColor: dataVals.map(v => getPaletteColor('blue', v, minVal, maxVal)),
                borderColor: dataVals.map(v => getPaletteColor('blue', v, minVal, maxVal)),
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => {
                            const p = metrics.periodData[c.dataIndex];
                            if (!p.isActivePeriod && c.raw === 0) return 'Tidak pasang ads';
                            return `TTK: ${formatNum(c.raw)}`;
                        },
                        afterBody: (context) => {
                            const dataIndex = context[0].dataIndex;
                            const breakdown = metrics.periodData[dataIndex].locationBreakdown;
                            if (!breakdown || Object.keys(breakdown).length <= 1) return [];

                            const lines = ['', 'Breakdown Lokasi:'];
                            const sortedLocs = Object.keys(breakdown).sort((a, b) => breakdown[b].ttk - breakdown[a].ttk);
                            sortedLocs.forEach(loc => {
                                if (breakdown[loc].ttk > 0) {
                                    lines.push(`• ${loc}: ${formatNum(breakdown[loc].ttk)}`);
                                }
                            });
                            return lines;
                        }
                    }
                },
                datalabels: false,
            },
            scales: {
                y: { beginAtZero: true, grace: '15%', ticks: { callback: v => formatNum(v) } },
                x: { grid: { display: false } }
            }
        },
        plugins: [dataLabelPlugin(COLORS.blue, (val, i) => {
            const p = metrics.periodData[i];
            return !p.isActivePeriod && val === 0 ? '-' : formatNum(val);
        })]
    });
}

// ---- 2. KG per Period (Bar) ----
function renderKGPerPeriod(metrics) {
    const ctx = getOrCreateCanvas('chart-kg-period');
    if (!ctx || !metrics) return;
    if (chartInstances['kg-period']) chartInstances['kg-period'].destroy();

    const pd = metrics.periodData;
    const dataVals = pd.map(p => p.totalKG);
    const maxVal = Math.max(...dataVals, 1);
    const minVal = Math.min(...dataVals);
    const diff = maxVal - minVal;

    chartInstances['kg-period'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: pd.map(p => p.label),
            datasets: [{
                label: 'Total KG',
                data: dataVals,
                backgroundColor: dataVals.map(v => getPaletteColor('orange', v, minVal, maxVal)),
                borderColor: dataVals.map(v => getPaletteColor('orange', v, minVal, maxVal)),
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => {
                            const p = metrics.periodData[c.dataIndex];
                            if (!p.isActivePeriod && c.raw === 0) return 'Tidak pasang ads';
                            return `KG: ${formatNum(c.raw)}`;
                        },
                        afterBody: (context) => {
                            const dataIndex = context[0].dataIndex;
                            const breakdown = metrics.periodData[dataIndex].locationBreakdown;
                            if (!breakdown || Object.keys(breakdown).length <= 1) return [];

                            const lines = ['', 'Breakdown Lokasi:'];
                            const sortedLocs = Object.keys(breakdown).sort((a, b) => breakdown[b].kg - breakdown[a].kg);
                            sortedLocs.forEach(loc => {
                                if (breakdown[loc].kg > 0) {
                                    lines.push(`• ${loc}: ${formatNum(breakdown[loc].kg)}`);
                                }
                            });
                            return lines;
                        }
                    }
                },
            },
            scales: {
                y: { beginAtZero: true, grace: '15%', ticks: { callback: v => formatNum(v) } },
                x: { grid: { display: false } }
            }
        },
        plugins: [dataLabelPlugin(COLORS.orange, (val, i) => {
            const p = metrics.periodData[i];
            return !p.isActivePeriod && val === 0 ? '-' : formatNum(val);
        })]
    });
}

// ---- 2b. Views Comparison (Line) ----
function renderViewsComparison(metrics) {
    const ctx = getOrCreateCanvas('chart-views-comparison');
    if (!ctx || !metrics) return;
    if (chartInstances['views-comparison']) chartInstances['views-comparison'].destroy();

    const pd = metrics.periodData;

    chartInstances['views-comparison'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: pd.map(p => p.label),
            datasets: [
                {
                    label: 'Views (Impresi)',
                    data: pd.map(p => p.totalViews),
                    borderColor: COLORS.blue,
                    backgroundColor: COLORS.blue,
                    fill: false,
                    tension: 0,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    borderWidth: 2,
                    yAxisID: 'y'
                },
                {
                    label: 'Viewers (Reach)',
                    data: pd.map(p => p.totalViewers),
                    borderColor: COLORS.teal,
                    backgroundColor: COLORS.teal,
                    fill: false,
                    tension: 0,
                    pointRadius: 4,
                    pointHoverRadius: 7,
                    borderWidth: 2,
                    yAxisID: 'y'
                },
                {
                    label: 'Link Clicks',
                    data: pd.map(p => p.totalClicks),
                    borderColor: COLORS.orange,
                    backgroundColor: COLORS.orange,
                    borderDash: [6, 4],
                    fill: false,
                    tension: 0,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    borderWidth: 2,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (c) => `${c.dataset.label}: ${formatNum(c.raw)}`
                    }
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear', position: 'left', grace: '10%',
                    title: { display: true, text: 'Views / Viewers', color: '#475569', font: { weight: '600', size: 11 } },
                    ticks: { callback: v => formatNum(v) },
                    grid: { color: 'rgba(0,0,0,0.04)' }
                },
                y1: {
                    type: 'linear', position: 'right', grace: '10%',
                    title: { display: true, text: 'Link Clicks', color: COLORS.orange, font: { weight: '600', size: 11 } },
                    ticks: { callback: v => formatNum(v), color: COLORS.orange },
                    grid: { drawOnChartArea: false }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// ---- 3. Cost per TTK per Location (Horizontal Bar) ----
function renderCostPerTTKLocation(metrics) {
    const ctx = getOrCreateCanvas('chart-costttk-location');
    if (!ctx || !metrics) return;
    if (chartInstances['costttk-loc']) chartInstances['costttk-loc'].destroy();

    const sorted = [...metrics.locationData]
        .filter(l => l.costPerTTK != null)
        .sort((a, b) => a.costPerTTK - b.costPerTTK);

    if (sorted.length === 0) return;

    // Dynamic height based on number of items
    const containerHeight = Math.max(300, sorted.length * 28 + 60);
    ctx.canvas.parentNode.style.height = `${containerHeight}px`;

    const avg = metrics.avgCostPerTTK;
    const dataVals = sorted.map(l => l.costPerTTK);
    const maxVal = Math.max(...dataVals, 1);
    const minVal = Math.min(...dataVals);
    const diff = maxVal - minVal;

    chartInstances['costttk-loc'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(l => l.location),
            datasets: [{
                label: 'Cost per TTK',
                data: dataVals,
                backgroundColor: sorted.map(l => {
                    return l.costPerTTK > avg
                        ? COLORS.red 
                        : getPaletteColor('green', l.costPerTTK, minVal, maxVal);
                }),
                borderColor: sorted.map(l => {
                    return l.costPerTTK > avg
                        ? COLORS.red 
                        : getPaletteColor('green', l.costPerTTK, minVal, maxVal);
                }),
                borderWidth: 1,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => `Cost/TTK: ${formatRpFull(c.raw)}` } },
                annotation: {
                    annotations: {
                        avgLine: {
                            type: 'line',
                            xMin: avg, xMax: avg,
                            borderColor: COLORS.red,
                            borderWidth: 2,
                            borderDash: [6, 4],
                            label: {
                                display: true,
                                content: `Rata-rata: ${formatRp(avg)}`,
                                position: 'start',
                                backgroundColor: 'rgba(239,68,68,0.8)',
                                font: { size: 11 },
                            }
                        }
                    }
                }
            },
            scales: {
                x: { grace: '25%', ticks: { callback: v => formatRp(v) } },
                y: { grid: { display: false }, ticks: { autoSkip: false } }
            }
        },
        plugins: [dataLabelPlugin('#475569', v => formatRp(v))]
    });
}

// ---- 4. Cost per TTK per Period (Bar) ----
function renderCostPerTTKPeriod(metrics) {
    const ctx = getOrCreateCanvas('chart-costttk-period');
    if (!ctx || !metrics) return;
    if (chartInstances['costttk-period']) chartInstances['costttk-period'].destroy();

    const pd = metrics.periodData; // Keep all periods so we can show "Tidak pasang ads"
    if (pd.length === 0) return;

    const values = pd.map(p => p.costPerTTK || 0);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const diff = maxV - minV;
    const absMaxVal = Math.max(...values, 1);

    chartInstances['costttk-period'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: pd.map(p => p.label),
            datasets: [{
                label: 'Cost per TTK',
                data: values,
                backgroundColor: values.map(v => getPaletteColor('purple', v, minV, maxV)),
                borderColor: values.map(v => getPaletteColor('purple', v, minV, maxV)),
                borderWidth: 1,
                borderRadius: 6,
            }]
        },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: { 
                    callbacks: { 
                        label: (c) => {
                            const p = metrics.periodData[c.dataIndex];
                            if (!p.isActivePeriod) return 'Tidak pasang ads';
                            return `Cost/TTK: ${formatRpFull(c.raw)}`;
                        }
                    } 
                },
            },
            scales: {
                y: {
                    min: diff > 0 ? Math.max(0, minV - diff * 0.5) : 0,
                    grace: '15%',
                    ticks: { callback: v => formatRp(v) }
                },
                x: { grid: { display: false } }
            }
        },
        plugins: [dataLabelPlugin(COLORS.purple, (val, i) => {
            const p = metrics.periodData[i];
            // Jika ada TTK organik walau tidak pasang ads (cost=0), tetap tampilkan nominal 0 (karena spend=0, cost/ttk=0).
            // Tapi jika tidak ada sama sekali, ganti dengan 'Tidak pasang ads' jika user memintanya (val===0).
            // Berdasarkan permintaan user: "-" diganti "Tidak pasang ads".
            if (!p.isActivePeriod && val === 0) return ['Tidak', 'pasang', 'ads']; 
            return formatRp(val);
        })]
    });
}

// ---- 5. TTK per Location (Bar sorted) ----
function renderTTKPerLocation(metrics) {
    const ctx = getOrCreateCanvas('chart-ttk-location');
    if (!ctx || !metrics) return;
    if (chartInstances['ttk-loc']) chartInstances['ttk-loc'].destroy();

    const sorted = [...metrics.locationData].sort((a, b) => b.totalTTK - a.totalTTK);
    const dataVals = sorted.map(l => l.totalTTK);
    const maxVal = Math.max(...dataVals, 1);
    const minVal = Math.min(...dataVals);
    const diff = maxVal - minVal;

    // Dynamic height based on number of items
    const containerHeight = Math.max(300, sorted.length * 28 + 60);
    ctx.canvas.parentNode.style.height = `${containerHeight}px`;

    chartInstances['ttk-loc'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(l => l.location),
            datasets: [{
                label: 'Total TTK',
                data: dataVals,
                backgroundColor: dataVals.map(v => getPaletteColor('indigo', v, minVal, maxVal)),
                borderColor: dataVals.map(v => getPaletteColor('indigo', v, minVal, maxVal)),
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            indexAxis: 'y',
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => `TTK: ${formatNum(c.raw)}` } },
            },
            scales: {
                x: { beginAtZero: true, grace: '20%', ticks: { callback: v => formatNum(v) } },
                y: { grid: { display: false }, ticks: { autoSkip: false } }
            }
        },
        plugins: [dataLabelPlugin('#1e293b')]
    });
}

// ---- 6. Spend Distribution (Doughnut) ----
function renderSpendDistribution(metrics) {
    const ctx = getOrCreateCanvas('chart-spend-dist');
    if (!ctx || !metrics) return;
    if (chartInstances['spend-dist']) chartInstances['spend-dist'].destroy();

    const sorted = [...metrics.locationData].sort((a, b) => b.totalSpend - a.totalSpend);
    const totalSpend = metrics.totalSpend;

    chartInstances['spend-dist'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: sorted.map(l => l.location),
            datasets: [{
                data: sorted.map(l => l.totalSpend),
                backgroundColor: sorted.map((_, i) => hexAlpha(getColor(i), 0.8)),
                borderColor: 'rgba(255,255,255,1)',
                borderWidth: 2,
            }]
        },
        options: {
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: { font: { size: 11 }, padding: 8 }
                },
                tooltip: {
                    callbacks: {
                        label: (c) => {
                            const pct = totalSpend > 0 ? ((c.raw / totalSpend) * 100).toFixed(1) : 0;
                            return `${c.label}: ${formatRp(c.raw)} (${pct}%)`;
                        }
                    }
                },
            }
        },
        plugins: [{
            id: 'centerText',
            beforeDraw: function(chart) {
                const ctx = chart.ctx;
                const chartArea = chart.chartArea;
                if (!chartArea) return;
                
                const centerX = (chartArea.left + chartArea.right) / 2;
                const centerY = (chartArea.top + chartArea.bottom) / 2;
                
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                
                ctx.font = "600 12px Inter, sans-serif";
                ctx.fillStyle = "#64748b";
                ctx.fillText("Total Spend", centerX, centerY - 10);
                
                ctx.font = "bold 15px Inter, sans-serif";
                ctx.fillStyle = "#0f172a";
                ctx.fillText(formatRp(totalSpend), centerX, centerY + 10);
                ctx.restore();
            }
        }]
    });
}

// ---- 7. Funnel Conversion (HTML-based, not Chart.js) ----
function renderFunnel(metrics) {
    const el = document.getElementById('funnel-container');
    if (!el || !metrics) return;

    const views = metrics.totalViews;
    const clicks = metrics.totalClicks;
    const ttk = metrics.totalTTK;
    const ctr = views > 0 ? ((clicks / views) * 100).toFixed(2) : 0;
    const cvr = clicks > 0 ? ((ttk / clicks) * 100).toFixed(2) : 0;
    const total = views > 0 ? ((ttk / views) * 100).toFixed(2) : 0;

    el.innerHTML = `
        <div class="funnel-flow">
            <div class="funnel-box funnel-views">
                <div class="funnel-label">Views</div>
                <div class="funnel-value">${formatNum(views)}</div>
            </div>
            <div class="funnel-arrow">
                <div class="funnel-arrow-label">CTR</div>
                <div class="funnel-arrow-pct">${ctr}%</div>
                <svg viewBox="0 0 40 24" width="40" height="24"><path d="M0 12 L30 12 L24 4 M30 12 L24 20" fill="none" stroke="#64748b" stroke-width="2"/></svg>
            </div>
            <div class="funnel-box funnel-clicks">
                <div class="funnel-label">Link Clicks</div>
                <div class="funnel-value">${formatNum(clicks)}</div>
            </div>
            <div class="funnel-arrow">
                <div class="funnel-arrow-label">CVR</div>
                <div class="funnel-arrow-pct">${cvr}%</div>
                <svg viewBox="0 0 40 24" width="40" height="24"><path d="M0 12 L30 12 L24 4 M30 12 L24 20" fill="none" stroke="#64748b" stroke-width="2"/></svg>
            </div>
            <div class="funnel-box funnel-ttk">
                <div class="funnel-label">Resi (TTK)</div>
                <div class="funnel-value">${formatNum(ttk)}</div>
            </div>
        </div>
        <div class="funnel-total">Total Konversi (Views → Resi): <strong>${total}%</strong></div>
    `;
}

// ---- 8. Quadrant CTR vs CVR (Scatter) ----
function renderQuadrant(metrics) {
    const ctx = getOrCreateCanvas('chart-quadrant');
    if (!ctx || !metrics) return;
    if (chartInstances['quadrant']) chartInstances['quadrant'].destroy();

    const q = metrics.quadrant;
    const locs = metrics.locationData.filter(l => l.ctr != null && l.cvr != null && l.totalViews > 0);
    if (locs.length === 0) return;

    // Find max spend to normalize bubble sizes
    const maxSpend = Math.max(...locs.map(l => l.totalSpend));

    const data = locs.map(l => {
        // Calculate relative size based on max spend. Radius range: 6 to 35
        const spendRatio = maxSpend > 0 ? (l.totalSpend / maxSpend) : 0;
        // Using square root so area scales linearly with spend
        const radius = 6 + (Math.sqrt(spendRatio) * 29); 
        
        return {
            x: l.ctr,
            y: l.cvr,
            r: radius,
            label: l.location,
            ttk: l.totalTTK,
        };
    });

    chartInstances['quadrant'] = new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: [{
                label: 'Lokasi',
                data: data,
                backgroundColor: data.map(d => {
                    if (d.x >= q.avgCTR && d.y >= q.avgCVR) return hexAlpha(COLORS.green, 0.6);
                    if (d.x >= q.avgCTR && d.y < q.avgCVR) return hexAlpha(COLORS.orange, 0.6);
                    if (d.x < q.avgCTR && d.y >= q.avgCVR) return hexAlpha(COLORS.cyan, 0.6);
                    return hexAlpha(COLORS.red, 0.6);
                }),
                borderColor: data.map(d => {
                    if (d.x >= q.avgCTR && d.y >= q.avgCVR) return COLORS.green;
                    if (d.x >= q.avgCTR && d.y < q.avgCVR) return COLORS.orange;
                    if (d.x < q.avgCTR && d.y >= q.avgCVR) return COLORS.cyan;
                    return COLORS.red;
                }),
                borderWidth: 2,
            }]
        },
        options: {
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => {
                            const d = c.raw;
                            return [`${d.label}`, `CTR: ${formatPct(d.x)}`, `CVR: ${formatPct(d.y)}`, `TTK: ${formatNum(d.ttk)}`];
                        }
                    }
                },
                annotation: {
                    annotations: {
                        avgCTR: {
                            type: 'line',
                            xMin: q.avgCTR, xMax: q.avgCTR,
                            borderColor: hexAlpha(COLORS.red, 0.5),
                            borderWidth: 1.5,
                            borderDash: [6, 4],
                            label: { display: true, content: `CTR Avg: ${formatPct(q.avgCTR)}`, position: 'start', backgroundColor: hexAlpha(COLORS.red, 0.7), font: { size: 10 } }
                        },
                        avgCVR: {
                            type: 'line',
                            yMin: q.avgCVR, yMax: q.avgCVR,
                            borderColor: hexAlpha(COLORS.blue, 0.5),
                            borderWidth: 1.5,
                            borderDash: [6, 4],
                            label: { display: true, content: `CVR Avg: ${formatPct(q.avgCVR)}`, position: 'start', backgroundColor: hexAlpha(COLORS.blue, 0.7), font: { size: 10 } }
                        }
                    }
                }
            },
            scales: {
                x: { grace: '10%', title: { display: true, text: 'CTR (%) → Daya Tarik Iklan', font: { weight: '600' } } },
                y: { grace: '10%', title: { display: true, text: 'CVR (%) → Efektivitas Closing', font: { weight: '600' } } }
            }
        },
        plugins: [calloutLabelPlugin()]
    });
}

// ---- 9. Trend CTR/CVR (Dual Axis Line) ----
function renderTrendHealth(metrics) {
    const ctx = getOrCreateCanvas('chart-trend-health');
    if (!ctx || !metrics) return;
    if (chartInstances['trend-health']) chartInstances['trend-health'].destroy();

    const pd = metrics.periodData;

    chartInstances['trend-health'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: pd.map(p => p.label),
            datasets: [
                {
                    label: 'CTR (%)',
                    data: pd.map(p => p.ctr),
                    borderColor: COLORS.orange,
                    backgroundColor: hexAlpha(COLORS.orange, 0.1),
                    fill: true,
                    tension: 0,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    yAxisID: 'y',
                    borderWidth: 2.5,
                },
                {
                    label: 'CVR (%)',
                    data: pd.map(p => p.cvr),
                    borderColor: COLORS.green,
                    backgroundColor: hexAlpha(COLORS.green, 0.1),
                    fill: true,
                    tension: 0,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    yAxisID: 'y1',
                    borderWidth: 2.5,
                }
            ]
        },
        options: {
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (c) => `${c.dataset.label}: ${formatPct(c.raw)}`
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear', position: 'left', grace: '10%',
                    title: { display: true, text: 'CTR (%)', color: COLORS.orange, font: { weight: '600' } },
                    ticks: { color: COLORS.orange },
                    grid: { color: 'rgba(0,0,0,0.04)' }
                },
                y1: {
                    type: 'linear', position: 'right', grace: '10%',
                    title: { display: true, text: 'CVR (%)', color: COLORS.green, font: { weight: '600' } },
                    ticks: { color: COLORS.green },
                    grid: { drawOnChartArea: false }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// ---- 10. Clicks vs KG Scatter ----
function renderClicksVsKG(metrics) {
    const ctx = getOrCreateCanvas('chart-clicks-kg');
    if (!ctx || !metrics) return;
    if (chartInstances['clicks-kg']) chartInstances['clicks-kg'].destroy();

    const locs = metrics.locationData.filter(l => l.totalClicks > 0 && l.totalKG > 0);
    if (locs.length === 0) return;

    const data = locs.map(l => ({ x: l.totalClicks, y: l.totalKG, label: l.location }));

    // Regression line
    const xs = data.map(d => d.x);
    const ys = data.map(d => d.y);
    const n = xs.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((a, xi, i) => a + xi * ys[i], 0);
    const sumX2 = xs.reduce((a, xi) => a + xi * xi, 0);
    const denom = n * sumX2 - sumX * sumX;
    let regData = [];
    if (denom !== 0 && n > 1) {
        const slope = (n * sumXY - sumX * sumY) / denom;
        const intercept = (sumY - slope * sumX) / n;
        const xMin = Math.min(...xs);
        const xMax = Math.max(...xs);
        regData = [{ x: xMin, y: slope * xMin + intercept }, { x: xMax, y: slope * xMax + intercept }];
    }

    chartInstances['clicks-kg'] = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Lokasi',
                    data: data,
                    backgroundColor: hexAlpha(COLORS.cyan, 0.6),
                    borderColor: COLORS.cyan,
                    borderWidth: 2,
                    pointRadius: 7,
                    pointHoverRadius: 10,
                },
                ...(regData.length > 0 ? [{
                    label: 'Trendline',
                    data: regData,
                    type: 'line',
                    borderColor: hexAlpha(COLORS.red, 0.6),
                    borderWidth: 2,
                    borderDash: [6, 4],
                    pointRadius: 0,
                    fill: false,
                }] : [])
            ]
        },
        options: {
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (c) => {
                            if (c.datasetIndex === 1) return '';
                            const d = c.raw;
                            return [`${d.label}`, `Clicks: ${formatNum(d.x)}`, `KG: ${formatNum(d.y)}`];
                        }
                    }
                },
                legend: { display: false },
            },
            scales: {
                x: { grace: '10%', title: { display: true, text: 'Link Clicks (Minat)', font: { weight: '600' } } },
                y: { grace: '10%', title: { display: true, text: 'Total Berat (KG)', font: { weight: '600' } } }
            }
        }
    });
}

// ---- Render ALL charts ----
function renderAllCharts(metrics) {
    if (!metrics) return;
    renderTTKPerPeriod(metrics);
    renderKGPerPeriod(metrics);
    renderViewsComparison(metrics);
    renderCostPerTTKLocation(metrics);
    renderCostPerTTKPeriod(metrics);
    renderTTKPerLocation(metrics);
    renderSpendDistribution(metrics);
    renderFunnel(metrics);
    renderQuadrant(metrics);
    renderTrendHealth(metrics);
    renderClicksVsKG(metrics);
}

// ---- Helpers ----

function hexAlpha(hex, alpha) {
    const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return hex + a;
}

/**
 * Inline plugin to draw data labels on top of bars.
 */
function dataLabelPlugin(color, formatter) {
    return {
        id: 'customDataLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            chart.data.datasets.forEach((ds, di) => {
                const meta = chart.getDatasetMeta(di);
                meta.data.forEach((bar, i) => {
                    const val = ds.data[i];
                    if (val === null || val === undefined) return;
                    const text = formatter ? formatter(val, i, ds) : formatNum(val);
                    ctx.save();
                    ctx.font = 'bold 11px Inter, sans-serif';
                    ctx.fillStyle = color || '#475569';

                    if (chart.options.indexAxis === 'y') {
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'middle';
                        if (Array.isArray(text)) {
                            const lh = 14;
                            const startY = bar.y - ((text.length - 1) * lh) / 2;
                            text.forEach((t, j) => ctx.fillText(t, bar.x + 6, startY + j * lh));
                        } else {
                            ctx.fillText(text, bar.x + 6, bar.y);
                        }
                    } else {
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        if (Array.isArray(text)) {
                            const lh = 14;
                            const startY = bar.y - 6;
                            // draw bottom up
                            for (let j = text.length - 1; j >= 0; j--) {
                                ctx.fillText(text[j], bar.x, startY - ((text.length - 1 - j) * lh));
                            }
                        } else {
                            ctx.fillText(text, bar.x, bar.y - 6);
                        }
                    }
                    ctx.restore();
                });
            });
        }
    };
}

/**
 * Inline plugin for Callout Labels with lines for Quadrant (Bubble) Chart
 */
function calloutLabelPlugin() {
    return {
        id: 'calloutLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const datasets = chart.data.datasets;
            
            const points = [];
            datasets.forEach((ds, di) => {
                const meta = chart.getDatasetMeta(di);
                if (meta.hidden) return;
                meta.data.forEach((element, i) => {
                    const d = ds.data[i];
                    if (!d || d.x == null || d.y == null) return;
                    points.push({
                        x: element.x,
                        y: element.y,
                        radius: element.options.radius || 0,
                        label: d.label,
                        color: ds.borderColor[i] || ds.borderColor || '#333'
                    });
                });
            });

            if (points.length === 0) return;

            ctx.save();
            ctx.font = '600 10.5px Inter, sans-serif';
            ctx.textBaseline = 'middle';
            
            const distance = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
            
            points.forEach((p) => {
                const cluster = points.filter(other => distance(p, other) < 45);
                
                let angle = -Math.PI / 4; 
                let distanceOffset = p.radius + 15;
                
                if (cluster.length > 1) {
                    const idx = cluster.indexOf(p);
                    // Golden ratio distribution
                    angle = idx * 2.39996 - Math.PI/2;
                    distanceOffset = p.radius + 15 + (idx % 3) * 8; 
                }
                
                const labelX = p.x + Math.cos(angle) * distanceOffset;
                const labelY = p.y + Math.sin(angle) * distanceOffset;
                
                ctx.beginPath();
                ctx.moveTo(p.x + Math.cos(angle) * (p.radius + 2), p.y + Math.sin(angle) * (p.radius + 2));
                ctx.lineTo(labelX, labelY);
                ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                ctx.lineWidth = 1;
                ctx.stroke();
                
                ctx.fillStyle = '#0f172a';
                ctx.textAlign = (Math.cos(angle) > 0) ? 'left' : 'right';
                const textX = labelX + (Math.cos(angle) > 0 ? 4 : -4);
                
                ctx.strokeStyle = 'rgba(255,255,255,0.85)';
                ctx.lineWidth = 3;
                ctx.strokeText(p.label, textX, labelY);
                ctx.fillText(p.label, textX, labelY);
            });
            
            ctx.restore();
        }
    };
}
