import sys
import io
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.patches as patches
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ==========================================
# 1. KONFIGURASI
# ==========================================
FILE_INDO = Path(__file__).parent / 'data_indonesia.xlsx'
FILE_MY = Path(__file__).parent / 'data_malaysia.xlsx'
OUTPUT_DIR = Path(__file__).parent / 'analysis_output'
OUTPUT_DIR.mkdir(exist_ok=True)

print("=" * 60)
print("ANALISIS TREN META ADS - WAHANA EXPRESS (MULTI-LOCATION)")
print("Versi: Indonesia + Malaysia (Dual-File)")
print("=" * 60)

# ==========================================
# 2. FUNGSI UTILITAS
# ==========================================
def clean_currency(val):
    """Bersihkan format mata uang Rp menjadi float."""
    if pd.isna(val) or str(val).strip() == '' or str(val).strip() == 'nan':
        return np.nan
    s = str(val).replace('Rp', '').replace('rp', '').replace(' ', '').replace('\xa0', '')
    if ',' in s and '.' in s:
        if s.rindex(',') > s.rindex('.'):
            s = s.replace('.', '').replace(',', '.')
        else:
            s = s.replace(',', '')
    elif ',' in s:
        if s.count(',') > 1:
            s = s.replace(',', '')
        else:
            parts = s.split(',')
            if len(parts[1]) == 3:
                s = s.replace(',', '')
            else:
                s = s.replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return np.nan


def calc_trend(series):
    """Hitung tren linear dari series numerik."""
    valid = series.dropna()
    if len(valid) < 3:
        return {'slope': 0, 'direction': 'Tidak cukup data', 'pct_change': 0}
    x = np.arange(len(valid))
    y = valid.values
    if np.std(x) == 0 or np.std(y) == 0:
        return {'slope': 0, 'direction': '[STABIL]', 'pct_change': 0}
    coeffs = np.polyfit(x, y, 1)
    slope = coeffs[0]
    first_val = y[0] if y[0] != 0 else 1
    pct_change = (slope * len(valid) / abs(first_val)) * 100
    if abs(pct_change) < 5:
        direction = '[STABIL]'
    elif pct_change > 0:
        direction = '[NAIK]'
    else:
        direction = '[TURUN]'
    return {'slope': slope, 'direction': direction, 'pct_change': pct_change}


def load_and_clean(file_path, label=""):
    """
    Baca file Excel, deteksi header, bersihkan data.
    Menangani: header detection, kolom rename, merged cells, dsb.
    """
    print(f"\n   [{label}] Membaca {file_path.name}...")
    raw_df = pd.read_excel(file_path, header=None)

    # --- FIX 1: Header detection (support 'Campaign Title') ---
    header_idx = 0
    for idx, row in raw_df.iterrows():
        row_vals = [str(x).lower().strip() for x in row.values if pd.notna(x)]
        if ('location' in row_vals and ('campaign' in row_vals or 'campaign title' in row_vals)):
            header_idx = idx
            break
        if 'week' in row_vals and 'total budget' in row_vals:
            header_idx = idx
            break
    print(f"   [{label}] Header ditemukan di baris: {header_idx}")

    df = pd.read_excel(file_path, header=header_idx)
    print(f"   [{label}] Jumlah baris mentah: {len(df)}")

    # --- FIX 3: Rename 'Campaign Title' → 'Campaign' ---
    if 'Campaign Title' in df.columns and 'Campaign' not in df.columns:
        df.rename(columns={'Campaign Title': 'Campaign'}, inplace=True)

    # Deteksi kolom
    col_date = 'Date' if 'Date' in df.columns else 'Week'
    col_spend = 'Actual Spend (aft. tax)' if 'Actual Spend (aft. tax)' in df.columns else 'Actual Spend'
    col_budget = 'Budget per-week (bef. tax)' if 'Budget per-week (bef. tax)' in df.columns else 'Total Budget'

    # Parse tanggal
    df['Tanggal_Mulai_str'] = df[col_date].astype(str).str.split('-').str[0].str.strip()
    df['Tanggal_Akhir_str'] = df[col_date].astype(str).str.split('-').str[-1].str.strip()

    # --- FIX 5: Filter header duplikat & separator (regex date filter) ---
    df = df[df['Tanggal_Mulai_str'].str.match(r'^\d{2}/\d{2}/\d{2}$', na=False)].copy()
    df['Tanggal_Mulai'] = pd.to_datetime(df['Tanggal_Mulai_str'], format='%d/%m/%y')
    df['Tanggal_Akhir'] = pd.to_datetime(df['Tanggal_Akhir_str'], format='%d/%m/%y')

    # --- H+1 LOGIC ---
    # Jika rentang tanggal berbeda hari, geser Tanggal Mulai ke H+1
    mask_diff = df['Tanggal_Mulai'] < df['Tanggal_Akhir']
    df.loc[mask_diff, 'Tanggal_Mulai'] = df.loc[mask_diff, 'Tanggal_Mulai'] + pd.Timedelta(days=1)

    # Bersihkan kolom mata uang
    df['Actual_Spend'] = df[col_spend].apply(clean_currency)
    df['Budget'] = df[col_budget].apply(clean_currency) if col_budget in df.columns else np.nan

    # --- FIX 2: Tambahkan 'Total TTK' dan 'Total KG' di mapping ---
    numeric_cols_map = {
        'Total Views': 'Views',
        'Views': 'Views',
        'Total Viewers': 'Viewers',
        'Viewers': 'Viewers',
        'Total Link Clicks': 'Link_Clicks',
        'Link Clicks': 'Link_Clicks',
        'Jumlah TTK': 'TTK',
        'Jumlah TTk': 'TTK',
        'Total TTK': 'TTK',
        'Jumlah KG': 'KG',
        'Total KG': 'KG',
    }

    for orig_col, new_col in numeric_cols_map.items():
        if orig_col in df.columns:
            df[new_col] = pd.to_numeric(
                df[orig_col].astype(str).str.replace(',', '').str.replace(' ', ''),
                errors='coerce'
            )

    # Forward-fill Location dan Campaign
    for c in ['Location', 'Campaign', 'Region']:
        if c not in df.columns:
            df[c] = 'All'
        else:
            df[c] = df[c].ffill()

    # Simpan kolom Date original sebelum set_index
    df['_Date_str'] = df[col_date].astype(str)

    # --- FIX 6: Tandai data Kargo ---
    df['Is_Kargo'] = df['Campaign'].str.contains('Kargo', case=False, na=False)

    # --- FIX 4: Broadcast Spend/Views ke sub-lokasi (BAGI RATA) ---
    # Buat group key: Campaign + Date (minggu)
    df['_group_key'] = df['Campaign'].astype(str) + '||' + df['_Date_str']

    broadcast_cols = ['Actual_Spend', 'Budget', 'Views', 'Viewers', 'Link_Clicks']
    for col in broadcast_cols:
        if col not in df.columns:
            continue
        # Cast ke float agar bisa menerima hasil pembagian
        df[col] = df[col].astype(float)
        # Untuk setiap group, hitung jumlah lokasi dan ambil nilai pertama yang tidak NaN
        group_first = df.groupby('_group_key')[col].transform('first')
        group_loc_count = df.groupby('_group_key')['Location'].transform('count').astype(float)

        # Semua lokasi dalam group dapat bagian rata dari budget/spend/views
        has_data_in_group = group_first.notna()
        df.loc[has_data_in_group, col] = group_first[has_data_in_group] / group_loc_count[has_data_in_group]

    # Set index dan sort
    df.set_index('Tanggal_Mulai', inplace=True)
    df = df.sort_index()
    df['Iklan_Aktif'] = df['Actual_Spend'].notna() & (df['Actual_Spend'] > 0)

    print(f"   [{label}] Jumlah baris valid: {len(df)}")
    if len(df) > 0:
        print(f"   [{label}] Periode: {df.index.min().strftime('%d/%m/%Y')} - {df.index.max().strftime('%d/%m/%Y')}")
        print(f"   [{label}] Minggu unik: {len(df.index.unique())}")
        n_kargo = df['Is_Kargo'].sum()
        if n_kargo > 0:
            print(f"   [{label}] Baris Kargo terdeteksi: {n_kargo} (digabung dengan campaign lain)")

    return df


def analyze_data(df, title_label, output_prefix, output_dir):
    """
    Jalankan analisis lengkap pada DataFrame dan generate laporan + grafik.
    Semua campaign termasuk Kargo dianalisis bersama.
    """
    df_main = df.copy()

    df_aktif = df_main[df_main['Iklan_Aktif']].copy()

    if len(df_aktif) == 0:
        print(f"   [{title_label}] PERINGATAN: Tidak ada data aktif untuk dianalisis!")
        return

    # Pastikan kolom TTK dan KG ada
    if 'TTK' not in df_aktif.columns:
        df_aktif['TTK'] = np.nan
    if 'KG' not in df_aktif.columns:
        df_aktif['KG'] = np.nan
    if 'Views' not in df_aktif.columns:
        df_aktif['Views'] = np.nan
    if 'Link_Clicks' not in df_aktif.columns:
        df_aktif['Link_Clicks'] = np.nan
    if 'Viewers' not in df_aktif.columns:
        df_aktif['Viewers'] = np.nan

    unique_dates = df_aktif.index.unique()

    # ---- HITUNG METRIK ----
    df_ttk = df_aktif[df_aktif['TTK'].notna() & (df_aktif['TTK'] > 0)].copy()
    df_kg = df_aktif[df_aktif['KG'].notna() & (df_aktif['KG'] > 0)].copy()

    total_spend = df_aktif['Actual_Spend'].sum()
    total_views = df_aktif['Views'].sum()
    total_viewers = df_aktif['Viewers'].sum()
    total_clicks = df_aktif['Link_Clicks'].sum()
    total_ttk = df_ttk['TTK'].sum()
    total_kg = df_kg['KG'].sum()

    avg_cost_per_ttk = total_spend / total_ttk if total_ttk > 0 else 0
    avg_cost_per_kg = total_spend / total_kg if total_kg > 0 else 0

    # Agregasi per minggu
    df_agg_date = df_aktif.groupby(df_aktif.index).sum(numeric_only=True)
    # FORMULA: Cost per TTK Mingguan = Sum Spend / Sum TTK
    df_agg_date['Cost_per_TTK'] = df_agg_date['Actual_Spend'] / df_agg_date['TTK']
    df_agg_date['Cost_per_KG'] = df_agg_date['Actual_Spend'] / df_agg_date['KG']
    df_agg_date['CTR'] = (df_agg_date['Link_Clicks'] / df_agg_date['Views']) * 100
    df_agg_date.replace([np.inf, -np.inf], np.nan, inplace=True)

    # Tren
    trend_ttk = calc_trend(df_agg_date['TTK'])
    trend_kg = calc_trend(df_agg_date['KG'])
    trend_spend = calc_trend(df_agg_date['Actual_Spend'])
    trend_cost_per_ttk = calc_trend(df_agg_date['Cost_per_TTK'])
    trend_cost_per_kg = calc_trend(df_agg_date['Cost_per_KG'])
    trend_views = calc_trend(df_agg_date['Views'])
    trend_ctr = calc_trend(df_agg_date['CTR'])

    # Statistik per lokasi
    location_stats = []
    locations = df_aktif['Location'].unique()

    for loc in locations:
        dfl = df_aktif[df_aktif['Location'] == loc]
        dfl_agg = dfl.groupby(dfl.index).sum(numeric_only=True)

        loc_spend = dfl['Actual_Spend'].sum()
        loc_ttk = dfl['TTK'].sum()
        loc_kg = dfl['KG'].sum()

        # FORMULA: Cost per TTK Lokasi = Sum Spend / Sum TTK per lokasi
        loc_cpt = loc_spend / loc_ttk if loc_ttk > 0 else np.nan
        loc_cpk = loc_spend / loc_kg if loc_kg > 0 else np.nan

        trend_loc_ttk = calc_trend(dfl_agg['TTK'][dfl_agg['TTK'] > 0])

        location_stats.append({
            'Location': loc,
            'Spend': loc_spend,
            'TTK': loc_ttk,
            'KG': loc_kg,
            'Cost_per_TTK': loc_cpt,
            'Cost_per_KG': loc_cpk,
            'Trend_TTK_dir': trend_loc_ttk['direction'],
            'Trend_TTK_pct': trend_loc_ttk['pct_change']
        })

    df_loc_stats = pd.DataFrame(location_stats)
    if len(df_loc_stats) > 0 and 'Cost_per_TTK' in df_loc_stats.columns:
        df_loc_stats_sorted = df_loc_stats.sort_values(by='Cost_per_TTK', ascending=True, na_position='last')
    else:
        df_loc_stats_sorted = df_loc_stats

    # Bulanan
    df_aktif_copy = df_aktif.copy()
    df_aktif_copy['Bulan'] = df_aktif_copy.index.to_period('M')
    monthly = df_aktif_copy.groupby('Bulan').agg({
        'Actual_Spend': 'sum',
        'TTK': 'sum',
        'KG': 'sum',
        'Views': 'sum',
        'Link_Clicks': 'sum'
    })
    # FORMULA: Cost per TTK Bulanan = Sum Spend / Sum TTK per bulan
    monthly['Cost_per_TTK'] = monthly.apply(
        lambda r: r['Actual_Spend'] / r['TTK'] if r['TTK'] > 0 else np.nan, axis=1)
    monthly['Cost_per_KG'] = monthly.apply(
        lambda r: r['Actual_Spend'] / r['KG'] if r['KG'] > 0 else np.nan, axis=1)

    # Kesehatan konten
    df_valid = df_aktif[(df_aktif['Views'] > 0) & (df_aktif['Views'].notna())].copy()
    loc_health = df_valid.groupby('Location').agg({
        'Views': 'sum',
        'Link_Clicks': 'sum',
        'TTK': 'sum',
        'KG': 'sum',
        'Actual_Spend': 'sum'
    }).reset_index()

    # FORMULA: CTR Lokasi = (Sum Link Clicks / Sum Views) * 100
    loc_health['CTR (%)'] = (loc_health['Link_Clicks'] / loc_health['Views']) * 100
    # FORMULA: CVR Lokasi = (Sum TTK / Sum Link Clicks) * 100
    loc_health['CVR (%)'] = (loc_health['TTK'] / loc_health['Link_Clicks']) * 100
    loc_health['CPC (Rp)'] = loc_health['Actual_Spend'] / loc_health['Link_Clicks']
    loc_health.replace([np.inf, -np.inf], np.nan, inplace=True)

    avg_ctr = loc_health['CTR (%)'].mean()
    avg_cvr = loc_health['CVR (%)'].mean()

    stars = loc_health[(loc_health['CTR (%)'] >= avg_ctr) & (loc_health['CVR (%)'] >= avg_cvr)]['Location'].tolist()
    attention = loc_health[(loc_health['CTR (%)'] >= avg_ctr) & (loc_health['CVR (%)'] < avg_cvr)]['Location'].tolist()
    improve_content = loc_health[(loc_health['CTR (%)'] < avg_ctr) & (loc_health['CVR (%)'] >= avg_cvr)]['Location'].tolist()

    # ---- CETAK LAPORAN ----
    report_lines = []
    def p(text=""):
        print(text)
        report_lines.append(text)

    p("=" * 65)
    p(f"           LAPORAN ANALISIS META ADS - {title_label.upper()}")
    p("        WAHANA EXPRESS - PENGIRIMAN BARANG")
    p("=" * 65)

    p(f"\nPeriode Data  : {df_aktif.index.min().strftime('%d %b %Y')} - {df_aktif.index.max().strftime('%d %b %Y')}")
    p(f"Total Minggu  : {len(unique_dates)} minggu")

    # --- BAB 1: KESIMPULAN DARI GRAFIK ANALISIS ---
    p("\n=================================================================")
    p("      BAB 1: KESIMPULAN DARI GRAFIK ANALISIS (Performa Dasar)")
    p("=================================================================")

    # 1. Tren Biaya & Pengeluaran
    p("\n" + "-" * 65)
    p("1. TREN BIAYA & PENGELUARAN")
    p("-" * 65)
    p(f"  Total Spending Iklan    : Rp {total_spend:>15,.0f}")
    p(f"  Cost per TTK (rata-rata): Rp {avg_cost_per_ttk:>15,.0f}")
    p(f"  Cost per KG (rata-rata) : Rp {avg_cost_per_kg:>15,.0f}")
    p(f"  Status Tren Biaya       : {trend_cost_per_ttk['direction']} ({trend_cost_per_ttk['pct_change']:+.1f}%)")

    # 2. Tren Volume Pengiriman
    p("\n" + "-" * 65)
    p("2. TREN VOLUME PENGIRIMAN MINGGUAN")
    p("-" * 65)
    p(f"  Total TTK (Resi)        : {total_ttk:>15,.0f}")
    p(f"  Total KG Pengiriman     : {total_kg:>15,.0f}")
    p(f"  Status Tren TTK         : {trend_ttk['direction']} ({trend_ttk['pct_change']:+.1f}%)")
    p(f"  Status Tren Volume KG   : {trend_kg['direction']} ({trend_kg['pct_change']:+.1f}%)")

    # 3. Kontributor Terbesar
    p("\n" + "-" * 65)
    p("3. KONTRIBUTOR TERBESAR (Top Lokasi TTK)")
    p("-" * 65)
    if len(df_loc_stats_sorted) > 0:
        top3_loc = df_loc_stats_sorted.head(3)
        for _, row in top3_loc.iterrows():
            pct_contrib = (row['TTK'] / total_ttk) * 100 if total_ttk > 0 else 0
            p(f"  - {row['Location']:<18} : {row['TTK']:>6,.0f} resi ({pct_contrib:.1f}%)")
    else:
        p("  Tidak ada data lokasi spesifik.")

    # 4. Tingkat Efisiensi Anggaran
    p("\n" + "-" * 65)
    p("4. TINGKAT EFISIENSI ANGGARAN (Lokasi Cost/TTK Termurah)")
    p("-" * 65)
    recs = []
    for i, row in df_loc_stats_sorted.iterrows():
        if pd.isna(row['Cost_per_TTK']) and row['Spend'] > 0:
            recs.append(f"[!] MATIKAN iklan di {row['Location']} (Spend Rp {row['Spend']:,.0f} tanpa closing).")
        elif pd.notna(row['Cost_per_TTK']) and row['Cost_per_TTK'] > avg_cost_per_ttk * 1.5:
            recs.append(f"[!] EVALUASI/KURANGI budget {row['Location']} (Cost/TTK Rp {row['Cost_per_TTK']:,.0f} > rata-rata).")
        elif pd.notna(row['Cost_per_TTK']) and row['Cost_per_TTK'] < avg_cost_per_ttk * 0.8:
            recs.append(f"[+] NAIKKAN budget {row['Location']} (Sangat murah, Cost/TTK: Rp {row['Cost_per_TTK']:,.0f}).")
    if not recs:
        p("  Semua lokasi berkinerja merata, pertahankan strategi.")
    else:
        for r in recs:
            p(f"  {r}")

    # --- BAB 2: KESIMPULAN DARI GRAFIK KESEHATAN ---
    p("\n=================================================================")
    p("   BAB 2: KESIMPULAN DARI GRAFIK KESEHATAN (Kinerja & Interaksi)")
    p("=================================================================")

    # 5. Alur Konversi Keseluruhan
    pct_ctr = (total_clicks / total_views) * 100 if total_views > 0 else 0
    pct_cvr = (total_ttk / total_clicks) * 100 if total_clicks > 0 else 0
    pct_total = (total_ttk / total_views) * 100 if total_views > 0 else 0
    p("\n" + "-" * 65)
    p("5. ALUR KONVERSI KESELURUHAN (FLOWCHART FUNNEL)")
    p("-" * 65)
    p(f"  - Total Views           : {total_views:>15,.0f}")
    p(f"  - Total Link Clicks     : {total_clicks:>15,.0f}")
    p(f"  - Total Resi (TTK)      : {total_ttk:>15,.0f}")
    p("\n  Tingkat Konversi:")
    p(f"  - CTR (Daya Tarik Iklan): {pct_ctr:.2f}% (Persentase dari Views yang menjadi Klik)")
    p(f"  - CVR (Closing Sales)   : {pct_cvr:.2f}% (Persentase dari Klik yang menjadi Resi)")
    p(f"  - Total Konversi Akhir  : {pct_total:.2f}% (Persentase dari Views hingga menjadi Resi)")

    # 6. Analisis Kuadran
    p("\n" + "-" * 65)
    p("6. ANALISIS KUADRAN (Interaksi vs Closing)")
    p("-" * 65)
    p(f"  Rata-rata Global CTR (Daya Tarik)   : {avg_ctr:.2f}%")
    p(f"  Rata-rata Global CVR (Closing/Resi) : {avg_cvr:.2f}%")

    p("\n  [BINTANG IKLAN] Daya Tarik TINGGI, Closing TINGGI:")
    if stars: p("    - " + ", ".join(stars) + "\n    (Pertahankan konten iklan di daerah ini karena terbukti efektif)")
    else: p("    - Belum ada daerah yang masuk kategori ini.")

    p("\n  [BOCOR DI CS] Daya Tarik TINGGI, Closing RENDAH:")
    if attention: p("    - " + ", ".join(attention) + "\n    (Iklan banyak di-klik tapi jarang kirim. Evaluasi harga/layanan/CS segera)")
    else: p("    - Tidak ada.")

    p("\n  [KONTEN KURANG MENARIK] Daya Tarik RENDAH, Closing TINGGI:")
    if improve_content: p("    - " + ", ".join(improve_content) + "\n    (Sedikit yang klik, tapi yang klik PASTI kirim. Ganti/perbarui gambar iklan)")
    else: p("    - Tidak ada.")

    # 7. Pergerakan Mingguan Iklan
    p("\n" + "-" * 65)
    p("7. PERGERAKAN MINGGUAN KESEHATAN KONTEN")
    p("-" * 65)
    time_health = df_valid.groupby(df_valid.index).agg({'Views': 'sum', 'Link_Clicks': 'sum', 'TTK': 'sum'})
    if len(time_health) > 1:
        first_ctr = (time_health.iloc[0]['Link_Clicks'] / time_health.iloc[0]['Views']) * 100 if time_health.iloc[0]['Views'] > 0 else 0
        last_ctr = (time_health.iloc[-1]['Link_Clicks'] / time_health.iloc[-1]['Views']) * 100 if time_health.iloc[-1]['Views'] > 0 else 0
        first_cvr = (time_health.iloc[0]['TTK'] / time_health.iloc[0]['Link_Clicks']) * 100 if time_health.iloc[0]['Link_Clicks'] > 0 else 0
        last_cvr = (time_health.iloc[-1]['TTK'] / time_health.iloc[-1]['Link_Clicks']) * 100 if time_health.iloc[-1]['Link_Clicks'] > 0 else 0
        
        ctr_trend = "Meningkat" if last_ctr > first_ctr else "Menurun/Jenuh"
        cvr_trend = "Meningkat" if last_cvr > first_cvr else "Menurun"
        
        p(f"  - Daya Tarik (CTR) awal periode : {first_ctr:.2f}% | Akhir periode: {last_ctr:.2f}% -> [{ctr_trend.upper()}]")
        p(f"  - Closing (CVR) awal periode    : {first_cvr:.2f}% | Akhir periode: {last_cvr:.2f}% -> [{cvr_trend.upper()}]")
    else:
        p("  Data mingguan tidak cukup untuk melihat pergerakan historis.")

    # 8. Korelasi Klik dengan Volume
    p("\n" + "-" * 65)
    p("8. KORELASI KLIK VS VOLUME PENGIRIMAN (KG)")
    p("-" * 65)
    loc_health_kg = loc_health.dropna(subset=['KG']).copy()
    loc_health_kg = loc_health_kg[loc_health_kg['Link_Clicks'] > 0]
    med_clicks = loc_health_kg['Link_Clicks'].median() if not loc_health_kg.empty else 0
    med_kg = loc_health_kg['KG'].median() if not loc_health_kg.empty else 0
    high_click_high_kg = loc_health_kg[(loc_health_kg['Link_Clicks'] > med_clicks) & (loc_health_kg['KG'] > med_kg)]['Location'].tolist()
    high_click_low_kg = loc_health_kg[(loc_health_kg['Link_Clicks'] > med_clicks) & (loc_health_kg['KG'] <= med_kg)]['Location'].tolist()
    
    if high_click_high_kg:
        p("  [KORELASI SEHAT] Klik Tinggi -> Volume (KG) Tinggi:")
        p("    - " + ", ".join(high_click_high_kg))
    if high_click_low_kg:
        p("\n  [KORELASI KURANG EFISIEN] Klik Tinggi -> Volume (KG) Rendah:")
        p("    - " + ", ".join(high_click_low_kg))
        p("    (Iklan di daerah ini populer tapi seringnya hanya untuk pengiriman paket ringan)")
    if not high_click_high_kg and not high_click_low_kg:
        p("    - Tidak cukup data volume KG untuk menghitung korelasi.")


    p("\n" + "=" * 65)
    p("           AKHIR LAPORAN")
    p("=" * 65)

    # Simpan laporan
    report_path = output_dir / f'laporan_analisis_{output_prefix}.txt'
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(report_lines))
    print(f"\n[SAVED] Laporan tersimpan di: {report_path}")

    # ---- VISUALISASI ----
    print(f"\n   [{title_label}] Membuat visualisasi...")

    plt.style.use('seaborn-v0_8-darkgrid')
    plt.rcParams['font.size'] = 10

    fig, axes = plt.subplots(2, 2, figsize=(18, 12))
    fig.suptitle(f'Analisis Meta Ads Multi-Lokasi - Wahana Express ({title_label})',
                 fontsize=16, fontweight='bold', y=0.98)

    # 1. TTK per Minggu
    ax1 = axes[0, 0]
    if len(df_agg_date) > 0:
        actual_dates = df_agg_date.index
        x_pos = np.arange(len(actual_dates))
        date_labels = [d.strftime('%d/%m/%y') for d in actual_dates]
        ax1.bar(x_pos, df_agg_date['TTK'], alpha=0.7, color='#2196F3', label='Total TTK')
        ax1.set_xticks(x_pos)
        ax1.set_xticklabels(date_labels, rotation=45, ha='right')
        ax1.set_title('Total TTK (Resi) per Minggu', fontweight='bold')
        ax1.legend()
        for i, v in enumerate(df_agg_date['TTK']):
            if pd.notna(v) and v > 0:
                ax1.text(i, v + (v*0.02), f'{v:.0f}', ha='center', va='bottom', fontsize=8, fontweight='bold')

    # 2. Cost per TTK per Lokasi
    ax2 = axes[0, 1]
    valid_locs = df_loc_stats_sorted[df_loc_stats_sorted['Cost_per_TTK'].notna()]
    if len(valid_locs) > 0:
        x_pos = np.arange(len(valid_locs))
        ax2.bar(x_pos, valid_locs['Cost_per_TTK'] / 1000, color='#4CAF50', alpha=0.8)
        ax2.axhline(y=avg_cost_per_ttk / 1000, color='red', linestyle='--', label='Rata-rata Global')
        ax2.set_xticks(x_pos)
        ax2.set_xticklabels(valid_locs['Location'], rotation=45, ha='right')
        ax2.set_ylabel('Cost per TTK (Ribu Rp)', fontweight='bold')
        ax2.set_title('Efisiensi Biaya per Lokasi (Cost per TTK)', fontweight='bold')
        ax2.legend()
        for i, v in enumerate(valid_locs['Cost_per_TTK'] / 1000):
            ax2.text(i, v + (v*0.02), f'{v:.2f}K', ha='center', va='bottom', fontsize=8, fontweight='bold')

    # 3. TTK per Lokasi
    ax3 = axes[1, 0]
    if len(df_loc_stats_sorted) > 0:
        x_pos = np.arange(len(df_loc_stats_sorted))
        ax3.bar(x_pos, df_loc_stats_sorted['TTK'], color='#FF9800', alpha=0.8)
        ax3.set_xticks(x_pos)
        ax3.set_xticklabels(df_loc_stats_sorted['Location'], rotation=45, ha='right')
        ax3.set_ylabel('Jumlah Resi (TTK)', fontweight='bold')
        ax3.set_title('Total Kontribusi Resi (TTK) per Lokasi', fontweight='bold')
        for i, v in enumerate(df_loc_stats_sorted['TTK']):
            if pd.notna(v) and v > 0:
                ax3.text(i, v + (v*0.02), f'{v:.0f}', ha='center', va='bottom', fontsize=8, fontweight='bold')

    # 4. Cost per TTK per Bulan
    ax4 = axes[1, 1]
    monthly_valid = monthly[monthly['Cost_per_TTK'].notna()]
    if len(monthly_valid) > 0:
        month_labels = [str(m) for m in monthly_valid.index]
        x_pos = np.arange(len(month_labels))
        values = monthly_valid['Cost_per_TTK'] / 1000
        ax4.bar(x_pos, values, color='#9C27B0', alpha=0.8)
        ax4.set_xticks(x_pos)
        ax4.set_xticklabels(month_labels, rotation=45)
        ax4.set_ylabel('Cost per TTK (Ribu Rp)', fontweight='bold')
        ax4.set_title('Cost per TTK per Bulan', fontweight='bold')
        
        # Adjust scale to zoom in on differences
        min_val = values.min()
        max_val = values.max()
        if min_val > 0 and max_val > min_val:
            diff = max_val - min_val
            ax4.set_ylim(max(0, min_val - diff * 0.5), max_val + diff * 0.5)
            
        for i, v in enumerate(values):
            if v > 0:
                y_offset = (max_val - min_val) * 0.05 if max_val > min_val else v * 0.02
                ax4.text(i, v + y_offset, f'{v:.4f}K', ha='center', va='bottom', fontsize=8, fontweight='bold')

    plt.tight_layout(rect=[0, 0, 1, 0.95])
    chart_path = output_dir / f'grafik_analisis_{output_prefix}.png'
    plt.savefig(chart_path, dpi=150, bbox_inches='tight')
    plt.close()
    print(f"[SAVED] Grafik tersimpan di: {chart_path}")

    # ---- VISUALISASI KESEHATAN KONTEN ----
    print(f"   [{title_label}] Membuat visualisasi kesehatan konten...")
    
    def annotate_scatter(ax, df_plot, x_col, y_col):
        groups = {}
        for _, r in df_plot.iterrows():
            if pd.isna(r[x_col]) or pd.isna(r[y_col]): continue
            xr = round(r[x_col], 2)
            if xr not in groups: groups[xr] = []
            groups[xr].append(r)
        
        x_mean = df_plot[x_col].mean()
        for x_val, rows in groups.items():
            rows.sort(key=lambda r: r[y_col], reverse=True)
            for j, r in enumerate(rows):
                y_offset = ((len(rows)-1)/2.0 - j) * 20
                if len(rows) == 1: y_offset = 15
                x_offset = 40 if r[x_col] <= x_mean else -40
                ha_val = 'left' if x_offset > 0 else 'right'
                ax.annotate(r['Location'], xy=(r[x_col], r[y_col]),
                            xytext=(x_offset, y_offset), textcoords='offset points',
                            ha=ha_val, va='center', fontsize=9,
                            arrowprops=dict(arrowstyle="->", color='#555555', lw=0.8, alpha=0.7))

    fig2 = plt.figure(figsize=(20, 14))
    fig2.suptitle(f'Dashboard Kesehatan Konten (Interaksi Iklan & Pengiriman)\nWahana Express - {title_label}',
                  fontsize=20, fontweight='bold', y=0.98)
    gs = fig2.add_gridspec(2, 2)

    # Alur Konversi Keseluruhan (Flowchart)
    ax2_1 = fig2.add_subplot(gs[0, 0])
    ax2_1.axis('off')
    ax2_1.set_xlim(0, 1)
    ax2_1.set_ylim(0, 1)
    
    tv = loc_health['Views'].sum()
    tc = loc_health['Link_Clicks'].sum()
    tt = loc_health['TTK'].sum()
    
    pct_ctr = (tc / tv) * 100 if tv > 0 else 0
    pct_cvr = (tt / tc) * 100 if tc > 0 else 0
    pct_total = (tt / tv) * 100 if tv > 0 else 0
    
    period_str = f"{df_aktif.index.min().strftime('%d %b %Y')} - {df_aktif.index.max().strftime('%d %b %Y')}"
    ax2_1.set_title(f'Alur Konversi Keseluruhan\nPeriode: {period_str}', fontweight='bold', fontsize=16, pad=20)
    
    def draw_box(ax, x, y, w, h, title, val, color):
        box = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.05", 
                                     ec="none", fc=color, alpha=0.8)
        ax.add_patch(box)
        ax.text(x + w/2, y + h/2 + 0.05, title, ha='center', va='center', color='white', fontweight='bold', fontsize=12)
        ax.text(x + w/2, y + h/2 - 0.05, f"{int(val):,}", ha='center', va='center', color='white', fontweight='bold', fontsize=14)

    def draw_arrow(ax, x_start, x_end, y, top_text, bottom_text):
        ax.annotate('', xy=(x_end, y), xytext=(x_start, y),
                    arrowprops=dict(arrowstyle='simple', color='gray', lw=2))
        ax.text((x_start + x_end)/2, y + 0.05, top_text, ha='center', va='bottom', fontweight='bold', color='#333333', fontsize=11)
        ax.text((x_start + x_end)/2, y - 0.05, bottom_text, ha='center', va='top', fontweight='bold', color='#D32F2F', fontsize=14)

    draw_box(ax2_1, 0.05, 0.35, 0.2, 0.3, "1. Views", tv, '#2196F3')
    draw_box(ax2_1, 0.40, 0.35, 0.2, 0.3, "2. Link Clicks", tc, '#FF9800')
    draw_box(ax2_1, 0.75, 0.35, 0.2, 0.3, "3. Resi (TTK)", tt, '#4CAF50')

    draw_arrow(ax2_1, 0.26, 0.39, 0.5, "CTR (Daya Tarik)", f"{pct_ctr:.2f}%")
    draw_arrow(ax2_1, 0.61, 0.74, 0.5, "CVR (Closing)", f"{pct_cvr:.2f}%")

    ax2_1.text(0.5, 0.1, f"Total Konversi Keseluruhan (Views ke Resi): {pct_total:.2f}%", 
            ha='center', va='center', fontweight='bold', fontsize=12, 
            bbox=dict(boxstyle="round,pad=0.5", fc="#F5F5F5", ec="#E0E0E0"))

    # Scatter CTR vs CVR
    ax2_2 = fig2.add_subplot(gs[0, 1])
    loc_health_clean = loc_health.dropna(subset=['CTR (%)', 'CVR (%)'])
    if len(loc_health_clean) > 0:
        scatter = ax2_2.scatter(loc_health_clean['CTR (%)'], loc_health_clean['CVR (%)'],
                               s=loc_health_clean['Actual_Spend'] / 1000 + 100,
                               c=loc_health_clean['TTK'], cmap='viridis', alpha=0.7,
                               edgecolors='white', linewidth=2)
        annotate_scatter(ax2_2, loc_health_clean[loc_health_clean['TTK'] > 0], 'CTR (%)', 'CVR (%)')
        ax2_2.axvline(avg_ctr, color='r', linestyle='--', alpha=0.5, label='Rata-rata CTR')
        ax2_2.axhline(avg_cvr, color='b', linestyle='--', alpha=0.5, label='Rata-rata CVR')
        ax2_2.set_title('Kesehatan Konten: CTR vs CVR per Lokasi', fontweight='bold', fontsize=14)
        ax2_2.set_xlabel('CTR (%) -> Daya Tarik Iklan')
        ax2_2.set_ylabel('CVR (%) -> Efektivitas Closing')
        fig2.colorbar(scatter, ax=ax2_2, label='Jumlah Resi (TTK)')
        ax2_2.legend()

    # Tren Kualitas
    ax2_3 = fig2.add_subplot(gs[1, 0])
    if len(df_valid) > 0:
        time_health = df_valid.groupby(df_valid.index).agg({
            'Views': 'sum', 'Link_Clicks': 'sum', 'TTK': 'sum'
        })
        # FORMULA: CTR Mingguan = (Sum Link Clicks / Sum Views) * 100
        time_health['CTR (%)'] = (time_health['Link_Clicks'] / time_health['Views']) * 100
        # FORMULA: CVR Mingguan = (Sum TTK / Sum Link Clicks) * 100
        time_health['CVR (%)'] = (time_health['TTK'] / time_health['Link_Clicks']) * 100
        time_health.replace([np.inf, -np.inf], np.nan, inplace=True)

        ax2_3.plot(time_health.index, time_health['CTR (%)'], marker='o',
                   linewidth=2, color='#FF9800', label='CTR (%)')
        ax2_3.set_ylabel('CTR (%)', color='#FF9800', fontweight='bold')
        ax2_3_twin = ax2_3.twinx()
        ax2_3_twin.plot(time_health.index, time_health['CVR (%)'], marker='s',
                        linewidth=2, color='#4CAF50', label='CVR (%)')
        ax2_3_twin.set_ylabel('CVR (%)', color='#4CAF50', fontweight='bold')
        ax2_3.set_title('Tren Kesehatan Konten (Mingguan)', fontweight='bold', fontsize=14)
        actual_dates_health = time_health.index
        date_labels_health = [d.strftime('%d/%m') for d in actual_dates_health]
        ax2_3.set_xticks(actual_dates_health)
        ax2_3.set_xticklabels(date_labels_health, rotation=45, ha='right')
        lines, labels = ax2_3.get_legend_handles_labels()
        lines2, labels2 = ax2_3_twin.get_legend_handles_labels()
        ax2_3.legend(lines + lines2, labels + labels2, loc='upper left')

    # Interaksi Iklan vs Volume
    ax2_4 = fig2.add_subplot(gs[1, 1])
    if len(loc_health_clean) > 0:
        # FORMULA: Sumbu X = Sum Link Clicks, Sumbu Y = Sum KG per lokasi
        ax2_4.scatter(loc_health_clean['Link_Clicks'], loc_health_clean['KG'], s=100, alpha=0.6)
        if len(loc_health_clean) > 1:
            valid_scatter = loc_health_clean[loc_health_clean['KG'].notna() & (loc_health_clean['KG'] > 0)]
            if len(valid_scatter) > 1:
                z = np.polyfit(valid_scatter['Link_Clicks'], valid_scatter['KG'], 1)
                p_poly = np.poly1d(z)
                ax2_4.plot(valid_scatter['Link_Clicks'],
                          p_poly(valid_scatter['Link_Clicks']), color='red', linestyle='--')
        valid_kg = loc_health_clean[loc_health_clean['KG'].notna() & (loc_health_clean['KG'] > 0)]
        if len(valid_kg) > 0:
            annotate_scatter(ax2_4, valid_kg, 'Link_Clicks', 'KG')
        ax2_4.set_title('Interaksi Iklan vs Volume Pengiriman', fontweight='bold', fontsize=14)
        ax2_4.set_xlabel('Link Clicks (Minat)')
        ax2_4.set_ylabel('Total Berat (KG)')

    plt.tight_layout(rect=[0, 0, 1, 0.96])
    chart2_path = output_dir / f'grafik_kesehatan_{output_prefix}.png'
    plt.savefig(chart2_path, dpi=150, bbox_inches='tight')
    plt.close(fig2)
    print(f"[SAVED] Grafik kesehatan konten tersimpan di: {chart2_path}")

    return {
        'total_spend': total_spend,
        'total_ttk': total_ttk,
        'total_kg': total_kg,
        'total_views': total_views,
        'total_clicks': total_clicks,
        'avg_cost_per_ttk': avg_cost_per_ttk,
        'avg_cost_per_kg': avg_cost_per_kg,
        'locations': len(locations),
        'weeks': len(unique_dates),
    }


# ==========================================
# 3. PROSES DATA
# ==========================================
print("\n[1/4] Membaca dan membersihkan data...")

results = {}

# --- INDONESIA ---
if FILE_INDO.exists():
    df_indo = load_and_clean(FILE_INDO, label="INDONESIA")
    print("\n[2/4] Menganalisis data Indonesia...")
    results['indonesia'] = analyze_data(
        df_indo, "Indonesia", "indonesia", OUTPUT_DIR
    )
else:
    print(f"[SKIP] File {FILE_INDO.name} tidak ditemukan")

# --- MALAYSIA (gabung semua lokasi jadi 1: "Malaysia") ---
if FILE_MY.exists():
    df_my = load_and_clean(FILE_MY, label="MALAYSIA")

    # Gabung semua lokasi Malaysia jadi 1 lokasi "Malaysia"
    # Agregasi per minggu: sum semua lokasi per tanggal
    numeric_agg = {}
    for col in ['Actual_Spend', 'Budget', 'Views', 'Viewers', 'Link_Clicks', 'TTK', 'KG']:
        if col in df_my.columns:
            numeric_agg[col] = 'sum'

    # Simpan kolom non-numerik dari baris pertama tiap minggu
    other_cols_to_keep = ['Campaign', 'Region', 'Is_Kargo', '_Date_str', '_group_key']
    existing_other = [c for c in other_cols_to_keep if c in df_my.columns]

    df_my_agg = df_my.groupby(df_my.index).agg(
        {**numeric_agg, **{c: 'first' for c in existing_other}}
    )
    df_my_agg['Location'] = 'Malaysia'
    df_my_agg['Iklan_Aktif'] = df_my_agg['Actual_Spend'].notna() & (df_my_agg['Actual_Spend'] > 0)

    print(f"   [MALAYSIA] Lokasi digabung menjadi 1: 'Malaysia' ({len(df_my_agg)} minggu)")

    print("\n[3/4] Menganalisis data Malaysia...")
    results['malaysia'] = analyze_data(
        df_my_agg, "Malaysia", "malaysia", OUTPUT_DIR
    )
else:
    print(f"[SKIP] File {FILE_MY.name} tidak ditemukan")

# ==========================================
# 4. RINGKASAN GABUNGAN
# ==========================================
print("\n[4/4] Membuat ringkasan gabungan...")

if len(results) > 1:
    report_combined = []
    def pc(text=""):
        print(text)
        report_combined.append(text)

    pc("=" * 65)
    pc("     RINGKASAN GABUNGAN: INDONESIA + MALAYSIA")
    pc("        WAHANA EXPRESS - META ADS")
    pc("=" * 65)

    for region, data in results.items():
        if data is None:
            continue
        pc(f"\n  --- {region.upper()} ---")
        pc(f"  Total Spend          : Rp {data['total_spend']:>15,.0f}")
        pc(f"  Total TTK            : {data['total_ttk']:>15,.0f}")
        pc(f"  Total KG             : {data['total_kg']:>15,.0f}")
        pc(f"  Total Views          : {data['total_views']:>15,.0f}")
        pc(f"  Cost per TTK         : Rp {data['avg_cost_per_ttk']:>15,.0f}")
        pc(f"  Cost per KG          : Rp {data['avg_cost_per_kg']:>15,.0f}")
        pc(f"  Jumlah Lokasi        : {data['locations']}")
        pc(f"  Jumlah Minggu        : {data['weeks']}")

    # Perbandingan
    if 'indonesia' in results and results['indonesia'] and 'malaysia' in results and results['malaysia']:
        indo = results['indonesia']
        my = results['malaysia']
        pc("\n" + "-" * 65)
        pc("  PERBANDINGAN EFISIENSI")
        pc("-" * 65)
        if indo['avg_cost_per_ttk'] > 0 and my['avg_cost_per_ttk'] > 0:
            if indo['avg_cost_per_ttk'] < my['avg_cost_per_ttk']:
                pct = ((my['avg_cost_per_ttk'] - indo['avg_cost_per_ttk']) / indo['avg_cost_per_ttk']) * 100
                pc(f"  Indonesia LEBIH MURAH {pct:.1f}% dari Malaysia (Cost/TTK)")
            else:
                pct = ((indo['avg_cost_per_ttk'] - my['avg_cost_per_ttk']) / my['avg_cost_per_ttk']) * 100
                pc(f"  Malaysia LEBIH MURAH {pct:.1f}% dari Indonesia (Cost/TTK)")

        indo_total_spend = indo['total_spend']
        my_total_spend = my['total_spend']
        total_all = indo_total_spend + my_total_spend
        if total_all > 0:
            pc(f"\n  Alokasi Budget:")
            pc(f"    Indonesia : Rp {indo_total_spend:>12,.0f} ({indo_total_spend/total_all*100:.1f}%)")
            pc(f"    Malaysia  : Rp {my_total_spend:>12,.0f} ({my_total_spend/total_all*100:.1f}%)")

    pc("\n" + "=" * 65)
    pc("     AKHIR RINGKASAN GABUNGAN")
    pc("=" * 65)

    combined_path = OUTPUT_DIR / 'laporan_gabungan_indo_malaysia.txt'
    with open(combined_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(report_combined))
    print(f"\n[SAVED] Laporan gabungan tersimpan di: {combined_path}")

print("\n" + "=" * 60)
print("[DONE] Analisis selesai! Semua output di folder: analysis_output/")
print("=" * 60)
