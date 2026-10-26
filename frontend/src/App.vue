<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { NConfigProvider, darkTheme, NModal, NCard } from 'naive-ui'
import { useGlobalState } from './store'
import { api } from './api'

const { jwt, settings, openSettings } = useGlobalState()

// Tema Default Dark Mode
const isDark = ref(true)
const theme = computed(() => (isDark.value ? darkTheme : null))

// Tab Mode Akses di Halaman Utama: 'public' atau 'private_link'
const accessTab = ref('public')
const privateLinkInput = ref('')

// State Input Email & Domain (Default otomatis ke nethanie.my.id jika settings belum termuat)
const emailPrefix = ref('')
const selectedDomain = ref('nethanie.my.id')
const domains = computed(() => {
  const list = settings.value?.domains?.length ? settings.value.domains : ['nethanie.my.id']
  return list.map(d => ({ label: `@${d}`, value: d }))
})

const currentAddress = ref('')
const isPrivateMode = ref(false)
const shareableLink = ref('')

// State Kotak Masuk (Inbox)
const mails = ref([])
const selectedMail = ref(null)
const mailDetailLoading = ref(false)
const loading = ref(false)
const autoRefreshTimer = ref(null)
const countdown = ref(10)

// State Modal Admin (Buat / Ambil Ulang Link Private Email)
const showAdminModal = ref(false)
const adminTab = ref('create') // 'create' (Buat Baru) | 'recover' (Lupa/Ambil Link)
const adminPassword = ref('')
const privatePrefix = ref('')
const adminError = ref('')

// State Feedback Tombol Copy
const copiedEmail = ref(false)
const copiedLink = ref(false)

// Notifikasi Banner
const statusMessage = ref('')
const statusType = ref('info')

const showNotify = (msg, type = 'info') => {
  statusMessage.value = msg
  statusType.value = type
  setTimeout(() => {
    if (statusMessage.value === msg) statusMessage.value = ''
  }, 5000)
}

// Fungsi Salin Teks Anti-Gagal
const copyText = async (text, type = 'email') => {
  if (!text) return
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
    } else {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }

    if (type === 'email') {
      copiedEmail.value = true
      setTimeout(() => { copiedEmail.value = false }, 2000)
      showNotify('Alamat email berhasil disalin!', 'success')
    } else {
      copiedLink.value = true
      setTimeout(() => { copiedLink.value = false }, 2000)
      showNotify('Link Akses Private berhasil disalin!', 'success')
    }
  } catch (err) {
    showNotify('Gagal menyalin otomatis, silakan blok dan salin manual.', 'error')
  }
}

// 1A. FUNGSI BUKA INBOX PUBLIC (action: 'open')
const openPublicInbox = async () => {
  if (!emailPrefix.value.trim()) {
    showNotify('Ketik nama email yang ingin dibuka terlebih dahulu!', 'error')
    return
  }
  const cleanPrefix = emailPrefix.value.trim().toLowerCase().split('@')[0]
  const domain = selectedDomain.value || 'nethanie.my.id'

  loading.value = true
  statusMessage.value = ''
  try {
    const res = await api.fetch('/api/new_address', {
      method: 'POST',
      body: JSON.stringify({
        action: 'open',
        name: cleanPrefix,
        domain: domain,
        is_private: false
      })
    })

    if (res && res.jwt) {
      jwt.value = res.jwt
      currentAddress.value = res.address || `${cleanPrefix}@${domain}`
      isPrivateMode.value = false
      shareableLink.value = ''
      selectedMail.value = null
      window.history.replaceState({}, document.title, window.location.pathname)
      await fetchMails()
      showNotify(`Berhasil membuka Public Inbox: ${currentAddress.value}`, 'success')
    }
  } catch (err) {
    showNotify(
      err.message || 'Akses Ditolak! Email ini bersifat PRIVATE dan hanya bisa diakses lewat Link Khusus.',
      'error'
    )
  } finally {
    loading.value = false
  }
}

// 1B. FUNGSI BUAT EMAIL PUBLIC BARU (action: 'create')
const createPublicInbox = async () => {
  if (!emailPrefix.value.trim()) {
    showNotify('Ketik nama email baru yang ingin dibuat, atau klik tombol Random!', 'error')
    return
  }
  const cleanPrefix = emailPrefix.value.trim().toLowerCase().split('@')[0]
  const domain = selectedDomain.value || 'nethanie.my.id'

  loading.value = true
  statusMessage.value = ''
  try {
    const res = await api.fetch('/api/new_address', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        name: cleanPrefix,
        domain: domain,
        is_private: false
      })
    })

    if (res && res.jwt) {
      jwt.value = res.jwt
      currentAddress.value = res.address || `${cleanPrefix}@${domain}`
      isPrivateMode.value = false
      shareableLink.value = ''
      selectedMail.value = null
      window.history.replaceState({}, document.title, window.location.pathname)
      await fetchMails()
      showNotify(`Email Public ${currentAddress.value} siap digunakan!`, 'success')
    }
  } catch (err) {
    showNotify(err.message || 'Gagal membuat email public.', 'error')
  } finally {
    loading.value = false
  }
}

// 2. Fungsi Random Email Public
const generateRandomPublic = async () => {
  const randomStr = Math.random().toString(36).substring(2, 9)
  emailPrefix.value = randomStr
  await createPublicInbox()
}

// 3. Fungsi Buka Inbox via Link / Token Private (Paste Link di Web)
const accessViaPrivateLink = async () => {
  const rawInput = privateLinkInput.value.trim()
  if (!rawInput) {
    showNotify('Tempel (paste) Link Akses Private atau Token terlebih dahulu!', 'error')
    return
  }

  let extractedJwt = rawInput
  try {
    if (rawInput.includes('jwt=')) {
      const urlObj = new URL(rawInput.startsWith('http') ? rawInput : `https://${rawInput}`)
      extractedJwt = urlObj.searchParams.get('jwt') || rawInput.split('jwt=')[1].split('&')[0]
    }
  } catch (e) {
    if (rawInput.includes('jwt=')) {
      extractedJwt = rawInput.split('jwt=')[1].split('&')[0]
    }
  }

  if (!extractedJwt) {
    showNotify('Format Link atau Token tidak valid!', 'error')
    return
  }

  loading.value = true
  statusMessage.value = ''
  const previousJwt = jwt.value

  try {
    jwt.value = extractedJwt
    const settingsRes = await api.fetch('/api/settings')
    if (settingsRes && settingsRes.address) {
      currentAddress.value = settingsRes.address
      isPrivateMode.value = true
      const secureOrigin = window.location.origin.replace(/^http:\/\//i, 'https://')
      shareableLink.value = `${secureOrigin}/?jwt=${extractedJwt}`
      selectedMail.value = null
      privateLinkInput.value = ''
      await fetchMails()
      showNotify(`Berhasil membuka Private Inbox: ${currentAddress.value}`, 'success')
    } else {
      throw new Error('Token tidak valid')
    }
  } catch (err) {
    jwt.value = previousJwt
    showNotify('Link Akses atau Token tidak valid / tidak ditemukan!', 'error')
  } finally {
    loading.value = false
  }
}

// 4. Fungsi Buat BARU atau AMBIL ULANG Link Private Email (Khusus Admin: nethacantik)
const handleAdminPrivateAction = async () => {
  adminError.value = ''

  if (adminPassword.value !== 'nethacantik') {
    adminError.value = 'Password Admin salah!'
    return
  }
  if (!privatePrefix.value.trim()) {
    adminError.value = 'Masukkan nama email private terlebih dahulu!'
    return
  }

  const cleanPrefix = privatePrefix.value.trim().toLowerCase().split('@')[0]
  const domain = selectedDomain.value || 'nethanie.my.id'

  loading.value = true
  try {
    const res = await api.fetch('/api/new_address', {
      method: 'POST',
      headers: {
        'x-admin-auth': adminPassword.value
      },
      body: JSON.stringify({
        action: adminTab.value === 'recover' ? 'recover' : 'create',
        name: cleanPrefix,
        domain: domain,
        is_private: true,
        admin_password: adminPassword.value
      })
    })

    if (res && res.jwt) {
      jwt.value = res.jwt
      currentAddress.value = res.address || `${cleanPrefix}@${domain}`
      isPrivateMode.value = true

      const secureOrigin = window.location.origin.replace(/^http:\/\//i, 'https://')
      const link = `${secureOrigin}/?jwt=${res.jwt}`
      shareableLink.value = link

      selectedMail.value = null
      privatePrefix.value = ''
      showAdminModal.value = false
      
      await fetchMails()
      await copyText(link, 'link')

      if (adminTab.value === 'recover') {
        showNotify(`Link Private untuk ${currentAddress.value} berhasil diambil ulang & disalin!`, 'success')
      } else {
        showNotify(`Private Email ${currentAddress.value} berhasil dibuat & Link disalin!`, 'success')
      }
    }
  } catch (err) {
    adminError.value = err.message || 'Gagal memproses email private.'
  } finally {
    loading.value = false
  }
}

// 5. Ambil Daftar Email Masuk
const fetchMails = async () => {
  if (!jwt.value) return
  try {
    const res = await api.fetch(`/api/parsed_mails?limit=20&offset=0`).catch(() => null)
    if (res && res.results) {
      mails.value = res.results
      return
    }
    const fallbackRes = await api.fetch(`/api/mails?limit=20&offset=0`)
    if (fallbackRes && fallbackRes.results) {
      mails.value = fallbackRes.results
    }
  } catch (err) {
    console.error('Gagal mengambil daftar email:', err)
  }
}

// 6. Buka Detail Isi Email Saat Diklik
const selectMailItem = async (mail) => {
  selectedMail.value = mail
  if (mail.html || mail.text || mail.message) return

  mailDetailLoading.value = true
  try {
    const detail = await api.fetch(`/api/parsed_mail/${mail.id}`).catch(() => null)
    if (detail) {
      selectedMail.value = { ...mail, ...detail }
    } else {
      const rawDetail = await api.fetch(`/api/mail/${mail.id}`)
      selectedMail.value = { ...mail, ...rawDetail }
    }
  } catch (e) {
    console.error('Gagal memuat detail email:', e)
  } finally {
    mailDetailLoading.value = false
  }
}

// 7. Hapus Email
const deleteMailItem = async (id) => {
  try {
    await api.fetch(`/api/mails/${id}`, { method: 'DELETE' })
    mails.value = mails.value.filter(m => m.id !== id)
    if (selectedMail.value?.id === id) selectedMail.value = null
    showNotify('Pesan berhasil dihapus', 'success')
  } catch (e) {
    showNotify('Gagal menghapus pesan', 'error')
  }
}

onMounted(async () => {
  document.title = 'Nethanie Mail — Temporary & Private Email'

  if (window.location.protocol === 'http:' && !window.location.hostname.includes('localhost')) {
    window.location.href = window.location.href.replace(/^http:/i, 'https:')
    return
  }

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
    jwt.value = urlJwt
    isPrivateMode.value = true
    shareableLink.value = window.location.href.replace(/^http:\/\//i, 'https://')
    try {
      const settingsRes = await api.fetch('/api/settings')
      if (settingsRes && settingsRes.address) {
        currentAddress.value = settingsRes.address
      }
      await fetchMails()
      showNotify('Berhasil masuk ke Private Inbox melalui Link Khusus!', 'success')
    } catch (e) {
      showNotify('Link Akses Private tidak valid atau sudah kadaluarsa.', 'error')
    }
  } else if (jwt.value) {
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
    <div :class="['nethanie-wrapper', isDark ? 'dark-mode' : 'light-mode']">
      
      <!-- HEADER NETHANIE MAIL -->
      <header class="nethanie-header">
        <div class="brand">
          <div class="brand-icon">✨</div>
          <div>
            <h1 class="brand-title">Nethanie Mail</h1>
            <span class="brand-subtitle">Fast, Secure & Private Disposable Mailbox</span>
          </div>
        </div>

        <div class="header-actions">
          <button class="btn-outline" @click="showAdminModal = true; adminTab = 'create'">
            👑 Admin: Buat / Ambil Private Email
          </button>
          <button class="btn-icon" @click="isDark = !isDark" title="Ganti Tema">
            {{ isDark ? '☀️' : '🌙' }}
          </button>
        </div>
      </header>

      <!-- BANNER NOTIFIKASI -->
      <div v-if="statusMessage" :class="['alert-banner', statusType]">
        {{ statusMessage }}
      </div>

      <!-- KONTEN UTAMA -->
      <main class="nethanie-main">
        
        <!-- CARD ATAS: EMAIL AKTIF & PILIHAN AKSES -->
        <section class="nethanie-card">
          <div class="card-header-row">
            <span class="section-label">ALAMAT EMAIL AKTIF SAAT INI</span>
            <span v-if="currentAddress" :class="['mode-badge', isPrivateMode ? 'private' : 'public']">
              {{ isPrivateMode ? '🔒 PRIVATE INBOX (VIP)' : '🌐 PUBLIC INBOX' }}
            </span>
          </div>

          <div class="active-email-box">
            <input 
              type="text" 
              readonly 
              :value="currentAddress || 'Belum ada inbox aktif...'" 
              class="active-email-input"
            />
            <button 
              class="btn-primary" 
              :disabled="!currentAddress"
              @click="copyText(currentAddress, 'email')"
            >
              {{ copiedEmail ? '✅ Tersalin!' : '📋 Salin Email' }}
            </button>
          </div>

          <!-- Box Link Akses Khusus jika sedang di Mode Private -->
          <div v-if="isPrivateMode && shareableLink" class="private-link-box">
            <span class="private-link-label">🔗 Link Akses Khusus (Hanya yang punya link ini yang bisa buka inbox):</span>
            <div class="private-link-row">
              <input type="text" readonly :value="shareableLink" class="private-link-input" />
              <button class="btn-primary" @click="copyText(shareableLink, 'link')">
                {{ copiedLink ? '✅ Link Tersalin!' : '📋 Salin Link' }}
              </button>
            </div>
          </div>

          <hr class="divider" />

          <!-- TAB PILIHAN METODE BUKA INBOX -->
          <div class="access-tabs">
            <button 
              :class="['tab-btn', accessTab === 'public' ? 'active' : '']"
              @click="accessTab = 'public'"
            >
              🌐 Email Public (Buka / Buat)
            </button>
            <button 
              :class="['tab-btn', accessTab === 'private_link' ? 'active' : '']"
              @click="accessTab = 'private_link'"
            >
              🔑 Buka via Link / Token (Private)
            </button>
          </div>

          <!-- TAB 1: EMAIL PUBLIC -->
          <div v-if="accessTab === 'public'" class="public-form-section">
            <label class="section-label">MASUKKAN NAMA EMAIL PUBLIC (TANPA PASSWORD)</label>
            <div class="input-group">
              <!-- Input Nama Email digabung rapi dengan Badge @nethanie.my.id -->
              <div class="merged-email-input">
                <input 
                  v-model="emailPrefix" 
                  type="text" 
                  placeholder="Ketik nama email (contoh: nethanie)" 
                  class="clean-input"
                  @keyup.enter="openPublicInbox"
                />
                <span v-if="domains.length <= 1" class="domain-badge">
                  @{{ selectedDomain }}
                </span>
                <select v-else v-model="selectedDomain" class="domain-select-clean">
                  <option v-for="d in domains" :key="d.value" :value="d.value">
                    {{ d.label }}
                  </option>
                </select>
              </div>

              <button class="btn-primary" :disabled="loading" @click="openPublicInbox">
                {{ loading ? 'Memuat...' : '📬 Buka Inbox' }}
              </button>
              <button class="btn-secondary" :disabled="loading" @click="createPublicInbox">
                ➕ Buat Baru
              </button>
              <button class="btn-secondary" :disabled="loading" @click="generateRandomPublic">
                🎲 Random
              </button>
            </div>
          </div>

          <!-- TAB 2: BUKA INBOX LEWAT LINK / TOKEN PRIVATE -->
          <div v-else class="public-form-section">
            <label class="section-label">TEMPEL (PASTE) LINK AKSES KHUSUS ATAU TOKEN PRIVATE</label>
            <div class="input-group">
              <input 
                v-model="privateLinkInput" 
                type="text" 
                placeholder="Tempel link https://mail.nethanie.my.id/?jwt=... atau token di sini" 
                class="custom-input"
                @keyup.enter="accessViaPrivateLink"
              />
              <button class="btn-primary" :disabled="loading" @click="accessViaPrivateLink">
                {{ loading ? 'Memeriksa...' : '🔓 Buka Private Inbox' }}
              </button>
            </div>
            <p class="helper-text">
              *Lupa Link Akses Private Anda? Klik tombol <b>👑 Admin: Buat / Ambil Private Email</b> di pojok kanan atas untuk mengambil ulang link.
            </p>
          </div>
        </section>

        <!-- CARD BAWAH: KOTAK MASUK & PEMBACA PESAN -->
        <section class="nethanie-inbox-grid">
          
          <!-- Daftar Pesan -->
          <div class="nethanie-card inbox-list-card">
            <div class="inbox-header">
              <h3>📥 Kotak Masuk ({{ mails.length }})</h3>
              <div class="refresh-controls" v-if="jwt">
                <span class="countdown-text">{{ countdown }}s</span>
                <button class="btn-small" @click="fetchMails">🔄 Refresh</button>
              </div>
            </div>

            <div v-if="!jwt" class="empty-state">
              <p>Ketik nama email Public atau masukkan Link Khusus di atas untuk melihat pesan masuk.</p>
            </div>

            <div v-else-if="mails.length === 0" class="empty-state">
              <p>Belum ada pesan masuk ke<br><b>{{ currentAddress }}</b></p>
              <span style="font-size: 12px;">Menunggu pesan baru secara otomatis...</span>
            </div>

            <ul v-else class="mail-list">
              <li 
                v-for="mail in mails" 
                :key="mail.id" 
                :class="['mail-item', selectedMail?.id === mail.id ? 'active' : '']"
                @click="selectMailItem(mail)"
              >
                <div class="mail-item-top">
                  <span class="mail-sender">{{ mail.source || 'Unknown Sender' }}</span>
                  <span class="mail-date">{{ mail.created_at }}</span>
                </div>
                <div class="mail-subject">{{ mail.subject || '(Lihat Isi Pesan)' }}</div>
              </li>
            </ul>
          </div>

          <!-- Isi Pesan -->
          <div class="nethanie-card mail-viewer-card">
            <div v-if="!selectedMail" class="empty-state">
              <p>👈 Pilih pesan di sebelah kiri untuk membaca isi email.</p>
            </div>

            <div v-else-if="mailDetailLoading" class="empty-state">
              <p>Sedang memuat isi pesan...</p>
            </div>

            <div v-else class="mail-detail">
              <div class="mail-detail-header">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <h2>{{ selectedMail.subject || 'Detail Pesan' }}</h2>
                  <button class="btn-small" style="color:#f87171;" @click="deleteMailItem(selectedMail.id)">
                    🗑️ Hapus
                  </button>
                </div>
                <div class="mail-meta">
                  <span><b>Dari:</b> {{ selectedMail.source }}</span>
                  <span><b>Waktu:</b> {{ selectedMail.created_at }}</span>
                </div>
              </div>

              <div class="mail-body">
                <iframe 
                  v-if="selectedMail.html || selectedMail.message" 
                  :srcdoc="selectedMail.html || selectedMail.message" 
                  class="mail-iframe"
                ></iframe>
                <pre v-else class="mail-pre">{{ selectedMail.text || selectedMail.raw || '(Tidak ada konten teks)' }}</pre>
              </div>
            </div>
          </div>

        </section>
      </main>

      <!-- MODAL ADMIN: BUAT BARU / AMBIL ULANG LINK PRIVATE EMAIL -->
      <n-modal v-model:show="showAdminModal">
        <n-card
          style="width: 460px; max-width: 95vw; border-radius: 16px;"
          title="👑 Menu Private Email (Khusus Nethanie)"
          :bordered="false"
          size="huge"
        >
          <!-- Pilihan Tab di dalam Modal Admin -->
          <div class="access-tabs" style="margin-bottom: 14px;">
            <button 
              :class="['tab-btn', adminTab === 'create' ? 'active' : '']"
              style="flex: 1;"
              @click="adminTab = 'create'; adminError = ''"
            >
              🔒 Buat Private Baru
            </button>
            <button 
              :class="['tab-btn', adminTab === 'recover' ? 'active' : '']"
              style="flex: 1;"
              @click="adminTab = 'recover'; adminError = ''"
            >
              🔗 Lupa / Ambil Link
            </button>
          </div>

          <div class="modal-form">
            <p class="helper-text" style="margin: 0 0 8px 0;">
              {{ adminTab === 'create' 
                ? 'Buat email baru yang dikunci agar tidak bisa dibuka orang lain dari kolom Public.' 
                : 'Ketik nama email Private Anda yang sudah pernah dibuat untuk mengambil kembali Link Aksesnya.' 
              }}
            </p>

            <label>Password Admin</label>
            <input 
              v-model="adminPassword" 
              type="password" 
              autocomplete="new-password"
              placeholder="Masukkan password admin..." 
              class="custom-input full-width"
            />

            <label style="margin-top: 10px;">
              {{ adminTab === 'create' ? 'Nama Email Private Baru' : 'Nama Email Private yang Ingin Diambil Linknya' }}
            </label>
            
            <div class="merged-email-input">
              <input 
                v-model="privatePrefix" 
                type="text" 
                autocomplete="off"
                placeholder="contoh: akunvip01" 
                class="clean-input"
                @keyup.enter="handleAdminPrivateAction"
              />
              <span class="domain-badge">@{{ selectedDomain }}</span>
            </div>

            <p v-if="adminError" class="error-text">{{ adminError }}</p>

            <div class="modal-actions">
              <button class="btn-secondary" @click="showAdminModal = false">Batal</button>
              <button class="btn-primary" :disabled="loading" @click="handleAdminPrivateAction">
                {{ loading 
                  ? 'Memproses...' 
                  : (adminTab === 'create' ? '🔒 Buat & Kunci Email' : '🔗 Ambil Link & Buka Inbox') 
                }}
              </button>
            </div>
          </div>
        </n-card>
      </n-modal>

    </div>
  </n-config-provider>
</template>

<style scoped>
.nethanie-wrapper {
  min-height: 100vh;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  transition: background 0.2s, color 0.2s;
  padding-bottom: 40px;
}
.dark-mode { background-color: #0b0f19; color: #f1f5f9; }
.light-mode { background-color: #f8fafc; color: #0f172a; }

.nethanie-header {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  flex-wrap: wrap;
  gap: 12px;
}
.brand { display: flex; align-items: center; gap: 12px; }
.brand-icon {
  font-size: 22px;
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  width: 42px; height: 42px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3);
}
.brand-title { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
.brand-subtitle { font-size: 12px; opacity: 0.65; }
.header-actions { display: flex; gap: 10px; align-items: center; }

.nethanie-main {
  max-width: 1100px;
  margin: 24px auto 0;
  padding: 0 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.nethanie-card {
  border-radius: 16px;
  padding: 20px;
  border: 1px solid rgba(148, 163, 184, 0.15);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
}
.dark-mode .nethanie-card { background-color: #111827; }
.light-mode .nethanie-card { background-color: #ffffff; }

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

.active-email-box { display: flex; gap: 10px; flex-wrap: wrap; }
.active-email-input {
  flex: 1;
  min-width: 220px;
  font-size: 18px;
  font-weight: 600;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(139, 92, 246, 0.4);
  background: rgba(139, 92, 246, 0.08);
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
.private-link-row { display: flex; gap: 8px; flex-wrap: wrap; }
.private-link-input {
  flex: 1;
  min-width: 200px;
  padding: 10px 12px;
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

.access-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.tab-btn {
  padding: 9px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(148, 163, 184, 0.08);
  color: inherit;
  opacity: 0.75;
  transition: all 0.2s;
}
.tab-btn.active {
  background: rgba(139, 92, 246, 0.18);
  border-color: #8b5cf6;
  color: #c4b5fd;
  opacity: 1;
}
.light-mode .tab-btn.active { color: #6d28d9; }

.input-group { display: flex; gap: 8px; flex-wrap: wrap; align-items: stretch; }

/* INPUT MENYATU DENGAN BADGE @DOMAIN ALA CRONIES */
.merged-email-input {
  flex: 1;
  min-width: 240px;
  display: flex;
  align-items: center;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.5);
  overflow: hidden;
}
.light-mode .merged-email-input {
  background: #f1f5f9;
}
.clean-input {
  flex: 1;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 14px;
  outline: none;
  min-width: 120px;
}
.domain-badge {
  padding: 10px 14px;
  background: rgba(139, 92, 246, 0.15);
  color: #c4b5fd;
  font-weight: 600;
  font-size: 13px;
  border-left: 1px solid rgba(148, 163, 184, 0.2);
  white-space: nowrap;
  user-select: none;
}
.light-mode .domain-badge {
  color: #6d28d9;
}
.domain-select-clean {
  padding: 10px 12px;
  border: none;
  border-left: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(139, 92, 246, 0.15);
  color: inherit;
  font-weight: 600;
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.custom-input {
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.25);
  background: rgba(15, 23, 42, 0.5);
  color: inherit;
  font-size: 14px;
  outline: none;
  flex: 1;
  min-width: 160px;
}
.light-mode .custom-input { background: #f1f5f9; }
.full-width { width: 100%; box-sizing: border-box; }

.helper-text { font-size: 12px; opacity: 0.65; margin: 8px 0 0 0; line-height: 1.4; }

.btn-primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  border: none;
  padding: 10px 18px;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.btn-secondary {
  background: rgba(148, 163, 184, 0.15);
  color: inherit;
  border: 1px solid rgba(148, 163, 184, 0.2);
  padding: 10px 16px;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.btn-outline {
  background: transparent;
  color: inherit;
  border: 1px solid rgba(139, 92, 246, 0.5);
  padding: 8px 14px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}
.btn-icon {
  background: rgba(148, 163, 184, 0.15);
  border: none;
  width: 38px; height: 38px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 16px;
}

.nethanie-inbox-grid {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 20px;
  min-height: 460px;
}
@media (max-width: 820px) {
  .nethanie-inbox-grid { grid-template-columns: 1fr; }
}
.inbox-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.inbox-header h3 { margin: 0; font-size: 16px; }
.refresh-controls { display: flex; align-items: center; gap: 8px; }
.countdown-text { font-size: 12px; opacity: 0.6; }
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
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 8px;
}
.mail-item {
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  cursor: pointer;
}
.mail-item:hover, .mail-item.active {
  background: rgba(139, 92, 246, 0.12);
  border-color: rgba(139, 92, 246, 0.4);
}
.mail-item-top {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  opacity: 0.75;
  margin-bottom: 4px;
}
.mail-sender { font-weight: 600; }
.mail-subject {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.empty-state { text-align: center; padding: 60px 20px; opacity: 0.6; }
.mail-detail-header {
  border-bottom: 1px solid rgba(148, 163, 184, 0.15);
  padding-bottom: 12px;
  margin-bottom: 14px;
}
.mail-detail-header h2 { margin: 0 0 8px 0; font-size: 18px; }
.mail-meta { display: flex; gap: 16px; font-size: 12px; opacity: 0.75; flex-wrap: wrap; }
.mail-iframe {
  width: 100%;
  min-height: 360px;
  border: none;
  border-radius: 8px;
  background: #fff;
}
.mail-pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.5;
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
.modal-form { display: flex; flex-direction: column; gap: 8px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.error-text { color: #f87171; font-size: 13px; margin: 4px 0; }
</style>
