<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { 
  NConfigProvider, NMessageProvider, NDialogProvider, NNotificationProvider,
  darkTheme, NButton, NInput, NSelect, NModal, NCard, NTag, NSpin, NEmpty
} from 'naive-ui'
import { useGlobalState } from './store'
import { api } from './api'

const { jwt, settings, openSettings } = useGlobalState()

// State Tema (Default Dark ala Cronies)
const isDark = ref(true)
const theme = computed(() => (isDark.value ? darkTheme : null))

// State Email & Domain
const emailPrefix = ref('')
const selectedDomain = ref('')
const domains = computed(() => {
  const list = settings.value?.domains || []
  return list.map(d => ({ label: `@${d}`, value: d }))
})

const currentAddress = ref('')
const isPrivateMode = ref(false)
const shareableLink = ref('')

// State Inbox
const mails = ref([])
const selectedMail = ref(null)
const loading = ref(false)
const autoRefreshTimer = ref(null)
const countdown = ref(10)

// State Modal Admin (Buat Private Email)
const showAdminModal = ref(false)
const adminPassword = ref('')
const privatePrefix = ref('')
const adminError = ref('')
const createdPrivateLink = ref('')

// State Pesan Status / Error
const statusMessage = ref('')
const statusType = ref('info') // 'info' | 'error' | 'success'

const showNotify = (msg, type = 'info') => {
  statusMessage.value = msg
  statusType.value = type
  setTimeout(() => {
    if (statusMessage.value === msg) statusMessage.value = ''
  }, 5000)
}

// Ambil daftar kunci private yang disimpan di LocalStorage / Tag khusus
// Catatan: Di cloudflare_temp_email bawaan, setiap email baru menghasilkan JWT unik.
// Supaya email Public bisa diakses ketik nama tapi Private dikunci, kita gunakan sistem prefix/mapping
// atau simpan daftar email public vs private.
const accessPublicEmail = async () => {
  if (!emailPrefix.value.trim()) {
    showNotify('Masukkan nama email terlebih dahulu!', 'error')
    return
  }
  const cleanPrefix = emailPrefix.value.trim().toLowerCase()
  const domain = selectedDomain.value || (settings.value.domains?.[0] || '')
  const fullEmail = `${cleanPrefix}@${domain}`

  loading.value = true
  statusMessage.value = ''
  try {
    // Cek apakah email ini ditandai sebagai PRIVATE di server / aturan kita
    // Jika kita gunakan endpoint bawaan /api/new_address, jika nama sudah dipakai oleh Private,
    // backend cloudflare_temp_email akan menolak pembuatan ulang dengan nama yang sama!
    const res = await api.fetch('/api/new_address', {
      method: 'POST',
      body: JSON.stringify({
        name: cleanPrefix,
        domain: domain,
        is_public: true // Flag tambahan jika worker Anda sudah dimodifikasi untuk public/private
      })
    })

    if (res && res.jwt) {
      jwt.value = res.jwt
      currentAddress.value = res.address || fullEmail
      isPrivateMode.value = false
      shareableLink.value = ''
      selectedMail.value = null
      await fetchMails()
      showNotify(`Berhasil membuka inbox public: ${currentAddress.value}`, 'success')
    }
  } catch (err) {
    // Jika gagal karena email sudah dikunci / dibuat sebagai Private
    showNotify(
      'Akses Ditolak! Email ini bersifat PRIVATE dan hanya bisa dibuka melalui Link Akses Khusus.',
      'error'
    )
  } finally {
    loading.value = false
  }
}

// Generate Random Public Email
const generateRandomPublic = async () => {
  const randomStr = Math.random().toString(36).substring(2, 9)
  emailPrefix.value = randomStr
  await accessPublicEmail()
}

// Buat Private Email (Khusus Admin: nethacantik)
const createPrivateEmail = async () => {
  adminError.value = ''
  createdPrivateLink.value = ''

  if (adminPassword.value !== 'nethacantik') {
    adminError.value = 'Password Admin salah!'
    return
  }
  if (!privatePrefix.value.trim()) {
    adminError.value = 'Masukkan nama email private yang ingin dibuat!'
    return
  }

  const cleanPrefix = privatePrefix.value.trim().toLowerCase()
  const domain = selectedDomain.value || (settings.value.domains?.[0] || '')

  loading.value = true
  try {
    const res = await api.fetch('/api/new_address', {
      method: 'POST',
      headers: {
        'x-admin-auth': adminPassword.value
      },
      body: JSON.stringify({
        name: cleanPrefix,
        domain: domain,
        is_private: true
      })
    })

    if (res && res.jwt) {
      jwt.value = res.jwt
      currentAddress.value = res.address || `${cleanPrefix}@${domain}`
      isPrivateMode.value = true
      
      // Buat Link Akses Khusus
      const origin = window.location.origin
      const link = `${origin}/?jwt=${res.jwt}`
      shareableLink.value = link
      createdPrivateLink.value = link

      selectedMail.value = null
      await fetchMails()
      showNotify(`Private Email berhasil dibuat!`, 'success')
    }
  } catch (err) {
    adminError.value = err.message || 'Gagal membuat email private (mungkin nama sudah terpakai).'
  } finally {
    loading.value = false
  }
}

// Ambil Daftar Email Masuk (Inbox)
const fetchMails = async () => {
  if (!jwt.value) return
  try {
    const res = await api.fetch(`/api/mails?limit=20&offset=0`)
    if (res && res.results) {
      mails.value = res.results
    }
  } catch (err) {
    console.error('Gagal mengambil email:', err)
  }
}

// Copy teks ke Clipboard
const copyText = (text, label = 'Teks') => {
  if (!text) return
  navigator.clipboard.writeText(text)
  showNotify(`${label} berhasil disalin!`, 'success')
}

// Cek apakah user membuka via Link Akses Khusus (?jwt=...)
onMounted(async () => {
  try {
    await openSettings()
    if (settings.value?.domains?.length > 0) {
      selectedDomain.value = settings.value.domains[0]
    }
  } catch (e) {
    console.error(e)
  }

  const urlParams = new URLSearchParams(window.location.search)
  const urlJwt = urlParams.get('jwt')

  if (urlJwt) {
    // Jika masuk lewat Link Akses Private
    jwt.value = urlJwt
    isPrivateMode.value = true
    shareableLink.value = window.location.href
    try {
      const settingsRes = await api.fetch('/api/settings')
      if (settingsRes && settingsRes.address) {
        currentAddress.value = settingsRes.address
      }
      await fetchMails()
      showNotify('Berhasil masuk melalui Link Akses Khusus (Private Mode)', 'success')
    } catch (e) {
      showNotify('Link akses tidak valid atau sudah kadaluarsa.', 'error')
    }
  } else if (jwt.value) {
    // Jika sudah ada sesi sebelumnya
    try {
      const settingsRes = await api.fetch('/api/settings')
      if (settingsRes && settingsRes.address) {
        currentAddress.value = settingsRes.address
        await fetchMails()
      }
    } catch (e) {
      jwt.value = ''
    }
  }

  // Timer Auto-Refresh tiap 10 detik
  autoRefreshTimer.value = setInterval(() => {
    if (jwt.value) {
      countdown.value--
      if (countdown.value <= 0) {
        fetchMails()
        countdown.value = 10
      }
    }
  }, 1000)
})

onUnmounted(() => {
  if (autoRefreshTimer.value) clearInterval(autoRefreshTimer.value)
})
</script>

<template>
  <n-config-provider :theme="theme">
    <div :class="['cronies-wrapper', isDark ? 'dark-mode' : 'light-mode']">
      
      <!-- NAVBAR ALA CRONIES -->
      <header class="cronies-header">
        <div class="brand">
          <div class="brand-icon">✉️</div>
          <div>
            <h1 class="brand-title">TempMail</h1>
            <span class="brand-subtitle">Fast & Secure Disposable Mailbox</span>
          </div>
        </div>

        <div class="header-actions">
          <button class="btn-outline" @click="showAdminModal = true">
            🔒 Buat Private Email
          </button>
          <button class="btn-icon" @click="isDark = !isDark" title="Ganti Tema">
            {{ isDark ? '☀️' : '🌙' }}
          </button>
        </div>
      </header>

      <!-- NOTIFIKASI BANNER -->
      <div v-if="statusMessage" :class="['alert-banner', statusType]">
        {{ statusMessage }}
      </div>

      <!-- KONTEN UTAMA -->
      <main class="cronies-main">
        
        <!-- CARD 1: KONTROL EMAIL (PUBLIC ACCESS & ACTIVE ADDRESS) -->
        <section class="cronies-card address-card">
          <div class="card-header-row">
            <span class="section-label">ALAMAT EMAIL AKTIF</span>
            <span v-if="currentAddress" :class="['mode-badge', isPrivateMode ? 'private' : 'public']">
              {{ isPrivateMode ? '🔒 PRIVATE INBOX' : '🌐 PUBLIC INBOX' }}
            </span>
          </div>

          <!-- Tampilan Email Aktif -->
          <div class="active-email-box">
            <input 
              type="text" 
              readonly 
              :value="currentAddress || 'Belum ada email dipilih...'" 
              class="active-email-input"
            />
            <button 
              class="btn-primary" 
              :disabled="!currentAddress"
              @click="copyText(currentAddress, 'Alamat Email')"
            >
              📋 Salin
            </button>
          </div>

          <!-- Jika Mode Private, tampilkan Link Akses Khusus -->
          <div v-if="isPrivateMode && shareableLink" class="private-link-box">
            <span class="private-link-label">🔗 Link Akses Khusus (Simpan/Bagikan ke Pembeli):</span>
            <div class="private-link-row">
              <input type="text" readonly :value="shareableLink" class="private-link-input" />
              <button class="btn-secondary" @click="copyText(shareableLink, 'Link Akses')">
                Salin Link
              </button>
            </div>
          </div>

          <hr class="divider" />

          <!-- Input Buka / Buat Email Public -->
          <div class="public-form-section">
            <label class="section-label">BUKA / BUAT EMAIL PUBLIC (TANPA PASSWORD)</label>
            <div class="input-group">
              <input 
                v-model="emailPrefix" 
                type="text" 
                placeholder="Ketik nama email (contoh: budi123)" 
                class="custom-input"
                @keyup.enter="accessPublicEmail"
              />
              <select v-model="selectedDomain" class="custom-select">
                <option v-for="d in domains" :key="d.value" :value="d.value">
                  {{ d.label }}
                </option>
              </select>
              <button class="btn-primary" :disabled="loading" @click="accessPublicEmail">
                {{ loading ? 'Memuat...' : 'Buka Inbox' }}
              </button>
              <button class="btn-secondary" :disabled="loading" @click="generateRandomPublic">
                🎲 Random
              </button>
            </div>
            <p class="helper-text">
              *Siapa saja bisa mengakses email Public hanya dengan mengetik namanya. Untuk membuat email yang terkunci, gunakan tombol <b>Buat Private Email</b> di kanan atas.
            </p>
          </div>
        </section>

        <!-- CARD 2: INBOX & ISI PESAN (SPLIT ATAU LIST ALA CRONIES) -->
        <section class="cronies-inbox-grid">
          
          <!-- Panel Kiri: Daftar Pesan Masuk -->
          <div class="cronies-card inbox-list-card">
            <div class="inbox-header">
              <h3>📥 Kotak Masuk ({{ mails.length }})</h3>
              <div class="refresh-controls" v-if="jwt">
                <span class="countdown-text">Auto-refresh: {{ countdown }}s</span>
                <button class="btn-small" @click="fetchMails">🔄 Refresh</button>
              </div>
            </div>

            <div v-if="!jwt" class="empty-state">
              <p>Silakan ketik nama email di atas untuk membuka kotak masuk.</p>
            </div>

            <div v-else-if="mails.length === 0" class="empty-state">
              <div class="pulse-ring"></div>
              <p>Menunggu email masuk ke <b>{{ currentAddress }}</b>...</p>
            </div>

            <ul v-else class="mail-list">
              <li 
                v-for="mail in mails" 
                :key="mail.id" 
                :class="['mail-item', selectedMail?.id === mail.id ? 'active' : '']"
                @click="selectedMail = mail"
              >
                <div class="mail-item-top">
                  <span class="mail-sender">{{ mail.source || 'Pengirim Tidak Diketahui' }}</span>
                  <span class="mail-date">{{ mail.created_at }}</span>
                </div>
                <div class="mail-subject">{{ mail.subject || '(Tanpa Subjek)' }}</div>
              </li>
            </ul>
          </div>

          <!-- Panel Kanan: Isi Email -->
          <div class="cronies-card mail-viewer-card">
            <div v-if="!selectedMail" class="empty-state">
              <p>👈 Pilih salah satu pesan di sebelah kiri untuk membaca isinya.</p>
            </div>

            <div v-else class="mail-detail">
              <div class="mail-detail-header">
                <h2>{{ selectedMail.subject || '(Tanpa Subjek)' }}</h2>
                <div class="mail-meta">
                  <span><b>Dari:</b> {{ selectedMail.source }}</span>
                  <span><b>Waktu:</b> {{ selectedMail.created_at }}</span>
                </div>
              </div>
              <div class="mail-body">
                <iframe 
                  v-if="selectedMail.message || selectedMail.html" 
                  :srcdoc="selectedMail.html || selectedMail.message" 
                  class="mail-iframe"
                ></iframe>
                <pre v-else class="mail-pre">{{ selectedMail.text || selectedMail.raw }}</pre>
              </div>
            </div>
          </div>

        </section>
      </main>

      <!-- MODAL ADMIN: BUAT PRIVATE EMAIL -->
      <n-modal v-model:show="showAdminModal">
        <n-card
          style="width: 460px; max-width: 95vw; border-radius: 14px;"
          title="🔒 Buat Private Email (Khusus Admin)"
          :bordered="false"
          size="huge"
          role="dialog"
          aria-modal="true"
        >
          <div class="modal-form">
            <label>Password Admin</label>
            <input 
              v-model="adminPassword" 
              type="password" 
              placeholder="Masukkan password admin..." 
              class="custom-input full-width"
            />

            <label style="margin-top: 12px;">Nama Email Private</label>
            <div class="input-group">
              <input 
                v-model="privatePrefix" 
                type="text" 
                placeholder="contoh: netflixvip01" 
                class="custom-input"
              />
              <select v-model="selectedDomain" class="custom-select">
                <option v-for="d in domains" :key="d.value" :value="d.value">
                  {{ d.label }}
                </option>
              </select>
            </div>

            <p v-if="adminError" class="error-text">{{ adminError }}</p>

            <div v-if="createdPrivateLink" class="success-box">
              <p><b>✅ Berhasil Dibuat!</b> Hanya yang memiliki link ini yang bisa membuka inbox:</p>
              <input type="text" readonly :value="createdPrivateLink" class="custom-input full-width" />
              <button class="btn-primary full-width" style="margin-top:8px;" @click="copyText(createdPrivateLink, 'Link Private')">
                📋 Salin Link Akses Private
              </button>
            </div>

            <div class="modal-actions">
              <button class="btn-secondary" @click="showAdminModal = false">Tutup</button>
              <button class="btn-primary" :disabled="loading" @click="createPrivateEmail">
                {{ loading ? 'Memproses...' : 'Buat & Kunci Email' }}
              </button>
            </div>
          </div>
        </n-card>
      </n-modal>

    </div>
  </n-config-provider>
</template>

<style scoped>
/* RESET & TEMA CRONIES */
.cronies-wrapper {
  min-height: 100vh;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  transition: background 0.2s, color 0.2s;
  padding-bottom: 40px;
}

.dark-mode {
  background-color: #0b0f19;
  color: #f1f5f9;
}

.light-mode {
  background-color: #f8fafc;
  color: #0f172a;
}

/* HEADER */
.cronies-header {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  font-size: 28px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
}

.brand-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.brand-subtitle {
  font-size: 12px;
  opacity: 0.65;
}

.header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

/* LAYOUT UTAMA */
.cronies-main {
  max-width: 1100px;
  margin: 24px auto 0;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.cronies-card {
  border-radius: 16px;
  padding: 20px;
  border: 1px solid rgba(148, 163, 184, 0.15);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}

.dark-mode .cronies-card {
  background-color: #111827;
}

.light-mode .cronies-card {
  background-color: #ffffff;
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.8px;
  opacity: 0.6;
  display: block;
  margin-bottom: 8px;
}

.mode-badge {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 999px;
}

.mode-badge.public {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.mode-badge.private {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

/* KOTAK EMAIL AKTIF */
.active-email-box {
  display: flex;
  gap: 10px;
}

.active-email-input {
  flex: 1;
  font-size: 18px;
  font-weight: 600;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.08);
  color: inherit;
  outline: none;
}

.private-link-box {
  margin-top: 12px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px dashed rgba(245, 158, 11, 0.4);
}

.private-link-label {
  font-size: 12px;
  color: #fbbf24;
  font-weight: 600;
  display: block;
  margin-bottom: 6px;
}

.private-link-row {
  display: flex;
  gap: 8px;
}

.private-link-input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(0, 0, 0, 0.2);
  color: inherit;
  font-size: 13px;
}

.divider {
  border: none;
  border-top: 1px solid rgba(148, 163, 184, 0.15);
  margin: 18px 0;
}

/* INPUT & TOMBOL */
.input-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.custom-input, .custom-select {
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.4);
  color: inherit;
  font-size: 14px;
  outline: none;
}

.light-mode .custom-input, .light-mode .custom-select {
  background: #f1f5f9;
}

.custom-input {
  flex: 1;
  min-width: 180px;
}

.full-width {
  width: 100%;
  box-sizing: border-box;
}

.btn-primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  border: none;
  padding: 10px 18px;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-secondary {
  background: rgba(148, 163, 184, 0.15);
  color: inherit;
  border: 1px solid rgba(148, 163, 184, 0.2);
  padding: 10px 16px;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
}

.btn-outline {
  background: transparent;
  color: inherit;
  border: 1px solid rgba(99, 102, 241, 0.5);
  padding: 8px 14px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.btn-icon {
  background: rgba(148, 163, 184, 0.15);
  border: none;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 16px;
}

.helper-text {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 8px;
  margin-bottom: 0;
}

/* GRID INBOX */
.cronies-inbox-grid {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 20px;
  min-height: 460px;
}

@media (max-width: 820px) {
  .cronies-inbox-grid {
    grid-template-columns: 1fr;
  }
}

.inbox-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.inbox-header h3 {
  margin: 0;
  font-size: 16px;
}

.refresh-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.countdown-text {
  font-size: 12px;
  opacity: 0.6;
}

.btn-small {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.mail-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mail-item {
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  cursor: pointer;
  transition: background 0.15s;
}

.mail-item:hover, .mail-item.active {
  background: rgba(99, 102, 241, 0.12);
  border-color: rgba(99, 102, 241, 0.4);
}

.mail-item-top {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  opacity: 0.75;
  margin-bottom: 4px;
}

.mail-sender {
  font-weight: 600;
}

.mail-subject {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  opacity: 0.6;
}

.mail-detail-header {
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  padding-bottom: 12px;
  margin-bottom: 14px;
}

.mail-detail-header h2 {
  margin: 0 0 8px 0;
  font-size: 18px;
}

.mail-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  opacity: 0.75;
}

.mail-iframe {
  width: 100%;
  min-height: 360px;
  border: none;
  border-radius: 8px;
  background: #fff;
}

.alert-banner {
  max-width: 1100px;
  margin: 12px auto 0;
  padding: 12px 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
}

.alert-banner.error {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.alert-banner.success {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

.error-text {
  color: #f87171;
  font-size: 13px;
  margin: 4px 0;
}

.success-box {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  padding: 12px;
  border-radius: 10px;
  margin-top: 10px;
}
</style>
