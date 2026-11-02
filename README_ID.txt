APLIKASI KASIR GRIYA ANIS — PAKET SIAP DEPLOY

Fitur:
- Login PIN kasir
- Scan barcode dengan kamera HP (browser Chrome yang mendukung BarcodeDetector)
- Cari produk berdasarkan nama/barcode
- Tambah dan edit produk
- Stok masuk
- Transaksi penjualan dengan pengurangan stok atomik
- Laporan omzet, jumlah transaksi, perkiraan laba kotor, stok menipis
- Unduh cadangan data JSON
- Tampilan web responsif dan dapat ditambahkan ke layar utama HP

PENTING:
Ini adalah paket siap dipasang untuk uji coba, bukan layanan yang sudah online.
Jangan gunakan sebagai satu-satunya catatan stok/keuangan sebelum diuji dan dibuat backup rutin.
Paket gratis Render dapat tidur saat tidak aktif. Kamera memerlukan HTTPS dan izin kamera.
Barcode harus didaftarkan ke produk terlebih dahulu. Untuk barcode yang belum terdaftar, tambahkan produk dan isi barcode-nya.

CARA PALING MUDAH:
1. Buat repository GitHub baru bernama griya-anis-kasir.
2. Upload seluruh isi folder ini ke repository (bukan file ZIP-nya).
3. Di Render pilih New > Blueprint, hubungkan repository tersebut.
4. Render membaca render.yaml dan membuat layanan web.
5. Pada Environment Render isi:
   DATABASE_URL = connection string Neon (gunakan connection pooling / pooled URI)
   APP_PIN = PIN rahasia pilihan Anda (4–12 angka/huruf)
   JWT_SECRET = string acak panjang minimal 32 karakter (jangan dibagikan)
6. Deploy. Buka URL .onrender.com yang diberikan Render.
7. Login menggunakan APP_PIN.
8. Tambahkan produk dan barcode. Uji transaksi kecil dahulu.

NEON:
- Project dan database harus sudah dibuat.
- Pada Connect > Postgres database pilih Compute: Primary, Database: neondb, Role: neondb_owner.
- Connection pooling boleh aktif. Salin URI langsung ke Environment Variable DATABASE_URL di Render.
- Jangan kirim connection string/password ke chat atau repository.

CATATAN:
- Semua tabel dibuat otomatis saat server pertama kali berjalan.
- Jangan pernah memasukkan DATABASE_URL, APP_PIN, atau JWT_SECRET ke file publik/GitHub.
- Periksa batas penggunaan paket gratis Render dan Neon dari dashboard masing-masing.
- Backup JSON dapat diunduh dari menu Laporan; simpan di tempat aman secara berkala.
