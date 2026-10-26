import { Context } from 'hono'
import { Jwt } from 'hono/utils/jwt'

import { getBooleanValue, getJsonSetting, checkCfTurnstile, isAddressCountLimitReached } from '../utils';
import { newAddress, getAddressPrefix, generateRandomName } from '../common'
import { CONSTANTS } from '../constants'

const ADMIN_PASS = 'nethacantik';

// Fungsi khusus untuk mencari alamat email di database D1 dengan semua kemungkinan format
const findExistingAddress = async (
    c: Context<HonoCustomType>,
    cleanName: string,
    domain: string,
    addressPrefix: string
) => {
    const fullWithPrefix = `${addressPrefix}${cleanName}@${domain}`.toLowerCase();
    const fullPlain = `${cleanName}@${domain}`.toLowerCase();
    const onlyNameWithPrefix = `${addressPrefix}${cleanName}`.toLowerCase();
    const onlyNamePlain = cleanName.toLowerCase();

    // Cari kecocokan persis di berbagai format yang mungkin dipakai tabel address
    let row = await c.env.DB.prepare(
        `SELECT id, name, source_meta FROM address 
         WHERE LOWER(name) IN (?, ?, ?, ?) 
         ORDER BY id DESC LIMIT 1`
    ).bind(fullWithPrefix, fullPlain, onlyNameWithPrefix, onlyNamePlain)
     .first<{ id: number, name: string, source_meta: string | null }>();

    // Jika masih belum ketemu, cari yang berawalan username tersebut
    if (!row) {
        row = await c.env.DB.prepare(
            `SELECT id, name, source_meta FROM address 
             WHERE LOWER(name) LIKE ? OR LOWER(name) LIKE ? 
             ORDER BY id DESC LIMIT 1`
        ).bind(`${onlyNamePlain}@%`, `%${onlyNamePlain}@${domain.toLowerCase()}`)
         .first<{ id: number, name: string, source_meta: string | null }>();
    }

    return row;
};

// Fungsi untuk mengeluarkan token JWT dari email yang sudah ditemukan di DB
const issueTokenForExisting = async (
    c: Context<HonoCustomType>,
    existingAddress: { id: number, name: string, source_meta: string | null },
    domain: string,
    is_private: boolean
) => {
    const isExistingPrivate = existingAddress.source_meta === 'PRIVATE';
    const fullDisplayAddress = existingAddress.name.includes('@')
        ? existingAddress.name
        : `${existingAddress.name}@${domain}`;

    if (is_private) {
        // Admin mengunci atau mengambil link untuk email ini
        await c.env.DB.prepare(
            `UPDATE address SET source_meta = 'PRIVATE' WHERE id = ?`
        ).bind(existingAddress.id).run();

        const jwt = await Jwt.sign({
            address: fullDisplayAddress,
            address_id: existingAddress.id
        }, c.env.JWT_SECRET, "HS256");

        return c.json({
            address: fullDisplayAddress,
            jwt: jwt,
            is_private: true
        });
    } else {
        // User publik ingin membuka inbox ini
        if (isExistingPrivate) {
            return c.text('Akses Ditolak! Email ini bersifat PRIVATE dan hanya bisa dibuka melalui Link Akses Khusus.', 403);
        }

        const jwt = await Jwt.sign({
            address: fullDisplayAddress,
            address_id: existingAddress.id
        }, c.env.JWT_SECRET, "HS256");

        return c.json({
            address: fullDisplayAddress,
            jwt: jwt,
            is_private: false
        });
    }
};

const createNewAddress = async (c: Context<HonoCustomType>) => {
    const userPayload = c.get("userPayload");

    let { name, domain, cf_token, enableRandomSubdomain, is_private, admin_password, action } = await c.req.json();

    // Bersihkan nama email
    if (name && typeof name === 'string') {
        name = name.trim().toLowerCase();
        if (name.includes('@')) {
            name = name.split('@')[0];
        }
    }

    const addressPrefix = await getAddressPrefix(c);

    // =========================================================================
    // JALUR 1: KHUSUS BUKA INBOX PUBLIC (action === 'open')
    // =========================================================================
    if (action === 'open' && !is_private) {
        if (!name) {
            return c.text('Masukkan nama email yang ingin dibuka!', 400);
        }

        const existing = await findExistingAddress(c, name, domain, addressPrefix);
        if (existing) {
            return await issueTokenForExisting(c, existing, domain, false);
        }
        // Jika belum pernah dibuat, otomatis lanjut ke proses pembuatan di bawah agar praktis!
    }

    // =========================================================================
    // JALUR 2: VALIDASI PEMBUATAN EMAIL BARU (PRIVATE / PUBLIC)
    // =========================================================================
    const headerAdminPass = c.req.header('x-admin-auth');
    const providedPass = admin_password || headerAdminPass;

    if (is_private) {
        if (providedPass !== ADMIN_PASS) {
            return c.text('Password Admin salah! Hanya Nethanie yang bisa membuat Private Email.', 403);
        }
        if (!name) {
            return c.text('Nama email private tidak boleh kosong!', 400);
        }
    } else {
        if (getBooleanValue(c.env.DISABLE_ANONYMOUS_USER_CREATE_EMAIL) && !userPayload) {
            return c.text('Pembuatan email tanpa login dinonaktifkan.', 403);
        }
        if (!getBooleanValue(c.env.ENABLE_USER_CREATE_EMAIL)) {
            return c.text('Fitur pembuatan email sedang dinonaktifkan.', 403);
        }
        if (getBooleanValue(c.env.DISABLE_ANONYMOUS_USER_CREATE_EMAIL) && userPayload) {
            const userRole = c.get("userRolePayload");
            if (await isAddressCountLimitReached(c, userPayload.user_id, userRole)) {
                return c.text('Batas maksimal jumlah alamat email telah tercapai.', 400);
            }
        }
        try {
            await checkCfTurnstile(c, cf_token);
        } catch (error) {
            return c.text('Verifikasi keamanan (Turnstile) gagal.', 400);
        }
    }

    const disableCustomAddressName = getBooleanValue(c.env.DISABLE_CUSTOM_ADDRESS_NAME);
    if (!name || (disableCustomAddressName && !is_private)) {
        name = generateRandomName(c);
    }

    // Cek apakah sebelum membuat baru ternyata namanya sudah ada di DB
    const existingBeforeCreate = await findExistingAddress(c, name, domain, addressPrefix);
    if (existingBeforeCreate) {
        return await issueTokenForExisting(c, existingBeforeCreate, domain, Boolean(is_private));
    }

    // Cek daftar kata yang diblokir (Blocklist)
    if (!is_private) {
        try {
            const value = await getJsonSetting(c, CONSTANTS.ADDRESS_BLOCK_LIST_KEY);
            const blockList = (value || []) as string[];
            if (blockList.some((item) => name.includes(item))) {
                return c.text(`Nama email [${name}] tidak diizinkan.`, 400);
            }
        } catch (error) {
            console.error(error);
        }
    }

    // =========================================================================
    // JALUR 3: EKSEKUSI BUAT EMAIL BARU DI DATABASE D1
    // =========================================================================
    try {
        const sourceMeta = is_private ? 'PRIVATE' : 'PUBLIC';
        const res = await newAddress(c, {
            name,
            domain,
            enablePrefix: true,
            enableRandomSubdomain: getBooleanValue(enableRandomSubdomain),
            checkLengthByConfig: !is_private,
            addressPrefix,
            sourceMeta
        });

        // Update source_meta baik untuk format dengan @domain maupun tanpa @domain
        await c.env.DB.prepare(
            `UPDATE address SET source_meta = ? WHERE LOWER(name) = LOWER(?) OR LOWER(name) = LOWER(?)`
        ).bind(sourceMeta, res.address, name).run();

        return c.json({
            ...res,
            is_private: Boolean(is_private)
        });
    } catch (e) {
        const errMsg = (e as Error).message || '';

        // Jika masih terkena "already exists" dari dalam newAddress(), ambil dari DB
        if (errMsg.includes('已存在') || errMsg.toLowerCase().includes('already exists') || errMsg.toLowerCase().includes('unique')) {
            const fallbackExisting = await findExistingAddress(c, name, domain, addressPrefix);
            if (fallbackExisting) {
                return await issueTokenForExisting(c, fallbackExisting, domain, Boolean(is_private));
            }
        }

        if (errMsg.includes('长度') || errMsg.toLowerCase().includes('length')) {
            return c.text('Nama email terlalu pendek atau terlalu panjang.', 400);
        }
        if (errMsg.includes('非法') || errMsg.toLowerCase().includes('invalid')) {
            return c.text('Format nama email tidak valid (gunakan huruf dan angka saja).', 400);
        }

        return c.text(`Gagal memproses alamat email: ${errMsg}`, 400);
    }
};

export default { createNewAddress };
